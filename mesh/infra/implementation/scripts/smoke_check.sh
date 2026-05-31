#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.infra"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[error] Missing ${ENV_FILE}. Copy .env.infra.example to .env.infra first." >&2
  exit 1
fi

source "${ENV_FILE}"

check_tcp() {
  local host="$1"
  local port="$2"
  local name="$3"
  if nc -z "${host}" "${port}" >/dev/null 2>&1; then
    echo "[ok] ${name} reachable at ${host}:${port}"
  else
    echo "[error] ${name} not reachable at ${host}:${port}" >&2
    return 1
  fi
}

check_http() {
  local url="$1"
  local name="$2"
  if curl -fsS "${url}" >/dev/null; then
    echo "[ok] ${name} healthy at ${url}"
  else
    echo "[error] ${name} health check failed at ${url}" >&2
    return 1
  fi
}

check_tcp "127.0.0.1" "${POSTGRES_PORT}" "postgres"
check_tcp "127.0.0.1" "${REDIS_PORT}" "redis"
check_http "http://127.0.0.1:${MINIO_API_PORT}/minio/health/live" "minio"

echo "[ok] infra smoke checks passed"
