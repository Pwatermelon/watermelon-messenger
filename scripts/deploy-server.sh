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

# Docker creates directories when bind-mount source files are missing — remove before up.
fix_monitoring_mounts() {
  local base="${ROOT}/deploy/monitoring"
  local paths=(
    "prometheus/prometheus.yml"
    "grafana/grafana.ini"
  )
  for rel in "${paths[@]}"; do
    local p="${base}/${rel}"
    if [[ -d "${p}" ]]; then
      echo "WARN: removing erroneous directory ${p} (file was missing on a prior deploy)"
      rm -rf "${p}"
    fi
  done
  if [[ ! -f "${base}/prometheus/prometheus.yml" ]]; then
    echo "ERROR: missing ${base}/prometheus/prometheus.yml — sync deploy/monitoring/ to the server"
    exit 1
  fi
  if [[ ! -f "${base}/grafana/grafana.ini" ]]; then
    echo "ERROR: missing ${base}/grafana/grafana.ini — sync deploy/monitoring/ to the server"
    exit 1
  fi
}

fix_monitoring_mounts

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

echo "==> Monitoring stack"
$COMPOSE up -d prometheus grafana node-exporter postgres-exporter redis-exporter
if ! $COMPOSE ps prometheus 2>/dev/null | grep -qE 'running|Up'; then
  echo "WARN: prometheus is not running — Grafana dashboards will be empty."
  echo "      Check: $COMPOSE logs prometheus"
  echo "      If mount failed, remove erroneous dirs under deploy/monitoring/ and redeploy."
fi

ensure_tls

ping_indexnow() {
  local key="wm8f3a2c1b9e4d7f6a"
  local base="https://${DOMAIN}"
  local payload
  payload=$(cat <<EOF
{"host":"${DOMAIN}","key":"${key}","keyLocation":"${base}/${key}.txt","urlList":["${base}/","${base}/legal/privacy","${base}/legal/personal-data-consent","${base}/legal/terms","${base}/faq"]}
EOF
)
  echo "==> IndexNow ping (${DOMAIN})"
  curl -sf -X POST "https://yandex.com/indexnow" \
    -H "Content-Type: application/json; charset=utf-8" \
    -d "${payload}" >/dev/null && echo "    Yandex IndexNow: OK" \
    || echo "    WARN: Yandex IndexNow failed"
  curl -sf -X POST "https://api.indexnow.org/indexnow" \
    -H "Content-Type: application/json; charset=utf-8" \
    -d "${payload}" >/dev/null && echo "    api.indexnow.org: OK" \
    || echo "    WARN: api.indexnow.org failed"
}

echo "==> Waiting for https://${DOMAIN}/api/health ..."
for i in $(seq 1 40); do
  if curl -sfk "https://${DOMAIN}/api/health" >/dev/null 2>&1; then
    echo "==> Deploy OK (ver ${VERSION}, HTTPS)"
    ping_indexnow || true
    exit 0
  fi
  sleep 3
done

echo "ERROR: HTTPS health check failed — check: $COMPOSE logs web api"
$COMPOSE ps
exit 1
