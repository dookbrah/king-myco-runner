# king-myco-runner

Myco Quest adaptive AI game-core + ecosystem backend for King Myco.

## Implemented capability tiers

### Tier 1 - Adaptive gameplay core
- Player modeling (skill, playstyle, novelty, mastery)
- Adaptive encounter sequencing
- Per-run procedural tuning
- Persistent RPG progression: morality, learned magic, and spores collected history

### Tier 2 - Ecosystem orchestration
- Unified identity across:
  - `mycokingdom_bot`
  - `mycoai_bot`
  - `kingdom.kingmyco.com`
  - `kingmyco.io`
  - `openclaw`
- Reward economy and streaks (spores are the only reward currency)
- Fraud scoring + quarantined leaderboard submissions

### Tier 3 - Production hardening + Web3
- Source token auth with per-source scopes
- Signed webhook verification (Telegram secret token + OpenClaw HMAC)
- Event stream analytics summary endpoint
- Postgres/Redis adapter for persisted state snapshots + events
- Solana wallet challenge + signature verification
- Solana reward claim pipeline (spores -> lamports) with deterministic MYCO burn-equivalent accounting and refund-on-failure
- Automated settlement worker for prepared/submitted transfer intents

## Architecture map

- `src/ai/*` - adaptive difficulty and personalization engine
- `src/platform/repository.ts` - state repository with file + PG/Redis adapter integration
- `src/platform/postgresRedisAdapter.ts` - SQL/cache persistence bridge
- `src/platform/rewardEconomy.ts` - spores, streaks, anti-grind economics
- `src/platform/fraudGuard.ts` - anti-exploit risk detection
- `src/platform/analytics.ts` - event stream aggregation
- `src/platform/auth.ts` - source token and scope validation
- `src/platform/webhookVerifier.ts` - webhook signature checking
- `src/platform/solanaService.ts` - Solana wallet verification + transfer intent prep
- `src/platform/ecosystemHub.ts` - central orchestration layer
- `src/server.ts` - API surface

## API endpoints

### Health
- `GET /health`

### Identity and gameplay
- `POST /api/identity/link`
- `POST /api/run/generate`
- `POST /api/session/record`
- `POST /api/mycoai/coach`
- `GET /api/player/:playerId`

### Leaderboard and live ops
- `GET /api/leaderboard/:mode`
- `GET /api/liveops`
- `POST /api/liveops` (admin key)

### Analytics
- `GET /api/analytics/summary` (admin key)
- `GET /api/ecosystem/communication` (admin key)
- `POST /api/ecosystem/heartbeat/pulse` (admin key)

### Webhooks
- `POST /webhooks/mycokingdom_bot`
- `POST /webhooks/mycoai_bot`
- `POST /webhooks/openclaw`

### Solana (Web3)
- `POST /api/solana/challenge`
- `POST /api/solana/verify-link`
- `GET /api/solana/wallet/:walletAddress`
- `POST /api/solana/rewards/claim`
- `GET /api/solana/rewards/intents` (admin key)
- `POST /api/solana/rewards/process` (admin key)
- `POST /api/solana/rewards/prepare` (admin key)
- `POST /api/solana/rewards/status` (admin key)

## Wallet verification flow

1. Call `POST /api/solana/challenge` with source/externalId/wallet.
2. Player signs `message` returned in challenge response.
3. Call `POST /api/solana/verify-link` with signed payload.
4. Wallet is now trusted for reward redemption.

Challenges are one-time and expire automatically.

Session telemetry can also include optional RPG fields:
- `sporesCollected` (explicit in-game collection amount)
- `morality.compassionateActions` / `morality.ruthlessActions`
- `magic.castsByElement` and `magic.ritualsCompleted`

## Solana reward claim flow

1. Verified player calls `POST /api/solana/rewards/claim` with `sporesToRedeem`.
2. Optional idempotency protection: send `idempotencyKey` (or `x-idempotency-key`) to prevent duplicate debit on retries.
3. Backend enforces live-ops claim guardrails (`claimCooldownSec`, `maxDailySporeRedeem`).
4. Backend evaluates adaptive risk score (player/IP) and can temporarily hard-block high-risk claimants.
5. Backend applies redemption velocity throttles (wallet/hour, IP/hour, and unique-wallets-per-IP/day) using risk-tightened effective limits.
6. Backend converts spores to lamports via `sporeToLamportsRate` in live ops.
7. Backend computes MYCO burn-equivalent via `mycoBurnPerSpore` (default `0.25` MYCO burned per spore burned).
8. Backend creates unsigned transfer intent and debits spores immediately.
9. Settlement service updates result using `POST /api/solana/rewards/status` or `POST /api/solana/rewards/process`.
10. If status becomes `failed`, spores are automatically refunded (including daily cap ledger rollback).

## Ecosystem communication diagnostics

Use `GET /api/ecosystem/communication` to confirm that all ecosystem surfaces are actively communicating.

