// Account deletion must remove the deleting user's personal data without
// destroying the other player's match history (spec §23):
//   - the user row is scrubbed in place, not removed
//   - every match, round, hand and action stays
//   - active matches end as 'abandoned' with no winner and freeze
//   - the deleted user can no longer be challenged or authenticated

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  freshDb, seedUser, seedMatch, seedBaseScenario,
  skipIfNoDb, type TestEnv,
} from './helpers.js';
import {
  users, matches, hands, favorites, debugTokens, pendingReminders,
} from '../../src/db/schema.js';

vi.mock('../../src/notif/dispatchers.js', () => ({
  dispatch: vi.fn().mockResolvedValue(undefined),
}));

const { deleteAccount, DELETED_DISPLAY_NAME } = await import('../../src/game/account.js');
const { createMatch } = await import('../../src/game/match.js');
const { applyTurnBatch } = await import('../../src/game/turn.js');

describe.skipIf(skipIfNoDb)('account deletion', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await freshDb();
  });

  it('scrubs the user row and keeps the opponent\'s ended match history', async () => {
    const s = await seedBaseScenario(env.db);
    await env.db.update(users).set({
      appleSub: 'apple-sub-bob', email: 'bob@example.com', fullName: 'Bob Real', apnsToken: 'tok',
    }).where(eq(users.userId, s.bob.userId));
    await env.db.update(matches)
      .set({ status: 'ended', winnerUserId: s.alice.userId, endedAt: new Date() })
      .where(eq(matches.matchId, s.matchId));
    await env.db.insert(debugTokens).values({ tokenHash: 'h-bob', userId: s.bob.userId });
    await env.db.insert(favorites).values([
      { userId: s.bob.userId, handId: s.handId },
      { userId: s.alice.userId, handId: s.handId },
    ]);

    await deleteAccount(env.db, s.bob.userId, 'user_deleted');

    const bob = await env.db.query.users.findFirst({ where: eq(users.userId, s.bob.userId) });
    expect(bob).toBeDefined();
    expect(bob!.appleSub).toBeNull();
    expect(bob!.email).toBeNull();
    expect(bob!.fullName).toBeNull();
    expect(bob!.apnsToken).toBeNull();
    expect(bob!.displayName).toBe(DELETED_DISPLAY_NAME);
    expect(bob!.deletedAt).not.toBeNull();

    // History intact; the ended match keeps its winner.
    const match = await env.db.query.matches.findFirst({ where: eq(matches.matchId, s.matchId) });
    expect(match!.status).toBe('ended');
    expect(match!.winnerUserId).toBe(s.alice.userId);
    expect(await env.db.query.rounds.findMany()).toHaveLength(1);
    expect(await env.db.query.hands.findMany()).toHaveLength(1);

    // Bob's tokens and pins are gone; Alice's pin stays.
    expect(await env.db.query.debugTokens.findMany()).toHaveLength(0);
    const favs = await env.db.query.favorites.findMany();
    expect(favs).toHaveLength(1);
    expect(favs[0].userId).toBe(s.alice.userId);
  });

  it('ends active matches as abandoned with no winner and freezes them', async () => {
    const s = await seedBaseScenario(env.db);
    await env.db.insert(pendingReminders).values({
      kind: 'turn_handoff', userId: s.alice.userId, matchId: s.matchId, roundId: s.roundId,
      dueAt: new Date(Date.now() + 60_000),
    });

    await deleteAccount(env.db, s.bob.userId, 'user_deleted');

    const match = await env.db.query.matches.findFirst({ where: eq(matches.matchId, s.matchId) });
    expect(match!.status).toBe('abandoned');
    expect(match!.winnerUserId).toBeNull();
    expect(match!.endedAt).not.toBeNull();

    // No reminder may fire for a dead match.
    expect(await env.db.query.pendingReminders.findMany()).toHaveLength(0);

    // The hand is still on record but can no longer be acted on.
    const hand = await env.db.query.hands.findFirst({ where: eq(hands.handId, s.handId) });
    expect(hand).toBeDefined();
    await expect(applyTurnBatch(env.db, s.alice.userId, {
      actions: [{ handId: s.handId, actionType: 'fold', amount: 0, clientTxId: 'tx-1' }],
    })).rejects.toThrow('Match is not active');
  });

  it('leaves matches between other players untouched', async () => {
    const s = await seedBaseScenario(env.db);
    const carol = await seedUser(env.db, { displayName: 'Carol' });
    const other = await seedMatch(env.db, s.alice.userId, carol.userId);

    await deleteAccount(env.db, s.bob.userId, 'user_deleted');

    const m = await env.db.query.matches.findFirst({ where: eq(matches.matchId, other.matchId) });
    expect(m!.status).toBe('active');
    const c = await env.db.query.users.findFirst({ where: eq(users.userId, carol.userId) });
    expect(c!.displayName).toBe('Carol');
    expect(c!.deletedAt).toBeNull();
  });

  it('refuses a challenge against a deleted user', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const bob = await seedUser(env.db, { displayName: 'Bob' });
    await deleteAccount(env.db, bob.userId, 'user_deleted');

    await expect(createMatch(env.db, alice.userId, bob.userId)).rejects.toThrow('Opponent not found');
    expect(await env.db.query.rounds.findMany()).toHaveLength(0);
  });

  it('is idempotent', async () => {
    const s = await seedBaseScenario(env.db);
    await deleteAccount(env.db, s.bob.userId, 'user_deleted');
    const first = await env.db.query.users.findFirst({ where: eq(users.userId, s.bob.userId) });
    await deleteAccount(env.db, s.bob.userId, 'user_deleted');
    const second = await env.db.query.users.findFirst({ where: eq(users.userId, s.bob.userId) });
    expect(second!.deletedAt!.getTime()).toBe(first!.deletedAt!.getTime());
  });
});
