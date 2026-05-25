# AGENTS.md

## Cursor Cloud specific instructions

### Overview

**king-myco-runner** is a Node.js 22 / TypeScript backend for the "Myco Quest" adaptive AI game engine. It uses a vanilla `node:http` server (no Express/Fastify). ESLint (`eslint.config.mjs`) and Prettier (`.prettierrc.json`) are configured; `npm run lint` runs ESLint and `npm run build` runs `tsc` for type-checking.

### Key commands

See `package.json` scripts for the full list. The most important ones:

| Command | Purpose |
|---|---|
| `npm install` | Install dependencies |
| `npm run build` | TypeScript compile (`tsc`) — type-checking |
| `npm run lint` | ESLint quality gate (strict, zero warnings) |
| `npm run test` | Vitest unit tests (28 tests across 3 files) |
| `npm run start:api` | Start API server in dev mode (port 3000, uses `tsx`) |
| `npm run playground` | Full local dev loop (API + heartbeat + mock game sessions) |

### Running the API server

1. Copy `.env.example` to `.env` and set `NODE_ENV=development` and `KINGMYCO_ADMIN_KEY=dev-admin-key`.
2. Run `npm run start:api` — the server starts on port 3000.
3. Postgres and Redis are **optional**; the app falls back to local JSON file persistence (`data/kingmyco-state.json`) when `KINGMYCO_PG_URL` and `KINGMYCO_REDIS_URL` are unset.
4. Solana features are optional and work in degraded mode without real keys.

### Dev UIs

- `http://127.0.0.1:3000/dev/myco-quest` — interactive dev playground + HUD
- `http://127.0.0.1:3000/game/myco-quest` — visual game-style view

### Ecosystem surfaces

All 5 surfaces connect through the hub's identity graph:

| Surface | Integration | Webhook route |
|---|---|---|
| `kingmyco.io` | Primary web client (game HTML) — REST API | N/A (CORS origin) |
| `mycokingdom_bot` | Telegram bot | `POST /webhooks/mycokingdom_bot` |
| `mycoai_bot` | Telegram AI coach bot | `POST /webhooks/mycoai_bot` |
| `kingdom.kingmyco.com` | Kingdom web app | `POST /webhooks/kingdom` |
| `openclaw` | OpenClaw platform (HMAC) | `POST /webhooks/openclaw` |

Webhook handlers parse user data and call `hub.linkIdentity()` to resolve/create players. Cross-surface merging happens via shared `claims` (e.g. same `walletAddress` or `telegramUserId` from different sources merges into one player).

### Gotchas

- The `SessionTelemetry.magic.ritualsCompleted` field is a `string[]` (ritual names), not a number.
- The `/api/session/record` endpoint expects a `telemetry` object (of type `SessionTelemetry`) nested inside the body, not flat fields.
- The `/api/run/generate` endpoint requires `externalId` in addition to `playerId` and `source`.
- No hot-reload is built into `tsx`; restart the process after code changes.
- Game HTML lanes (`speed`, `precision`, `tactical`, `survival`, `puzzle`) map to backend `ChallengeLane` values (`mobility`, `swarm`, `tactics`, `boss`, `puzzle`). The mapping is done client-side via `mapLaneToBackend()`.
- `requestBase()` in the game HTML puts `walletAddress` inside `claims` (not at top-level). All API calls that extend `IdentityLinkRequest` expect `claims.walletAddress`.
- Player-facing Solana reward intent status is at `GET /api/solana/rewards/my-intents?source=...&externalId=...` (no admin key required, scoped by player identity).
