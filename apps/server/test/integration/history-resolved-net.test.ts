// Verifies history + hand-detail expose per-user net (not raw pot) and
// fold_street, and that a hand the user lost never reads as a positive
// net (beta feedback S7-3: "+0/-0", full-pot amounts, wins-that-were-losses).

import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedBaseScenario, skipIfNoDb, type TestEnv } from './helpers.js';
import { applyAction } from '../../src/game/turn.js';
import { getHistory } from '../../src/game/history.js';
import { getHandDetail } from '../../src/game/hand.js';

describe.skipIf(skipIfNoDb)('history + detail expose net and fold_street', () => {
  let env: TestEnv;
  beforeEach(async () => { env = await freshDb(); });

  it('reports signed net per user and fold_street for a preflop fold', async () => {
    const s = await seedBaseScenario(env.db); // alice SB(5), bob BB(10), pot 15
    await applyAction(env.db, {
      handId: s.handId, userId: s.alice.userId, actionType: 'fold', amount: 0, clientTxId: 'net-fold',
    });

    // Alice folded her 5-chip blind → net -5. Bob won → net +5. Neither is the pot (15).
    const aliceHist = await getHistory(env.db, s.alice.userId, { favoritesOnly: false, result: 'all', limit: 20 });
    expect(aliceHist.hands[0].my_resolved_net).toBe(-5);
    expect(aliceHist.hands[0].fold_street).toBe('preflop');

    const bobHist = await getHistory(env.db, s.bob.userId, { favoritesOnly: false, result: 'all', limit: 20 });
    expect(bobHist.hands[0].my_resolved_net).toBe(5);

    // Detail agrees, per user (list/detail can't disagree on win vs loss).
    const aliceDetail = await getHandDetail(env.db, s.handId, s.alice.userId);
    expect(aliceDetail.my_resolved_net).toBe(-5);
    expect(aliceDetail.fold_street).toBe('preflop');
    const bobDetail = await getHandDetail(env.db, s.handId, s.bob.userId);
    expect(bobDetail.my_resolved_net).toBe(5);
  });
});
