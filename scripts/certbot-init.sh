#!/usr/bin/env bash
# First-time Let's Encrypt certificate (reads WM_DOMAIN + CERTBOT_EMAIL from .env).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT}/.env}"
COMPOSE="docker compose --project-directory ${ROOT} -f deploy/docker-compose.yml --env-file ${ENV_FILE}"

cd "${ROOT}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}"
  exit 1
fi

DOMAIN="$(grep -E '^WM_DOMAIN=' "${ENV_FILE}" | cut -d= -f2- | tr -d '"' | tr -d "'")"
DOMAIN="${DOMAIN:-watermelon-messenger.ru}"
EMAIL="$(grep -E '^CERTBOT_EMAIL=' "${ENV_FILE}" | cut -d= -f2- | tr -d '"' | tr -d "'")"

if [[ -z "${EMAIL}" || "${EMAIL}" == "you@example.com" ]]; then
  echo "Set CERTBOT_EMAIL=your@email.com in ${ENV_FILE}"
  exit 1
fi

PROJECT="${COMPOSE_PROJECT_NAME:-watermelon-prod}"
CERT_VOL="${PROJECT}_certbot-conf"
WWW_VOL="${PROJECT}_certbot-www"

echo "==> Domain: ${DOMAIN}, email: ${EMAIL}"
$COMPOSE up -d postgres redis scylla api
$COMPOSE stop web 2>/dev/null || true

docker volume create "${CERT_VOL}" 2>/dev/null || true
docker volume create "${WWW_VOL}" 2>/dev/null || true

docker run --rm -p 80:80 \
  -v "${CERT_VOL}:/etc/letsencrypt" \
  -v "${WWW_VOL}:/var/www/certbot" \
  certbot/certbot certonly --standalone \
  -d "${DOMAIN}" \
  --email "${EMAIL}" \
  --agree-tos \
  --no-eff-email \
  --non-interactive

$COMPOSE up -d
echo "==> Done. Open https://${DOMAIN}"
