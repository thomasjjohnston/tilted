// Verifies the chat messages module: send/list, hand_id filtering,
// participant auth, length validation, dispatch fired.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  freshDb, seedUser, seedMatch, seedRound, seedHand,
  skipIfNoDb, type TestEnv,
} from './helpers.js';

const dispatchMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/notif/dispatchers.js', () => ({
  dispatch: (...args: unknown[]) => dispatchMock(...args),
}));

const { sendMessage, listMessages } = await import('../../src/game/messages.js');

describe.skipIf(skipIfNoDb)('messages', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await freshDb();
    dispatchMock.mockClear();
  });

  it('sends and lists a per-match message', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const bob = await seedUser(env.db, { displayName: 'Bob' });
    const match = await seedMatch(env.db, alice.userId, bob.userId, { sbOfRound1: alice.userId });

    const sent = await sendMessage(env.db, match.matchId, alice.userId, 'hello bob');
    expect(sent.body).toBe('hello bob');
    expect(sent.hand_id).toBeNull();
    expect(sent.from_user_id).toBe(alice.userId);

    // Dispatch should have been called once with chat_message + the truncated body.
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const [, notif] = dispatchMock.mock.calls[0] as [unknown, { kind: string; toUserId: string; messageBody: string }];
    expect(notif.kind).toBe('chat_message');
    expect(notif.toUserId).toBe(bob.userId);
    expect(notif.messageBody).toBe('hello bob');

    const list = await listMessages(env.db, match.matchId, alice.userId);
    expect(list).toHaveLength(1);
    expect(list[0].message_id).toBe(sent.message_id);
  });

  it('per-hand sidebar surfaces only hand-scoped messages, but match thread sees both', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const bob = await seedUser(env.db, { displayName: 'Bob' });
    const match = await seedMatch(env.db, alice.userId, bob.userId, { sbOfRound1: alice.userId });
    const round = await seedRound(env.db, match.matchId, {
      sbUserId: alice.userId, bbUserId: bob.userId,
    });
    const h = await seedHand(env.db, round.roundId, { status: 'complete', terminalReason: 'fold', winnerUserId: alice.userId, street: 'complete' });

    await sendMessage(env.db, match.matchId, alice.userId, 'on this hand', h.handId);
    await sendMessage(env.db, match.matchId, bob.userId, 'general chat');

    const handThread = await listMessages(env.db, match.matchId, alice.userId, { handId: h.handId });
    expect(handThread).toHaveLength(1);
    expect(handThread[0].body).toBe('on this hand');

    const matchThread = await listMessages(env.db, match.matchId, alice.userId);
    expect(matchThread.map(m => m.body).sort()).toEqual(['general chat', 'on this hand']);
  });

  it('rejects non-participants', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const bob = await seedUser(env.db, { displayName: 'Bob' });
    const intruder = await seedUser(env.db, { displayName: 'Charlie' });
    const match = await seedMatch(env.db, alice.userId, bob.userId, { sbOfRound1: alice.userId });

    await expect(sendMessage(env.db, match.matchId, intruder.userId, 'lol'))
      .rejects.toThrow('Not a participant');
    await expect(listMessages(env.db, match.matchId, intruder.userId))
      .rejects.toThrow('Not a participant');
  });

  it('rejects empty / oversized bodies', async () => {
    const alice = await seedUser(env.db, { displayName: 'Alice' });
    const bob = await seedUser(env.db, { displayName: 'Bob' });
    const match = await seedMatch(env.db, alice.userId, bob.userId, { sbOfRound1: alice.userId });

    await expect(sendMessage(env.db, match.matchId, alice.userId, '   '))
      .rejects.toThrow('Message body cannot be empty');
    await expect(sendMessage(env.db, match.matchId, alice.userId, 'x'.repeat(501)))
      .rejects.toThrow('exceeds');
  });
});
