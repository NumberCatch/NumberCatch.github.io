#!/usr/bin/env bash
# Startet den ACP-Control-Server in einem GitHub Codespace und öffnet die Weboberfläche.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${ACP_PORT:-12000}"
LOG="/tmp/acp-control.log"

if [ ! -d "$ROOT/node_modules" ]; then
  echo "Installiere Abhängigkeiten …"
  (cd "$ROOT" && npm install --no-audit --no-fund) >>"$LOG" 2>&1
fi

if [ -n "${CODESPACE_NAME:-}" ] && command -v gh >/dev/null 2>&1; then
  # Port öffentlich schalten, damit die Weboberfläche auch per Handy erreichbar ist.
  gh codespace ports visibility "$PORT:public" -c "$CODESPACE_NAME" >/dev/null 2>&1 || true
fi

# Server im Hintergrund starten, falls noch nicht aktiv.
if ! curl -fsS "http://127.0.0.1:$PORT/api/agents" >/dev/null 2>&1; then
  echo "Starte ACP Control auf Port $PORT …"
  (cd "$ROOT" && PORT="$PORT" nohup node src/server.js >>"$LOG" 2>&1 &)
  for _ in $(seq 1 40); do
    curl -fsS "http://127.0.0.1:$PORT/api/agents" >/dev/null 2>&1 && break
    sleep 0.5
  done
fi

# URL ermitteln und Browser öffnen.
if [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]; then
  URL="https://${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}/"
else
  URL="http://localhost:${PORT}/"
fi

echo "ACP Control: $URL"
if command -v code >/dev/null 2>&1 && [ -n "${CODESPACE_NAME:-}" ]; then
  code --openExternal "$URL" >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 || true
fi

# Optional: fehlende Agenten automatisch installieren.
if [ "${ACP_AUTO_INSTALL:-0}" = "1" ]; then
  bash "$ROOT/scripts/install-agents.sh" || true
fi
