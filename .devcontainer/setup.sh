#!/usr/bin/env bash
#
# One-time provisioning for the NumberCatch dev container (GitHub Codespaces).
#
# Runs once, right after the container is created, as the non-root `node` user.
# It only installs things that the Codeman installer does NOT provide itself:
# the project dependencies, the two AI CLIs you use, and a small fix for a bug
# in Codeman's installer that only shows up in non-interactive runs.
#
# Idempotent: re-running it is safe.
set -uo pipefail

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"

# Codeman lives in ~/.local/bin, which is only added to PATH for interactive
# shells. Register it for VS Code's non-interactive terminals too.
if ! grep -qs 'codeman: PATH' "$HOME/.bashrc"; then
  {
    echo ''
    echo '# codeman: PATH'
    echo 'export PATH="$HOME/.local/bin:$PATH"'
  } >>"$HOME/.bashrc"
fi

# --- 1. Project dependencies -------------------------------------------------
log "Installing project dependencies (npm ci)"
cd "$REPO_DIR"
npm ci

# --- 2. Codeman --------------------------------------------------------------
# The installer checks for Node, tmux, a build toolchain and an AI CLI itself and
# installs whatever is missing, so we only have to call it non-interactively.
#
# Two workarounds are needed because we run it headless:
#   * CODEMAN_NONINTERACTIVE=1 approves its system changes without a terminal.
#   * The installer's final notice calls `$USER`, which Codespaces does not
#     export in a non-interactive shell (`set -u` aborts). Setting it lets the
#     script finish cleanly. It installs and builds fine either way.
log "Installing Codeman"
CODEMAN_NONINTERACTIVE=1 USER="${USER:-$(id -un)}" \
  bash -c 'curl -fsSL https://getcodeman.com/install | bash -s -- --no-start' \
  || log "Codeman installer exited non-zero (usually the notice above); continuing"

# --- 3. AI CLIs you use ------------------------------------------------------
# Installed here, before Codeman ever starts, so its "no AI CLI found" prompt is
# skipped and both CLIs are available to every session.
log "Installing Codex CLI"
if ! npm install -g @openai/codex; then
  # Some images leave the global npm prefix unwritable; ~/.local/bin is on PATH.
  log "Global npm install failed; installing into ~/.local instead"
  npm install -g --prefix "$HOME/.local" @openai/codex \
    || log "Codex CLI install failed; install it later with: npm install -g @openai/codex"
fi

log "Installing Antigravity CLI"
if command -v agy >/dev/null 2>&1; then
  echo "Antigravity CLI already present"
else
  curl -fsSL https://antigravity.google/cli/install.sh | bash \
    || log "Antigravity CLI install failed; install it later from https://antigravity.google/cli"
fi

log "Setup complete"