Optional query params:
- `windowMinutes` (default `120`)
- `minEventsPerSource` (default `1`)
- `limit` (default `1000`, max `2000`)

The response includes per-source event counts, last-seen timestamps, observed event types, and a global `allSourcesActive` boolean.

Manual heartbeat pulse example:
- `POST /api/ecosystem/heartbeat/pulse` with optional `{ "sources": ["kingmyco.io", "openclaw"], "eventName": "ecosystem_heartbeat" }`

## Security model

### Source auth
Provide `KINGMYCO_SOURCE_AUTH_JSON` to enforce per-source bearer tokens and scopes via `x-source-token`.

Example:

```json
{
  "mycokingdom_bot": { "token": "token-a", "scopes": ["identity:write", "session:write", "webhook:ingest"] },
  "mycoai_bot": { "token": "token-b", "scopes": ["coach:read", "identity:write", "webhook:ingest"] },
  "kingmyco.io": { "token": "token-c", "scopes": ["identity:write", "run:generate", "session:write", "solana:verify", "solana:reward:prepare"] },
  "kingdom.kingmyco.com": { "token": "token-d", "scopes": ["identity:write", "run:generate", "session:write"] },
  "openclaw": { "token": "token-e", "scopes": ["session:write", "run:generate", "solana:reward:prepare", "solana:reward:update", "webhook:ingest"] }
}
```

### Webhook verification
- Telegram: `KINGMYCO_TELEGRAM_WEBHOOK_SECRET`
- OpenClaw: `OPENCLAW_WEBHOOK_SECRET`

### Admin routes
- `x-admin-key` must match `KINGMYCO_ADMIN_KEY`

## Solana configuration

- `SOLANA_RPC_URL` (default `https://api.mainnet-beta.solana.com`)
- `KINGMYCO_TREASURY_WALLET` (treasury fee payer wallet; required for remote signer mode)
- `KINGMYCO_TREASURY_SIGNER_MODE` (`local-secret` or `remote-hsm`, default `local-secret`)
- `KINGMYCO_TREASURY_SECRET` (local signer secret key; required in `local-secret` mode)
- `KINGMYCO_TREASURY_SIGNER_ENDPOINT` (required in `remote-hsm` mode)
- `KINGMYCO_TREASURY_SIGNER_BEARER_TOKEN` (optional auth token for remote signer endpoint)
- `KINGMYCO_TREASURY_SIGNER_TIMEOUT_MS` (optional timeout for remote signer requests)
- `KINGMYCO_SOLANA_CHALLENGE_TTL_MS` (optional challenge TTL)

## Live ops Web3 tuning fields

- `mycoBurnPerSpore` (default `0.25`)
- `sporeToLamportsRate`
- `minSporesPerClaim`
- `maxSporesPerClaim`
- `claimCooldownSec`
- `maxDailySporeRedeem`
- `maxClaimsPerHourPerWallet`
- `maxClaimsPerHourPerIp`
- `maxUniqueWalletsPerIpPerDay`
- `riskScoreDecayPerHour`
- `riskThrottleWeight`
- `riskHardBlockThreshold`

## Remote signer contract (HSM/KMS gateway)

When `KINGMYCO_TREASURY_SIGNER_MODE=remote-hsm`, the backend calls your signer endpoint with:

```json
{
  "unsignedTransactionBase64": "...",
  "treasuryWallet": "..."
}
```

Expected response:

```json
{
  "signedTransactionBase64": "..."
}
```

The returned transaction must include a valid signature for `treasuryWallet`.

## Settlement worker

Run `npm run start:settlement-worker` to continuously:

1. submit prepared intents (`prepared -> submitted`)
2. reconcile submitted signatures (`submitted -> settled/failed`)

Worker tuning env vars:
- `KINGMYCO_SETTLEMENT_POLL_MS`
- `KINGMYCO_SETTLEMENT_PREPARED_BATCH`
- `KINGMYCO_SETTLEMENT_SUBMITTED_BATCH`
- `KINGMYCO_SETTLEMENT_DRY_RUN`

Operator helper endpoints:
- `GET /api/solana/rewards/intents?status=prepared&limit=20`
- `POST /api/solana/rewards/process`

Claim request metadata (optional):
- `clientIp` in body (otherwise inferred from proxy headers/remote address)
- `x-client-fingerprint` header or `clientFingerprint` body field

## Heartbeat worker

Run `npm run start:heartbeat-worker` to continuously emit ecosystem heartbeat events for communication health.

Heartbeat worker env vars:
- `KINGMYCO_HEARTBEAT_POLL_MS` (default `60000`)
- `KINGMYCO_HEARTBEAT_SOURCES` (comma-separated source list, defaults to all ecosystem sources)
- `KINGMYCO_HEARTBEAT_EVENT_NAME` (default `ecosystem_heartbeat`)
- `KINGMYCO_HEARTBEAT_INSTANCE` (default `default`)
- `KINGMYCO_HEARTBEAT_DRY_RUN` (`true`/`false`, default `false`)

