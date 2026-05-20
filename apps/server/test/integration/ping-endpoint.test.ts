// Verifies the ping endpoint:
//   - succeeds for participants, logs an app_event, fires dispatch
//   - 403 for non-participants
//   - 404 for not-active matches

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  freshDb, seedUser, seedMatch,
  skipIfNoDb, type TestEnv,
} from './helpers.js';
import { matches, appEvents } from '../../src/db/schema.js';

const dispatchMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/notif/dispatchers.js', () => ({
  dispatch: (...args: unknown[]) => dispatchMock(...args),
}));

const { sendPing } = await import('../../src/game/match.js');

describe.skipIf(skipIfNoDb)('ping endpoint', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await freshDb();
    dispatchMock.mockClear();
  });

  it('dispatches a ping push to the opponent and logs an app_event', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const bob = await seedUser(env.db, { displayName: 'Bob' });
    const match = await seedMatch(env.db, alice.userId, bob.userId, { sbOfRound1: alice.userId });

    const result = await sendPing(env.db, match.matchId, alice.userId);
    expect(typeof result.quip).toBe('string');
    expect(result.quip.length).toBeGreaterThan(0);
    expect(typeof result.sent_at).toBe('string');

    // dispatch was called once with kind='ping' to bob.
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const [, notif] = dispatchMock.mock.calls[0] as [unknown, { kind: string; toUserId: string; quip: string }];
    expect(notif.kind).toBe('ping');
    expect(notif.toUserId).toBe(bob.userId);
    expect(notif.quip).toBe(result.quip);

    // app_event was logged.
    const events = await env.db.query.appEvents.findMany({ where: eq(appEvents.kind, 'ping_sent') });
    expect(events).toHaveLength(1);
    expect(events[0].userId).toBe(alice.userId);
  });

  it('rejects non-participants with "Not a participant"', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const bob = await seedUser(env.db, { displayName: 'Bob' });
    const intruder = await seedUser(env.db, { displayName: 'Charlie' });
    const match = await seedMatch(env.db, alice.userId, bob.userId, { sbOfRound1: alice.userId });

    await expect(sendPing(env.db, match.matchId, intruder.userId))
      .rejects.toThrow('Not a participant');
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('rejects pings on an ended match', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const bob = await seedUser(env.db, { displayName: 'Bob' });
    const match = await seedMatch(env.db, alice.userId, bob.userId, { sbOfRound1: alice.userId });

    // Manually flip to ended.
    await env.db.update(matches).set({ status: 'ended' }).where(eq(matches.matchId, match.matchId));

    await expect(sendPing(env.db, match.matchId, alice.userId))
      .rejects.toThrow('Match is not active');
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
