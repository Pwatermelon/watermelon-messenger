#!/usr/bin/env bash
# Deploy from Docker Hub + auto TLS (Let's Encrypt apex + www).
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker not found. Run: bash scripts/install-docker.sh"
  exit 127
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose plugin not found."
  exit 127
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

VERSION="${WM_VERSION:-${WM_IMAGE_TAG:-}}"
if [[ -z "$VERSION" ]]; then
  echo "Set WM_VERSION (e.g. 1.0.0) — same as commit message 'ver 1.0.0'"
  exit 1
fi

ENV_FILE="${ROOT}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE} — set GitHub secret PROD_ENV_FILE"
  exit 1
fi

COMPOSE="docker compose -f deploy/docker-compose.yml --env-file ${ENV_FILE}"
PROJECT="${COMPOSE_PROJECT_NAME:-watermelon-prod}"
CERT_VOL="${PROJECT}_certbot-conf"

read_env() {
  grep -E "^${1}=" "${ENV_FILE}" | cut -d= -f2- | tr -d '"' | tr -d "'" || true
}

DOMAIN="$(read_env WM_DOMAIN)"
DOMAIN="${DOMAIN:-watermelon-messenger.ru}"
CERTBOT_EMAIL="$(read_env CERTBOT_EMAIL)"

cert_exists() {
  docker run --rm -v "${CERT_VOL}:/etc/letsencrypt:ro" alpine \
    test -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" 2>/dev/null
}

set_nginx_conf() {
  local conf="$1"
  export WM_NGINX_CONF="${conf}"
  if grep -q '^WM_NGINX_CONF=' "${ENV_FILE}"; then
    sed -i "s/^WM_NGINX_CONF=.*/WM_NGINX_CONF=${conf}/" "${ENV_FILE}"
  else
    echo "WM_NGINX_CONF=${conf}" >> "${ENV_FILE}"
  fi
}

ensure_tls() {
  if cert_exists; then
    echo "==> TLS certificate OK"
    set_nginx_conf "nginx.prod.conf"
    return 0
  fi

  if [[ -z "${CERTBOT_EMAIL}" || "${CERTBOT_EMAIL}" == "you@example.com" ]]; then
    echo "ERROR: No TLS cert and CERTBOT_EMAIL is not set in .env (add to PROD_ENV_FILE)"
    exit 1
  fi

  echo "==> No TLS cert — issuing via Let's Encrypt (${DOMAIN} + www.${DOMAIN})..."
  set_nginx_conf "nginx.http.conf"
  $COMPOSE up -d

  echo "==> Waiting for HTTP /api/health before ACME..."
  for i in $(seq 1 20); do
    if curl -sf "http://${DOMAIN}/api/health" >/dev/null 2>&1 \
      || curl -sf "http://127.0.0.1/api/health" >/dev/null 2>&1; then
      break
    fi
    sleep 3
  done

  $COMPOSE run --rm --entrypoint certbot certbot certonly \
    --webroot -w /var/www/certbot \
    -d "${DOMAIN}" \
    -d "www.${DOMAIN}" \
    --email "${CERTBOT_EMAIL}" \
    --agree-tos \
    --no-eff-email \
    --non-interactive

  if ! cert_exists; then
    echo "ERROR: certbot failed. Check DNS A for @ and www → this server, port 80 open."
    $COMPOSE logs web --tail 30 || true
    exit 1
  fi

  echo "==> Certificate issued — enabling HTTPS"
  set_nginx_conf "nginx.prod.conf"
  $COMPOSE up -d --force-recreate web
}

if grep -q '^WM_VERSION=' "${ENV_FILE}"; then
  sed -i "s/^WM_VERSION=.*/WM_VERSION=${VERSION}/" "${ENV_FILE}"
else
  echo "WM_VERSION=${VERSION}" >> "${ENV_FILE}"
fi
export WM_VERSION="${VERSION}"

if cert_exists; then
  set_nginx_conf "nginx.prod.conf"
else
  set_nginx_conf "nginx.http.conf"
fi

echo "==> Deploying ver ${VERSION} (nginx: ${WM_NGINX_CONF})"
echo "    API: plwatermelon/watermelon-messenger-api:${VERSION}"
echo "    Web: plwatermelon/watermelon-messenger-web:${VERSION}"

$COMPOSE pull api web
$COMPOSE up -d --remove-orphans

ensure_tls

echo "==> Waiting for https://${DOMAIN}/api/health ..."
for i in $(seq 1 40); do
  if curl -sfk "https://${DOMAIN}/api/health" >/dev/null 2>&1; then
    echo "==> Deploy OK (ver ${VERSION}, HTTPS)"
    exit 0
  fi
  sleep 3
done

echo "ERROR: HTTPS health check failed — check: $COMPOSE logs web api"
$COMPOSE ps
exit 1
