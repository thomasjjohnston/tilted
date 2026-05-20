// Verifies the API serialization gate for folded hands:
//   - opponent's view of the hand: opponent_hole === null
//   - folder's own view: my_hole still contains the 2 cards
//   - history view: same gate applies

import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedBaseScenario, skipIfNoDb, type TestEnv } from './helpers.js';
import { applyAction } from '../../src/game/turn.js';
import { getHandDetail } from '../../src/game/hand.js';
import { getMatchState } from '../../src/game/match.js';
import { getHistory } from '../../src/game/history.js';

describe.skipIf(skipIfNoDb)('API redacts folded cards from opponent view', () => {
  let env: TestEnv;
  beforeEach(async () => { env = await freshDb(); });

  it('hides folder cards from opponent in getHandDetail, but exposes them to the folder', async () => {
    const s = await seedBaseScenario(env.db);
    await applyAction(env.db, {
      handId: s.handId,
      userId: s.alice.userId,
      actionType: 'fold',
      amount: 0,
      clientTxId: 'redact-1',
    });

    // Alice (folder) sees her own cards.
    const aliceView = await getHandDetail(env.db, s.handId, s.alice.userId);
    expect(aliceView.my_hole).toEqual(['Ah', 'Ks']);
    // Opponent (bob) hole isn't revealed for a fold-terminated hand.
    expect(aliceView.opponent_hole).toBeNull();

    // Bob (opponent of folder) sees his own cards.
    const bobView = await getHandDetail(env.db, s.handId, s.bob.userId);
    expect(bobView.my_hole).toEqual(['Qd', 'Jc']);
    // Alice's cards are gated — Bob never sees them on a fold.
    expect(bobView.opponent_hole).toBeNull();
  });

  it('hides folder cards from opponent in match-state hand views', async () => {
    const s = await seedBaseScenario(env.db);
    await applyAction(env.db, {
      handId: s.handId,
      userId: s.alice.userId,
      actionType: 'fold',
      amount: 0,
      clientTxId: 'redact-match-state',
    });

    const aliceMatch = await getMatchState(env.db, s.matchId, s.alice.userId);
    const aliceHand = aliceMatch.current_round?.hands.find(h => h.hand_id === s.handId);
    expect(aliceHand?.my_hole).toEqual(['Ah', 'Ks']);
    expect(aliceHand?.opponent_hole).toBeNull();

    const bobMatch = await getMatchState(env.db, s.matchId, s.bob.userId);
    const bobHand = bobMatch.current_round?.hands.find(h => h.hand_id === s.handId);
    expect(bobHand?.my_hole).toEqual(['Qd', 'Jc']);
    expect(bobHand?.opponent_hole).toBeNull();
  });

  it('hides folder cards from history for the opponent', async () => {
    const s = await seedBaseScenario(env.db);
    await applyAction(env.db, {
      handId: s.handId,
      userId: s.alice.userId,
      actionType: 'fold',
      amount: 0,
      clientTxId: 'redact-history',
    });

    const aliceHistory = await getHistory(env.db, s.alice.userId, {
      favoritesOnly: false, result: 'all', limit: 20,
    });
    expect(aliceHistory.hands).toHaveLength(1);
    expect(aliceHistory.hands[0].my_hole).toEqual(['Ah', 'Ks']);
    expect(aliceHistory.hands[0].opponent_hole).toBeNull();

    const bobHistory = await getHistory(env.db, s.bob.userId, {
      favoritesOnly: false, result: 'all', limit: 20,
    });
    expect(bobHistory.hands).toHaveLength(1);
    expect(bobHistory.hands[0].my_hole).toEqual(['Qd', 'Jc']);
    expect(bobHistory.hands[0].opponent_hole).toBeNull();
  });
});
