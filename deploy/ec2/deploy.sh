#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/kingmyco}"
BRANCH="${BRANCH:-main}"

echo "Deploying king-myco-runner to ${APP_DIR} from branch ${BRANCH}"

if [ ! -d "${APP_DIR}/.git" ]; then
  echo "ERROR: ${APP_DIR} is not a git repository checkout." >&2
  exit 1
fi

cd "${APP_DIR}"

git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull origin "${BRANCH}"

if [ ! -f .env ]; then
  echo "ERROR: ${APP_DIR}/.env is missing. Copy .env.example and fill secrets first." >&2
  exit 1
fi

docker compose --env-file .env up -d --build api heartbeat-worker
docker compose --env-file .env --profile settlement up -d settlement-worker

echo "Deployment complete."
docker compose ps
