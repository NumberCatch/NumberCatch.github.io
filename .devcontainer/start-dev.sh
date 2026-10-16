#!/usr/bin/env bash
#
# Runs on every container start (Codespaces postStartCommand).
#
# Starts the Codeman dashboard and the Angular dev server if they are not
# already running, then opens both in a browser window.
#
# The "new browser window" is primarily handled by VS Code/Codespaces: each
# port listed in portsAttributes (devcontainer.json) is auto-forwarded as soon
# as its server listens and opened once in a browser. The explicit open at the
# end is a best-effort fallback for when that does not fire (for example a
# container restart, where the port was already forwarded before).
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_DIR/.devcontainer/logs"
mkdir -p "$LOG_DIR"
export PATH="$HOME/.local/bin:$PATH"
# Codespaces does not export USER in non-interactive shells; some tools assume it.
export USER="${USER:-$(id -un)}"

CODEMAN_PORT="${CODEMAN_PORT:-3000}"
ANGULAR_PORT="${ANGULAR_PORT:-4200}"

# Codeman refuses requests whose Host header is not in its anti-DNS-rebinding
# allowlist. Codespaces serves each forwarded port from a different
# <codespace>-<port>.app.github.dev host, so that whole namespace must be
# trusted or the dashboard answers 403. (The Angular dev server needs the same,
# configured under projects.serve.options.allowedHosts in angular.json.)
export CODEMAN_ALLOWED_HOSTS="${CODEMAN_ALLOWED_HOSTS:-.app.github.dev,.githubpreview.dev,.github.dev}"

log() { printf '\033[1;36m==> %s\033[0m\n' "$*"; }

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1; }

wait_for_port() { # port timeout
  local i=0
  until port_open "$1"; do
    i=$((i + 1))
    [ "$i" -ge "$2" ] && return 1
    sleep 1
  done
}

start_codeman() {
  if port_open "$CODEMAN_PORT"; then
    log "Codeman is already running on port $CODEMAN_PORT"
    return 0
  fi
  log "Starting Codeman on port $CODEMAN_PORT"
  codeman web -d \
    --host 0.0.0.0 \
    --port "$CODEMAN_PORT" \
    --allow-unauthenticated-network \
    >>"$LOG_DIR/codeman.log" 2>&1 || log "codeman web failed to start (see $LOG_DIR/codeman.log)"
  wait_for_port "$CODEMAN_PORT" 60 || log "Codeman did not answer within 60s"
  grep -h "Host allowlist also accepts" "$HOME/.codeman/web.log" 2>/dev/null | tail -1
}

start_angular() {
  if port_open "$ANGULAR_PORT"; then
    log "Angular dev server is already running on port $ANGULAR_PORT"
    return 0
  fi
  log "Starting Angular dev server on port $ANGULAR_PORT"
  cd "$REPO_DIR"
  nohup npm start -- --host 0.0.0.0 --port "$ANGULAR_PORT" >>"$LOG_DIR/angular.log" 2>&1 &
  wait_for_port "$ANGULAR_PORT" 120 || log "Angular dev server did not answer within 120s"
}

forwarded_url() { # port
  if [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]; then
    printf 'https://%s-%s.%s' "$CODESPACE_NAME" "$1" "$GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN"
  fi
}

open_in_browser() { # url
  if command -v code >/dev/null 2>&1 && code --open-url "$1" >/dev/null 2>&1; then
    return 0
  fi
  if [ -n "${BROWSER:-}" ] && command -v "${BROWSER%% *}" >/dev/null 2>&1 && "$BROWSER" "$1" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

start_codeman
start_angular

CODEMAN_URL="$(forwarded_url "$CODEMAN_PORT")"
[ -n "$CODEMAN_URL" ] || CODEMAN_URL="http://localhost:$CODEMAN_PORT"
ANGULAR_URL="$(forwarded_url "$ANGULAR_PORT")"
[ -n "$ANGULAR_URL" ] || ANGULAR_URL="http://localhost:$ANGULAR_PORT"

log "Codeman dashboard: $CODEMAN_URL"
log "Angular dev server: $ANGULAR_URL"

open_in_browser "$CODEMAN_URL" || true
open_in_browser "$ANGULAR_URL" || true
