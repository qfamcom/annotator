#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_PY="${ROOT_DIR}/.venv/bin/python"

if [[ ! -x "${VENV_PY}" ]]; then
  echo "[error] Missing backend virtualenv. Create it first:" >&2
  echo "  DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib /opt/homebrew/bin/python3.13 -m venv ${ROOT_DIR}/.venv" >&2
  echo "  DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib ${ROOT_DIR}/.venv/bin/pip install -r ${ROOT_DIR}/requirements.txt" >&2
  exit 1
fi

export DYLD_LIBRARY_PATH="/opt/homebrew/opt/expat/lib:${DYLD_LIBRARY_PATH:-}"
export APP_HOST="${APP_HOST:-127.0.0.1}"
export APP_PORT="${APP_PORT:-5050}"

exec "${VENV_PY}" "${ROOT_DIR}/app.py"
