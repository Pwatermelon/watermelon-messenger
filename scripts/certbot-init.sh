#!/usr/bin/env bash
# Manual re-issue TLS (normally deploy-server.sh does this automatically).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export WM_VERSION="${WM_VERSION:-$(grep -E '^WM_VERSION=' "${ROOT}/.env" | cut -d= -f2- | tr -d '"' || echo latest)}"
exec "${ROOT}/scripts/deploy-server.sh"
