# king-myco-runner

Myco Quest adaptive AI game-core + ecosystem hub.

## What is implemented now

This repository now includes both:

1. **Adaptive run generation core** for Myco Quest
2. **Ecosystem integration backend** for cross-platform identity + progression

## Ecosystem connection model

The backend supports linking one player identity across:

- `mycokingdom_bot` (Telegram gameplay bot)
- `mycoai_bot` (AI coaching bot)
- `kingdom.kingmyco.com` (web app)
- `kingmyco.io` (hub + games)
- `openclaw` (external gameplay integration)

## Core architecture

- `src/ai/playerModel.ts` - updates player skill/playstyle/mastery from telemetry
- `src/ai/adaptiveDirector.ts` - active-learning run planner per player
- `src/quest/catalog.ts` - encounter blueprints
- `src/platform/repository.ts` - persistent JSON state (profiles, wallets, identities, leaderboards)
- `src/platform/rewardEconomy.ts` - spores, streaks, multipliers, anti-grind penalties
- `src/platform/fraudGuard.ts` - anti-exploit heuristics + quarantine decisions
- `src/platform/leaderboard.ts` - high-score integrity + quarantined submissions
- `src/platform/ecosystemHub.ts` - orchestration service
- `src/server.ts` - HTTP API surface

## Active learning loop

1. Generate personalized run from profile + prior outcomes.
2. Capture telemetry from gameplay.
3. Evaluate fraud/anomaly risk.
4. If valid: update profile, award spores, update leaderboard.
5. Use profile deltas to alter next run composition and difficulty.
6. Expose coaching guidance through `mycoai_bot` endpoint.

## API endpoints

### Health
- `GET /health`

### Identity + progression
- `POST /api/identity/link`
- `POST /api/run/generate`
- `POST /api/session/record`
- `GET /api/player/:playerId`

### Competitive + economy
- `GET /api/leaderboard/:mode`

### AI coaching
- `POST /api/mycoai/coach`

### LiveOps tuning
- `GET /api/liveops`
- `POST /api/liveops` (requires `x-admin-key`)

## Environment variables

- `PORT` - API port (default `3000`)
- `KINGMYCO_STATE_PATH` - JSON persistence path (default `data/kingmyco-state.json`)
- `KINGMYCO_ADMIN_KEY` - key for protected LiveOps update endpoint

## Scripts

- `npm run demo` - run adaptation demo in terminal
- `npm run test` - run tests
- `npm run build` - compile TypeScript
- `npm run start:api` - run integration API server

## Next product steps (recommended)

1. Add signed webhook verification for Telegram and OpenClaw ingress.
2. Replace JSON store with Postgres + Redis for multi-instance scale.
3. Add wallet-verified reward claims pipeline before on-chain settlement.
4. Introduce experiment buckets for controlled live-ops A/B tuning.
