# Local end-to-end testing (device vs. Practice Bot)

Play real matches from your iPhone against an automated **Practice Bot**, with
the whole backend running on your laptop in Docker. Nothing touches production.

```
┌────────────┐   http (LAN)   ┌──────────────────────── docker compose ─────────────┐
│  iPhone    │ ─────────────▶ │  server  ⇄  postgres          bot (polls & plays) ──┐│
│ (DEBUG app)│ ◀───────────── │  :3000 (0.0.0.0)                                     ││
└────────────┘                │            ▲───────────────────────────────────────┘│
                              └───────────────────────────────────────────────────────┘
```

The bot is just another API client — it signs in as a seeded user, auto-creates
a match with anyone who signs in, and plays each of its turns via the batch
`POST /v1/turn/submit`. See `apps/bot/bot.mjs`.

## Prerequisites

- Docker Desktop running.
- Your Mac and iPhone on the **same Wi-Fi**.
- Xcode (to run a DEBUG build on your device).

## 1. Start the stack

```bash
docker compose up --build          # server + postgres + bot
```

On boot the server runs migrations and seeds three users (Thomas Johnston,
Stephen Layton, **Practice Bot**). You'll see the bot sign in and start
polling. Sanity check:

```bash
curl http://localhost:3000/healthz            # {"ok":true,...}
docker compose logs -f bot                    # watch it play
```

## 2. Find your Mac's LAN IP

```bash
ipconfig getifaddr en0        # Wi-Fi; try en1 if blank
```

e.g. `192.168.1.42` → your server URL is `http://192.168.1.42:3000`.

## 3. Point the app at your laptop

Run the app on your device from Xcode (a **Debug** build). Then either:

- **From the sign-in screen:** tap the small "Server: production" line at the
  bottom → enter `http://<your-ip>:3000` → **Apply**, or
- **If already signed in:** Settings → **Debug · Server** → enter the URL →
  **Apply & sign out**.

The override is DEBUG-only and persists across launches. Blank = production.

## 4. Sign in and play

Sign in with Apple as usual — this creates your user on the *local* server. The
bot's next poll (a few seconds) auto-creates a match, so **a match vs Practice
Bot just appears** on your home screen. Play your turn; the bot responds within
a few seconds. It also advances finished rounds so play never stalls.

## Tuning the bot

Set these in `docker-compose.yml` under the `bot` service, then
`docker compose up -d bot`:

| Env | Default | Meaning |
|-----|---------|---------|
| `BOT_AGGRESSION` | `0.35` | 0–1. Higher = more folds, bets & raises. `0` ≈ calling station. |
| `POLL_INTERVAL_MS` | `3000` | How often the bot checks for its turn. |
| `BOT_AUTO_CHALLENGE` | `true` | Auto-create a match with anyone who signs in. |
| `BOT_ADVANCE_ROUNDS` | `true` | Advance finished rounds automatically. |

## Reset / teardown

```bash
docker compose down            # stop (keeps the DB volume)
docker compose down -v         # stop and wipe all local data
```

## Notes

- The server binds `0.0.0.0` and ATS allows plain `http`, so the device reaches
  it directly — no tunnel needed.
- The bot uses the `POST /v1/auth/debug/select` route to get a bearer. That
  route is currently open in production too — a follow-up should gate it to
  non-prod (`NODE_ENV !== 'production'`).
- The seeded "Thomas Johnston" / "Stephen Layton" users are separate from the
  Apple account you sign in with; the bot will challenge them too, but those
  matches just sit idle. Harmless.
