import { eq, and, sql, ne } from 'drizzle-orm';
import type { Transaction, Database } from '../db/connection.js';
import { hands, matches } from '../db/schema.js';

/**
 * Calculate a user's available chips.
 * available = total - Σ reserved across all active hands
 */
export async function getAvailableChips(
  tx: Transaction | Database,
  matchId: string,
  userId: string,
): Promise<{ total: number; reserved: number; available: number }> {
  // Get the match to find total
  const match = await tx.query.matches.findFirst({
    where: eq(matches.matchId, matchId),
  });
  if (!match) throw new Error(`Match ${matchId} not found`);

  const isUserA = match.userAId === userId;
  const total = isUserA ? match.userATotal : match.userBTotal;

  // Sum reserved across all active (non-complete) hands in this match
  const reservedCol = isUserA ? hands.userAReserved : hands.userBReserved;

  const result = await tx
    .select({ total: sql<number>`coalesce(sum(${reservedCol}), 0)` })
    .from(hands)
    .innerJoin(
      // We need the round for the match filter
      // Simpler: just check all hands that aren't complete
      sql`(select round_id from rounds where match_id = ${matchId})`,
      eq(hands.roundId, sql`round_id`),
    )
    .where(ne(hands.status, 'complete'));

  // Simpler approach: query through rounds
  const reservedResult = await tx.execute<{ total_reserved: string }>(sql`
    SELECT coalesce(sum(${reservedCol}), 0) as total_reserved
    FROM ${hands} h
    JOIN rounds r ON r.round_id = h.round_id
    WHERE r.match_id = ${matchId}
      AND h.status != 'complete'
  `);

  const reserved = Number(reservedResult[0]?.total_reserved ?? 0);

  return { total, reserved, available: total - reserved };
}

/**
 * Validate that a player can commit `amount` additional chips to a hand.
 * Takes into account what they already have reserved in this specific hand.
 */
export async function validateChipCommit(
  tx: Transaction | Database,
  matchId: string,
  userId: string,
  additionalAmount: number,
): Promise<{ valid: boolean; available: number; error?: string }> {
  const { available } = await getAvailableChips(tx, matchId, userId);

  if (additionalAmount > available) {
    return {
      valid: false,
      available,
      error: `Cannot commit ${additionalAmount} chips. Only ${available} available.`,
    };
  }

  return { valid: true, available };
}

/**
 * Post-mutation assertion: verify the ledger invariant holds.
 * For each user: Σ reserved ≤ total.
 * If violated, throws an error (which will abort the transaction).
 */
export async function assertLedgerInvariant(
  tx: Transaction | Database,
  matchId: string,
): Promise<void> {
  const match = await tx.query.matches.findFirst({
    where: eq(matches.matchId, matchId),
  });
  if (!match) throw new Error(`Match ${matchId} not found`);

  for (const { userId, total, reservedCol } of [
    { userId: match.userAId, total: match.userATotal, reservedCol: 'user_a_reserved' },
    { userId: match.userBId, total: match.userBTotal, reservedCol: 'user_b_reserved' },
  ]) {
    const result = await tx.execute<{ total_reserved: string }>(sql`
      SELECT coalesce(sum(${sql.raw(reservedCol)}), 0) as total_reserved
      FROM hands h
      JOIN rounds r ON r.round_id = h.round_id
      WHERE r.match_id = ${matchId}
        AND h.status != 'complete'
    `);

    const reserved = Number(result[0]?.total_reserved ?? 0);

    if (reserved > total) {
      throw new Error(
        `LEDGER INVARIANT VIOLATION: User ${userId} has ${reserved} reserved but only ${total} total chips`
      );
    }
  }
}
