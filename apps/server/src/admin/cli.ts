#!/usr/bin/env tsx
/**
 * Admin CLI for Tilted.
 *
 * Usage: pnpm cli <command> [args]
 *
 * Commands:
 *   seed-users              Seed the two hardcoded users
 *   list-users              List all users
 *   new-match               Create a new match
 *   dump-match <id>         Full JSON dump of a match
 *   reset-match             End all active matches
 *   force-action <hand> <user> <type> [amount]  Force an action
 *   verify-ledger <match>   Run the chip ledger invariant check
 */

import 'dotenv/config';
import { createDb } from '../db/connection.js';
import { seedUsers, USER_TJ_ID, USER_SL_ID } from '../db/seed.js';
import { users, matches, rounds, hands, actions } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const db = createDb(DATABASE_URL);
const [, , command, ...args] = process.argv;

async function main() {
  switch (command) {
    case 'seed-users': {
      await seedUsers(db);
      console.log('Seeded users: TJ and SL');
      break;
    }

    case 'list-users': {
      const rows = await db.query.users.findMany();
      for (const u of rows) {
        console.log(`${u.userId} | ${u.displayName} | APNS: ${u.apnsToken ?? 'none'}`);
      }
      break;
    }

    case 'new-match': {
      const { createMatch } = await import('../game/match.js');
      const match = await createMatch(db, USER_TJ_ID, USER_SL_ID);
      console.log(`Created match: ${match.matchId}`);
      break;
    }

    case 'dump-match': {
      const matchId = args[0];
      if (!matchId) { console.error('Usage: dump-match <match_id>'); break; }

      const match = await db.query.matches.findFirst({ where: eq(matches.matchId, matchId) });
      const matchRounds = await db.query.rounds.findMany({ where: eq(rounds.matchId, matchId) });
      const allHands = [];
      for (const r of matchRounds) {
        const rHands = await db.query.hands.findMany({ where: eq(hands.roundId, r.roundId) });
        for (const h of rHands) {
          const hActions = await db.query.actions.findMany({ where: eq(actions.handId, h.handId) });
          allHands.push({ ...h, actions: hActions });
        }
      }

      console.log(JSON.stringify({ match, rounds: matchRounds, hands: allHands }, null, 2));
      break;
    }

    case 'reset-match': {
      const result = await db.update(matches)
        .set({ status: 'ended', endedAt: new Date() })
        .where(eq(matches.status, 'active'))
        .returning();
      console.log(`Ended ${result.length} active match(es)`);
      break;
    }

    case 'force-action': {
      const [handId, userId, actionType, amountStr] = args;
      if (!handId || !userId || !actionType) {
        console.error('Usage: force-action <hand_id> <user_id> <type> [amount]');
        break;
      }
      const { applyAction } = await import('../game/turn.js');
      const result = await applyAction(db, {
        handId,
        userId,
        actionType: actionType as 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in',
        amount: parseInt(amountStr || '0'),
        clientTxId: `cli-${Date.now()}`,
      });
      console.log('Action applied. Match state:');
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'verify-ledger': {
      const matchId = args[0];
      if (!matchId) { console.error('Usage: verify-ledger <match_id>'); break; }
      const { assertLedgerInvariant } = await import('../game/ledger.js');
      try {
        await assertLedgerInvariant(db, matchId);
        console.log('Ledger invariant OK');
      } catch (err) {
        console.error('INVARIANT VIOLATION:', (err as Error).message);
        process.exit(1);
      }
      break;
    }

    default:
      console.log('Commands: seed-users, list-users, new-match, dump-match, reset-match, force-action, verify-ledger');
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
