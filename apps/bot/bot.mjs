// Practice Bot — a headless opponent for local end-to-end testing.
//
// It's just another API client: it signs in as the seeded Practice Bot
// user via the debug-auth route, polls its matches, and for every turn
// where action is on it, submits a whole turn as one all-or-nothing batch
// (POST /v1/turn/submit) — budget-aware so it never over-commits the
// shared stack. It also auto-challenges anyone without an active bot match
// and advances finished rounds, so from your phone the bot "just appears"
// as a match you can play. No dependencies — Node 20 globals only.
//
// Config (env):
//   SERVER_URL        default http://localhost:3000
//   BOT_USER_ID       default b07b07b0-0000-4000-8000-000000000b07 (seeded)
//   POLL_INTERVAL_MS  default 3000
//   BOT_AGGRESSION    0..1, default 0.35 (higher = more folds & bets/raises)
//   BOT_AUTO_CHALLENGE default true
//   BOT_ADVANCE_ROUNDS default true

const SERVER_URL = (process.env.SERVER_URL || 'http://localhost:3000').replace(/\/$/, '');
const BOT_USER_ID = process.env.BOT_USER_ID || 'b07b07b0-0000-4000-8000-000000000b07';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 3000);
const AGGRESSION = clamp01(Number(process.env.BOT_AGGRESSION ?? 0.35));
const AUTO_CHALLENGE = (process.env.BOT_AUTO_CHALLENGE ?? 'true') !== 'false';
const ADVANCE_ROUNDS = (process.env.BOT_ADVANCE_ROUNDS ?? 'true') !== 'false';

let token = null;

