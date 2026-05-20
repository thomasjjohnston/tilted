// Verifies that the last pending action of a turn fires a turn_handoff
// notification via dispatch().

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { freshDb, seedBaseScenario, skipIfNoDb, type TestEnv } from './helpers.js';

const dispatchMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/notif/dispatchers.js', () => ({
  dispatch: (...args: unknown[]) => dispatchMock(...args),
}));

vi.mock('../../src/notif/reminder-cron.js', () => ({
  enqueueReminder: vi.fn().mockResolvedValue(undefined),
}));

const { applyAction } = await import('../../src/game/turn.js');

describe.skipIf(skipIfNoDb)('turn handoff push', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await freshDb();
    dispatchMock.mockClear();
  });

  it('fires turn_handoff dispatch when the acting user has no more pending hands', async () => {
    const s = await seedBaseScenario(env.db);
    // Alice's only hand. She folds — turn handoff to Bob fires (Bob now
    // has 0 pending in this round, but the handoff still fires from
    // alice's pov because the engine considers her done).
    // Actually: a fold ends the hand; round has only one hand → both
    // have 0 pending; handoff path != round-complete path, but for this
    // scenario the round transitions to revealing.
    //
    // To get a clean turn_handoff (myPending=0, oppPending>0), we need
    // a second hand still in_progress with action on Bob. Add one.
    const { seedHand } = await import('./helpers.js');
    await seedHand(env.db, s.roundId, {
      handIndex: 1,
      actionOnUserId: s.bob.userId,
    });

    await applyAction(env.db, {
      handId: s.handId,
      userId: s.alice.userId,
      actionType: 'fold',
      amount: 0,
      clientTxId: 'handoff-1',
    });

    // dispatch should have been called once with kind='turn_handoff'.
    const handoffCalls = dispatchMock.mock.calls.filter(
      ([, n]) => (n as { kind: string }).kind === 'turn_handoff'
    );
    expect(handoffCalls).toHaveLength(1);
    expect((handoffCalls[0][1] as { toUserId: string }).toUserId).toBe(s.bob.userId);
  });
});
