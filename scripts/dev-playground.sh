#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

PORT="${PORT:-3000}"
API_URL="${PLAYGROUND_API_URL:-http://127.0.0.1:${PORT}}"
SOURCE="${PLAYGROUND_SOURCE:-kingmyco.io}"
PLAYER_ID="${PLAYGROUND_PLAYER_ID:-dev-playground-player}"
SOURCE_TOKEN="${PLAYGROUND_SOURCE_TOKEN:-}"
LOOP_INTERVAL_SEC="${PLAYGROUND_INTERVAL_SEC:-12}"
LOOP_TARGET_TICKS="${PLAYGROUND_TICKS:-0}"
RUN_ENCOUNTERS="${PLAYGROUND_ENCOUNTERS:-5}"
HEARTBEAT_POLL_MS="${KINGMYCO_HEARTBEAT_POLL_MS:-15000}"
REUSE_EXISTING_API="${PLAYGROUND_REUSE_EXISTING_API:-true}"
REUSE_EXISTING_HEARTBEAT="${PLAYGROUND_REUSE_EXISTING_HEARTBEAT:-true}"

LOG_DIR="${PLAYGROUND_LOG_DIR:-/tmp/kingmyco-playground}"
API_LOG="${LOG_DIR}/api.log"
HEARTBEAT_LOG="${LOG_DIR}/heartbeat.log"

mkdir -p "${LOG_DIR}"

API_PID=""
HEARTBEAT_PID=""

cleanup() {
  if [ -n "${HEARTBEAT_PID}" ] && kill -0 "${HEARTBEAT_PID}" 2>/dev/null; then
    kill "${HEARTBEAT_PID}" 2>/dev/null || true
  fi

  if [ -n "${API_PID}" ] && kill -0 "${API_PID}" 2>/dev/null; then
    kill "${API_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

api_is_healthy() {
  curl -fsS "${API_URL}/health" >/dev/null 2>&1
}

wait_for_api() {
  local attempt
  for attempt in $(seq 1 40); do
    if api_is_healthy; then
      return 0
    fi
    sleep 1
  done

  echo "Playground failed: API did not become healthy at ${API_URL}/health" >&2
  return 1
}

post_json() {
  local endpoint="$1"
  local payload="$2"

  if [ -n "${SOURCE_TOKEN}" ]; then
    curl -fsS -X POST "${API_URL}${endpoint}" \
      -H "content-type: application/json" \
      -H "x-source-token: ${SOURCE_TOKEN}" \
      -d "${payload}"
    return 0
  fi

  curl -fsS -X POST "${API_URL}${endpoint}" \
    -H "content-type: application/json" \
    -d "${payload}"
}

if api_is_healthy && [ "${REUSE_EXISTING_API}" = "true" ]; then
  echo "Playground: reusing existing API at ${API_URL}"
else
  echo "Playground: starting API (logs: ${API_LOG})"
  npm run start:api >"${API_LOG}" 2>&1 &
  API_PID=$!
  wait_for_api
fi

if [ "${REUSE_EXISTING_HEARTBEAT}" = "true" ] && pgrep -f "ecosystemHeartbeatWorker" >/dev/null 2>&1; then
  echo "Playground: reusing existing heartbeat worker"
else
  echo "Playground: starting heartbeat worker (logs: ${HEARTBEAT_LOG})"
  KINGMYCO_HEARTBEAT_POLL_MS="${HEARTBEAT_POLL_MS}" npm run start:heartbeat-worker >"${HEARTBEAT_LOG}" 2>&1 &
  HEARTBEAT_PID=$!
fi

echo "Playground running for player ${PLAYER_ID} on source ${SOURCE}"
echo "Stop with Ctrl+C"

tick=0
while true; do
  tick=$((tick + 1))

  score=$((850 + RANDOM % 500))
  spores_collected=$((20 + RANDOM % 50))
  risky_actions=$((RANDOM % 5))
  discovery_actions=$((3 + RANDOM % 6))
  compassionate_actions=$((2 + RANDOM % 5))
  ruthless_actions=$((RANDOM % 3))
  fire_casts=$((8 + RANDOM % 10))
  water_casts=$((5 + RANDOM % 10))
  ice_casts=$((3 + RANDOM % 8))
  perfect_actions=$((5 + RANDOM % 7))
  damage_taken=$((15 + RANDOM % 25))
  session_length=$((450 + RANDOM % 280))

  run_payload=$(cat <<JSON
{"source":"${SOURCE}","externalId":"${PLAYER_ID}","encounters":${RUN_ENCOUNTERS}}
JSON
)
  post_json "/api/run/generate" "${run_payload}" >/dev/null

  session_payload=$(cat <<JSON
{"source":"${SOURCE}","externalId":"${PLAYER_ID}","score":${score},"mode":"default","telemetry":{"sessionLengthSec":${session_length},"completedEncounters":${RUN_ENCOUNTERS},"failedEncounters":1,"damageTaken":${damage_taken},"perfectActions":${perfect_actions},"riskyActions":${risky_actions},"discoveryActions":${discovery_actions},"usedElements":["fire","water","ice"],"sporesCollected":${spores_collected},"morality":{"compassionateActions":${compassionate_actions},"ruthlessActions":${ruthless_actions}},"magic":{"castsByElement":{"fire":${fire_casts},"water":${water_casts},"ice":${ice_casts}},"ritualsCompleted":["playground-ritual-${tick}"]}}}
JSON
)
  session_receipt=$(post_json "/api/session/record" "${session_payload}")

  wallet_spores=$(printf "%s" "${session_receipt}" | rg -o '"spores":[0-9]+' -m 1 | rg -o '[0-9]+' -m 1)
  learned_magic=$(printf "%s" "${session_receipt}" | rg -o '"learnedMagic":\[[^]]*' -m 1 || true)
  echo "Tick ${tick}: score=${score}, sporesCollected=${spores_collected}, walletSpores=${wallet_spores:-unknown}"
  if [ -n "${learned_magic}" ]; then
    echo "  ${learned_magic}]"
  fi

  if [ "${LOOP_TARGET_TICKS}" -gt 0 ] && [ "${tick}" -ge "${LOOP_TARGET_TICKS}" ]; then
    echo "Playground completed ${tick} ticks."
    break
  fi

  sleep "${LOOP_INTERVAL_SEC}"
done