function clamp01(n) { return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.35; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function log(...args) { console.log(new Date().toISOString(), '[bot]', ...args); }

async function api(method, path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg = data?.message || text || res.statusText;
    const err = new Error(`${method} ${path} → ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}
function safeJson(t) { try { return JSON.parse(t); } catch { return null; } }

async function login() {
  // Retry until the server is up and migrations/seed have run.
  for (;;) {
    try {
      const auth = await api('POST', '/v1/auth/debug/select', { user_id: BOT_USER_ID });
      token = auth.token;
      log(`signed in as ${auth.display_name} (${BOT_USER_ID})`);
      return;
    } catch (err) {
      log(`waiting for server… (${err.message})`);
      await sleep(2000);
    }
  }
}

// ── Decision policy (budget-aware, configurable aggression) ─────────────

function chooseAction(legal, remaining) {
  const acts = new Set(legal.actions);
  const facing = legal.call_amount > 0 || acts.has('call');
  const foldChance = 0.12 + AGGRESSION * 0.35;

  if (facing) {
    // Can't afford the call → fold (or fold-equivalent all-in isn't worth it here).
    if (legal.call_amount > remaining) {
      return acts.has('fold') ? act('fold') : (acts.has('all_in') ? act('all_in', remaining) : act('call', legal.call_amount));
    }
    if (acts.has('fold') && Math.random() < foldChance) return act('fold');
    if (acts.has('raise') && legal.min_raise <= remaining && Math.random() < AGGRESSION * 0.5) {
      const cap = Math.min(legal.max_bet, remaining);
      const amount = Math.max(legal.min_raise, Math.min(cap, Math.floor(legal.min_raise * (1 + Math.random()))));
      return act('raise', amount, amount);
    }
    return act('call', undefined, legal.call_amount);
  }

  // Not facing a bet.
  if (acts.has('bet') && legal.min_raise <= remaining && Math.random() < AGGRESSION * 0.5) {
    const cap = Math.min(legal.max_bet, remaining);
    // Small-ish bet: min bet up to ~half the pot, within budget.
    const target = Math.max(legal.min_raise, Math.floor(legal.pot_size / 2) || legal.min_raise);
    const amount = Math.max(legal.min_raise, Math.min(cap, target));
    return act('bet', amount, amount);
  }
  return acts.has('check') ? act('check') : act('fold');
}

function act(type, amount, cost = 0) {
  return { type, amount, cost };
}

async function playTurn(match) {
  const round = match.current_round;
  const pending = round.hands.filter((h) => h.status === 'in_progress' && h.action_on_me);
  if (pending.length === 0) return;

  let remaining = match.my_available;
  const actions = [];

  // Decide most-expensive-to-call first so a tight budget folds the
  // priciest spots rather than randomly busting the batch.
  const ordered = [...pending].sort((a, b) => (b.opponent_reserved - b.my_reserved) - (a.opponent_reserved - a.my_reserved));

  for (const hand of ordered) {
    let legal;
    try {
      legal = await api('GET', `/v1/hand/${hand.hand_id}/legal-actions`);
    } catch {
      continue;
    }
    if (!legal.actions || legal.actions.length === 0) continue;

    let choice = chooseAction(legal, remaining);
    // Safety: never queue more than the remaining budget.
    if (choice.cost > remaining) {
      choice = legal.actions.includes('fold') ? act('fold')
        : (legal.actions.includes('check') ? act('check') : choice);
    }
    remaining -= choice.cost;
    actions.push({
      hand_id: hand.hand_id,
      type: choice.type,
      ...(choice.amount != null ? { amount: choice.amount } : {}),
      client_tx_id: crypto.randomUUID(),
    });
  }

  if (actions.length === 0) return;

  const summary = actions.map((a) => `${a.type}${a.amount != null ? ' ' + a.amount : ''}`).join(', ');
  try {
    await api('POST', '/v1/turn/submit', {
      round_id: round.round_id,
      turn_tx_id: crypto.randomUUID(),
      actions,
    });
    log(`vs ${match.opponent.display_name}: played ${actions.length} hand(s) — ${summary}`);
  } catch (err) {
    // All-or-nothing rejected (e.g. a rare budget miss). Retry with the
    // safe, zero-cost move on every hand so the turn always clears.
    log(`submit rejected (${err.message}); retrying safe (check/fold)`);
    const safe = pending.map((h) => ({
      hand_id: h.hand_id,
      type: (h.opponent_reserved > h.my_reserved) ? 'fold' : 'check',
      client_tx_id: crypto.randomUUID(),
    }));
    try {
      await api('POST', '/v1/turn/submit', { round_id: round.round_id, turn_tx_id: crypto.randomUUID(), actions: safe });
      log(`vs ${match.opponent.display_name}: played safe on ${safe.length} hand(s)`);
    } catch (err2) {
      log(`safe submit also failed: ${err2.message}`);
    }
  }
}

async function autoChallenge(myMatches) {
  const haveMatchWith = new Set(myMatches.map((m) => m.opponent.user_id));
  let users;
  try {
    users = await api('GET', '/v1/users');
  } catch {
    return;
  }
  for (const u of users) {
    if (haveMatchWith.has(u.user_id)) continue;
    try {
      await api('POST', '/v1/match', { opponent_user_id: u.user_id });
      log(`challenged ${u.display_name} to a new match`);
    } catch (err) {
      // Already-active pair, etc. — ignore.
      if (err.status !== 422 && err.status !== 409) log(`challenge ${u.display_name} skipped: ${err.message}`);
    }
  }
}

async function tick() {
  let matches;
  try {
    matches = await api('GET', '/v1/matches');
  } catch (err) {
    if (err.status === 401) { await login(); return; }
    log(`poll error: ${err.message}`);
    return;
  }

  if (AUTO_CHALLENGE) await autoChallenge(matches);

  for (const match of matches) {
    const round = match.current_round;
    if (!round) continue;
    if (ADVANCE_ROUNDS && round.status === 'revealing') {
      try {
        await api('POST', `/v1/round/${round.round_id}/advance`);
        log(`vs ${match.opponent.display_name}: advanced round ${round.round_index}`);
      } catch (err) {
        log(`advance failed: ${err.message}`);
      }
      continue;
    }
    if (round.hands_pending_me > 0) {
      await playTurn(match);
    }
  }
}

async function main() {
  log(`starting — server=${SERVER_URL} aggression=${AGGRESSION} poll=${POLL_INTERVAL_MS}ms`);
  await login();
  for (;;) {
    try {
      await tick();
    } catch (err) {
      log(`tick error: ${err.message}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

main();
