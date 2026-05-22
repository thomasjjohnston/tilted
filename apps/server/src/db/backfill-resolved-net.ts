// One-shot backfill: reconstruct hands.resolved_net_for_a/b for legacy
// hands where the snapshot was never written (or was wiped by a DB
// rollback). Computes each user's contribution from the actions table
// plus the round's small/big blinds, then derives net = award -
// contribution. Idempotent: only touches rows where either snapshot
// column is NULL.
//
// Run manually after a deploy where you suspect drift:
//
//   cd apps/server
//   DATABASE_URL="$DB_URL" pnpm tsx src/db/backfill-resolved-net.ts
//
// After first successful run, move this file to docs/ops/scripts/ for
// future reference (the runbook documents it).

import postgres from 'postgres';

/**
 * Pure reconstruction — exported so unit tests can verify the math
 * without spinning up the full script.
 */
export interface ReconstructionInput {
  userAId: string;
  userBId: string;
  sbUserId: string;
  blindSmall: number;
  blindBig: number;
  pot: number;
  winnerUserId: string | null;
  /** actions: each entry is { actingUserId, amount } for one action row on this hand. */
  actions: { actingUserId: string; amount: number }[];
}

export function reconstructResolvedNet(input: ReconstructionInput): { aDelta: number; bDelta: number } {
  let aActions = 0;
  let bActions = 0;
  for (const a of input.actions) {
    if (a.actingUserId === input.userAId) aActions += a.amount;
    else if (a.actingUserId === input.userBId) bActions += a.amount;
  }

  const sbIsUserA = input.sbUserId === input.userAId;
  const aBlind = sbIsUserA ? input.blindSmall : input.blindBig;
  const bBlind = sbIsUserA ? input.blindBig : input.blindSmall;
  const aContribution = aActions + aBlind;
  const bContribution = bActions + bBlind;

  let aAward = 0;
  let bAward = 0;
  if (input.winnerUserId === input.userAId) {
    aAward = input.pot;
  } else if (input.winnerUserId === input.userBId) {
    bAward = input.pot;
  } else {
    // Split — odd chip to BB (out-of-position in HU).
    const half = Math.floor(input.pot / 2);
    const remainder = input.pot % 2;
    if (sbIsUserA) {
      aAward = half;
      bAward = half + remainder;
    } else {
      aAward = half + remainder;
      bAward = half;
    }
  }

  return { aDelta: aAward - aContribution, bDelta: bAward - bContribution };
}

// Script entry point — only runs when invoked directly via tsx.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  await runScript();
}

async function runScript(): Promise<void> {

const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL'); process.exit(1); }

const sql = postgres(url, { max: 1, ssl: 'require' });

interface CandidateRow {
  hand_id: string;
  match_id: string;
  user_a_id: string;
  user_b_id: string;
  blind_small: number;
  blind_big: number;
  sb_user_id: string;
  pot: number;
  winner_user_id: string | null;
  terminal_reason: string | null;
}

const candidates = await sql<CandidateRow[]>`
  SELECT
    h.hand_id, m.match_id, m.user_a_id, m.user_b_id,
    m.blind_small, m.blind_big,
    r.sb_user_id,
    h.pot, h.winner_user_id, h.terminal_reason
  FROM hands h
  JOIN rounds r ON r.round_id = h.round_id
  JOIN matches m ON m.match_id = r.match_id
  WHERE h.status = 'complete'
    AND (h.resolved_net_for_a IS NULL OR h.resolved_net_for_b IS NULL)
`;

console.log(`Found ${candidates.length} hands to backfill.`);
if (candidates.length === 0) {
  await sql.end();
  process.exit(0);
}

let updated = 0;
const samples: { handId: string; aDelta: number; bDelta: number }[] = [];

for (const c of candidates) {
  const contribRows = await sql<{ acting_user_id: string; amount: number }[]>`
    SELECT acting_user_id, amount FROM actions WHERE hand_id = ${c.hand_id}
  `;
  const { aDelta, bDelta } = reconstructResolvedNet({
    userAId: c.user_a_id,
    userBId: c.user_b_id,
    sbUserId: c.sb_user_id,
    blindSmall: c.blind_small,
    blindBig: c.blind_big,
    pot: c.pot,
    winnerUserId: c.winner_user_id,
    actions: contribRows.map(r => ({ actingUserId: r.acting_user_id, amount: r.amount })),
  });

  await sql`
    UPDATE hands
    SET resolved_net_for_a = ${aDelta},
        resolved_net_for_b = ${bDelta}
    WHERE hand_id = ${c.hand_id}
  `;

  updated++;
  if (samples.length < 5) {
    samples.push({ handId: c.hand_id, aDelta, bDelta });
  }
}

console.log(`Updated ${updated} hands. Sample:`);
console.table(samples);

await sql.end();
process.exit(0);
}
