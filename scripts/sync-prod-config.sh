#!/usr/bin/env bash
# Copy deploy configs + .env to production host.
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:?set DEPLOY_HOST}"
DEPLOY_USER="${DEPLOY_USER:?set DEPLOY_USER}"
DEPLOY_PATH="${DEPLOY_PATH:?set DEPLOY_PATH}"
ENV_FILE="${ENV_FILE:-.env}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_rsa}"
RSYNC_SSH="ssh -i ${SSH_KEY} -o StrictHostKeyChecking=accept-new"
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new \
  "${DEPLOY_USER}@${DEPLOY_HOST}" "mkdir -p ${DEPLOY_PATH}/deploy ${DEPLOY_PATH}/scripts"

rsync -avz -e "$RSYNC_SSH" \
  "${ROOT}/deploy/docker-compose.yml" \
  "${ROOT}/deploy/nginx.prod.conf" \
  "${ROOT}/deploy/nginx.bootstrap.conf" \
  "${ROOT}/deploy/.env.example" \
  "${REMOTE}/deploy/"

rsync -avz -e "$RSYNC_SSH" \
  "${ROOT}/deploy/monitoring/" \
  "${REMOTE}/deploy/monitoring/"

rsync -avz -e "$RSYNC_SSH" \
  "${ROOT}/scripts/"*.sh \
  "${REMOTE}/scripts/"

if [[ -f "${ENV_FILE}" ]]; then
  rsync -avz -e "$RSYNC_SSH" "${ENV_FILE}" "${REMOTE}/.env"
else
  echo "Warning: ${ENV_FILE} not found — .env on server not updated"
fi

ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new \
  "${DEPLOY_USER}@${DEPLOY_HOST}" "chmod +x ${DEPLOY_PATH}/scripts/*.sh"

echo "==> Synced to ${DEPLOY_PATH}"
