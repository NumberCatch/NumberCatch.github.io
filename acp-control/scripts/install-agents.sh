#!/usr/bin/env bash
# Installiert die Agenten, die sich ohne API-Key über einen Login nutzen lassen.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ACP_HOME="${ACP_HOME:-$ROOT}"
AGENTS_DIR="$ACP_HOME/agents"
mkdir -p "$AGENTS_DIR"

log() { printf '\n== %s ==\n' "$1"; }
has() { command -v "$1" >/dev/null 2>&1; }

# --- Codex (ACP-Adapter, bringt die Codex-CLI mit) -------------------------
log "Codex (codex-acp)"
if has codex-acp; then
  echo "bereits vorhanden: $(codex-acp --version 2>/dev/null || echo codex-acp)"
else
  npm install -g @agentclientprotocol/codex-acp
fi

# codex-acp bringt die Codex-CLI mit, legt sie aber nicht in den PATH.
# Für den Geräte-Login (codex login --device-auth) als Shim bereitstellen.
if ! has codex && has codex-acp; then
  CODEX_REAL="$(find "$(npm root -g)" /usr/local/lib/node_modules /acp-node/lib/node_modules \
    -path '*/vendor/*/bin/codex' -type f 2>/dev/null | head -n 1)"
  if [ -n "$CODEX_REAL" ]; then
    BIN_DIR="$HOME/.local/bin"
    mkdir -p "$BIN_DIR"
    printf '#!/bin/sh\nexec "%s" "$@"\n' "$CODEX_REAL" >"$BIN_DIR/codex"
    chmod +x "$BIN_DIR/codex"
    echo "codex-Shim angelegt: $BIN_DIR/codex"
  fi
fi

# --- GitHub Copilot CLI ----------------------------------------------------
log "GitHub Copilot CLI"
if has copilot; then
  echo "bereits vorhanden"
else
  npm install -g @github/copilot
fi

# --- Antigravity: agy CLI + offizieller ACP-Server -------------------------
log "Antigravity (agy CLI)"
if has agy; then
  echo "bereits vorhanden: $(agy --version 2>/dev/null || echo agy)"
else
  curl -fsSL https://antigravity.google/cli/install.sh | bash
  export PATH="$HOME/.local/bin:$PATH"
fi

log "Antigravity ACP-Server (agy_acp_server)"
if [ -x "$AGENTS_DIR/agy_acp_server.par" ]; then
  echo "bereits vorhanden: $AGENTS_DIR/agy_acp_server.par"
else
  "$ROOT/scripts/install-agy-acp.sh"
fi

log "Fertig"
echo "Codex:    codex login --device-auth"
echo "Copilot:  copilot login"
echo "agy:      agy   (Login-URL im Terminal öffnen)"