## Persistence options

By default, state is persisted to local JSON via `KINGMYCO_STATE_PATH`.

Optional adapter settings:
- `KINGMYCO_PG_URL` - postgres connection string
- `KINGMYCO_REDIS_URL` - redis connection string

When configured, snapshots and events are mirrored to Postgres/Redis.

## Scripts

- `npm run demo` - adaptive behavior simulation
- `npm run test` - unit tests
- `npm run build` - TypeScript compile
- `npm run start:api` - launch API server
- `npm run start:api:prod` - run compiled API server
- `npm run start:settlement-worker` - run automated Solana settlement loop
- `npm run start:settlement-worker:prod` - run compiled settlement worker
- `npm run start:heartbeat-worker` - run ecosystem heartbeat loop
- `npm run start:heartbeat-worker:prod` - run compiled heartbeat worker
- `npm run playground` - start a live local dev playground loop (API + heartbeat + sample game sessions)

### Local dev playground (single command)

Use this to immediately generate adaptive runs and session telemetry while you tune game systems:

```bash
npm run playground
```

Useful playground env overrides:
- `PLAYGROUND_PLAYER_ID` (default `dev-playground-player`)
- `PLAYGROUND_SOURCE` (default `kingmyco.io`)
- `PLAYGROUND_INTERVAL_SEC` (default `12`)
- `PLAYGROUND_TICKS` (default `0`, infinite loop when `0`)
- `PLAYGROUND_REUSE_EXISTING_API` (default `true`)
- `PLAYGROUND_REUSE_EXISTING_HEARTBEAT` (default `true`)
- `PLAYGROUND_SOURCE_TOKEN` (optional, if source auth is enabled for the selected source)


## Production deployment (kingmyco.io)

### 1) Prepare environment

1. Copy env template: `cp .env.example .env`
2. Fill production secrets in `.env` (admin key, source auth, treasury signer, webhook secrets).
3. Ensure DNS for `kingmyco.io` points at your host/load balancer.

### 2) Build and run with Docker Compose

```bash
docker compose up -d --build api heartbeat-worker
```

Optional settlement worker:

```bash
docker compose --profile settlement up -d settlement-worker
```

### 3) Verify services

```bash
curl http://127.0.0.1:3000/health
curl -H "x-admin-key: $KINGMYCO_ADMIN_KEY" "http://127.0.0.1:3000/api/ecosystem/communication?windowMinutes=15&minEventsPerSource=1"
```

### 4) Reverse proxy / TLS

Terminate TLS in your ingress/proxy (Nginx, Caddy, Cloudflare tunnel, etc.) and forward traffic to `api:3000`.
Set host policy/rules so only `https://kingmyco.io` is publicly exposed.

### CI/deploy stub

A starter GitHub Actions workflow is provided at:
- `.github/workflows/ci-deploy-stub.yml`

It runs tests/build/docker build on PRs and main pushes, then optionally calls a deploy webhook if `KINGMYCO_DEPLOY_WEBHOOK_URL` secret is set.


## Provider-specific deployment blueprints (all included)

### Railway

- Config file: `railway.json`
- Deploy target: Dockerfile-based service
- Suggested service split:
  - API service command: `npm run start:api:prod`
  - Heartbeat worker command: `npm run start:heartbeat-worker:prod`
  - Settlement worker command: `npm run start:settlement-worker:prod`
- One-click from `main` (optional): set GitHub secret `RAILWAY_DEPLOY_HOOK` for `.github/workflows/deploy-providers-stub.yml`

### Render

- Config file: `render.yaml`
- Defines:
  - `kingmyco-api` web service
  - `kingmyco-heartbeat-worker` worker
  - `kingmyco-settlement-worker` worker
- One-click from `main` (optional): set GitHub secret `RENDER_DEPLOY_HOOK`

### Fly.io

- Config file: `fly.toml`
- Process groups included:
  - `app`
  - `heartbeat`
  - `settlement`
- One-click from `main` (optional):
  - GitHub secret: `FLY_API_TOKEN`
  - GitHub variable: `FLY_APP_NAME`

### EC2 + Nginx

- Config folder: `deploy/ec2/`
- Includes:
  - `deploy/ec2/deploy.sh`
  - `deploy/ec2/nginx.kingmyco.io.conf`
  - `deploy/ec2/systemd/kingmyco-stack.service`
  - `deploy/ec2/README.md`
- One-click from `main` (optional):
  - GitHub secrets: `EC2_SSH_HOST`, `EC2_SSH_USER`, `EC2_SSH_KEY`

### Unified provider deploy workflow

Workflow file: `.github/workflows/deploy-providers-stub.yml`

Behavior:
- Triggers on pushes to `main` and manual dispatch.
- Runs provider-specific deploy jobs only when the required secrets/vars are present.
- Safely no-ops for providers not yet configured.
