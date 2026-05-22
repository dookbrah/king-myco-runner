#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/kingmyco-runner}"
BRANCH="${BRANCH:-cursor/myco-quest-ai-core-ae3a}"
APP_NAME="${APP_NAME:-king-myco-web}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://api.kingmyco.io}"
EXPECTED_SHA="${EXPECTED_SHA:-}"
SOURCE_TOKEN="${SOURCE_TOKEN:-}"
APP_PORT="${APP_PORT:-3000}"

assert_contains() {
  local label="$1"
  local haystack="$2"
  local needle="$3"

  if [[ "$haystack" != *"$needle"* ]]; then
    echo "❌ $label did not contain expected token: $needle"
    exit 1
  fi
}

wait_for_http() {
  local label="$1"
  local url="$2"
  local attempts="${3:-20}"
  local sleep_seconds="${4:-2}"
  local i=1

  while (( i <= attempts )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    echo "⏳ waiting for $label ($i/$attempts): $url"
    sleep "$sleep_seconds"
    ((i++))
  done

  echo "❌ timed out waiting for $label: $url"
  pm2 status "$APP_NAME" || true
  pm2 logs "$APP_NAME" --lines 60 --nostream || true
  return 1
}

validate_objective_chain_payload() {
  local label="$1"
  local payload_file="$2"
  node - "$label" "$payload_file" <<'NODE'
const [label, payloadFile] = process.argv.slice(2);
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(payloadFile, "utf8"));
if (!payload?.lastRun?.objective?.chainId) {
  throw new Error(`missing ${label} lastRun.objective.chainId`);
}
if (typeof payload?.lastRun?.objective?.chainStep !== "number") {
  throw new Error(`missing ${label} lastRun.objective.chainStep`);
}
if (!payload?.lastRun?.objective?.branch) {
  throw new Error(`missing ${label} lastRun.objective.branch`);
}
console.log(`✅ ${label} run objective chain fields present`);
NODE
}

run_generate_with_optional_token() {
  local label="$1"
  local base_url="$2"
  local output_file="$3"
  local status

  if [[ -n "$SOURCE_TOKEN" ]]; then
    status="$(curl -sS -o "$output_file" -w '%{http_code}' -X POST "$base_url/api/run/generate" \
      -H 'content-type: application/json' \
      -H "x-source-token: $SOURCE_TOKEN" \
      --data '{"source":"kingmyco.io","externalId":"finalize-check","encounters":6}')"
  else
    status="$(curl -sS -o "$output_file" -w '%{http_code}' -X POST "$base_url/api/run/generate" \
      -H 'content-type: application/json' \
      --data '{"source":"kingmyco.io","externalId":"finalize-check","encounters":6}')"
  fi

  if [[ "$status" == "200" ]]; then
    validate_objective_chain_payload "$label" "$output_file"
    return 0
  fi

  local body
  body="$(cat "$output_file")"
  if [[ "$status" =~ ^40[01]$ ]] && [[ "$body" == *"source token"* ]] && [[ -z "$SOURCE_TOKEN" ]]; then
    echo "⚠️  Skipping $label objective-chain validation: source token required. Set SOURCE_TOKEN to enforce this check."
    return 0
  fi

  echo "❌ $label /api/run/generate returned status $status"
  echo "$body"
  return 1
}

echo "==> Syncing repository"
cd "$REPO_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

HEAD_SHA="$(git rev-parse --short HEAD)"
echo "HEAD_SHA=$HEAD_SHA"
if [[ -n "$EXPECTED_SHA" && "$HEAD_SHA" != "$EXPECTED_SHA" ]]; then
  echo "❌ Expected HEAD $EXPECTED_SHA but got $HEAD_SHA"
  exit 1
fi

echo "==> Building app"
npm ci
npm run build

echo "==> Restarting app process"
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
sudo fuser -k "${APP_PORT}/tcp" >/dev/null 2>&1 || true
PORT="$APP_PORT" pm2 start "$REPO_DIR/dist/server.js" --name "$APP_NAME" --cwd "$REPO_DIR" --update-env
pm2 save

echo "==> Reloading nginx"
sudo nginx -t
sudo systemctl reload nginx

echo "==> Checking local endpoints"
LOCAL_BASE_URL="http://127.0.0.1:${APP_PORT}"
wait_for_http "local /api/health" "$LOCAL_BASE_URL/api/health" 25 2
LOCAL_HEALTH="$(curl -fsS "$LOCAL_BASE_URL/api/health")"
assert_contains "local /api/health" "$LOCAL_HEALTH" "\"status\":\"ok\""

LOCAL_DEV_STATUS="$(curl -fsS -o /tmp/kingmyco-dev-ui.html -w '%{http_code}' "$LOCAL_BASE_URL/api/dev/myco-quest")"
if [[ "$LOCAL_DEV_STATUS" != "200" ]]; then
  echo "❌ local /api/dev/myco-quest returned status $LOCAL_DEV_STATUS"
  exit 1
fi

LOCAL_DEV_UI="$(cat /tmp/kingmyco-dev-ui.html)"
assert_contains "local /api/dev/myco-quest" "$LOCAL_DEV_UI" "Myco Quest Dev"

run_generate_with_optional_token "local" "$LOCAL_BASE_URL" "/tmp/kingmyco-local-run.json"

echo "==> Checking public endpoints"
wait_for_http "public /api/health" "$PUBLIC_BASE_URL/api/health" 20 2
PUBLIC_HEALTH="$(curl -fsS "$PUBLIC_BASE_URL/api/health")"
assert_contains "public /api/health" "$PUBLIC_HEALTH" "\"status\":\"ok\""

PUBLIC_DEV_STATUS="$(curl -fsS -o /tmp/kingmyco-public-dev-ui.html -w '%{http_code}' "$PUBLIC_BASE_URL/api/dev/myco-quest")"
if [[ "$PUBLIC_DEV_STATUS" != "200" ]]; then
  echo "❌ public /api/dev/myco-quest returned status $PUBLIC_DEV_STATUS"
  exit 1
fi

PUBLIC_DEV_UI="$(cat /tmp/kingmyco-public-dev-ui.html)"
assert_contains "public /api/dev/myco-quest" "$PUBLIC_DEV_UI" "Myco Quest Dev"

run_generate_with_optional_token "public" "$PUBLIC_BASE_URL" "/tmp/kingmyco-public-run.json"

echo "✅ Finalized: deploy, routing, and objective-chain payload checks all passed."
