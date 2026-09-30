#!/usr/bin/env bash
# Lädt den offiziellen Antigravity-ACP-Server aus der ACP-Registry (Linux x86_64/arm64).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ACP_HOME="${ACP_HOME:-$ROOT}"
DEST="$ACP_HOME/agents"
mkdir -p "$DEST"

case "$(uname -m)" in
  x86_64 | amd64) ARCH="x86_64" ;;
  aarch64 | arm64) ARCH="aarch64" ;;
  *) echo "Nicht unterstützte Architektur: $(uname -m)" >&2; exit 1 ;;
esac

REGISTRY_URL="https://github.com/agentclientprotocol/registry/releases/latest/download/registry.json"
echo "Lese ACP-Registry …"
ENTRY="$(curl -fsSL "$REGISTRY_URL" | ARCH="$ARCH" node -e '
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    const data = JSON.parse(raw);
    const agents = data.agents || data;
    const entry = agents.find((a) => a.id === "antigravity-acp");
    if (!entry) { console.error("antigravity-acp nicht in der Registry gefunden"); process.exit(1); }
    const target = entry.distribution.binary[`linux-${process.env.ARCH}`];
    if (!target) { console.error("Keine Linux-Binary für " + process.env.ARCH); process.exit(1); }
    process.stdout.write(target.archive);
  });
')"

echo "Download: $ENTRY"
TMP="$(mktemp -d)"
curl -fsSL "$ENTRY" -o "$TMP/agy-acp.zip"
if command -v unzip >/dev/null 2>&1; then
  unzip -o -q "$TMP/agy-acp.zip" -d "$DEST"
else
  python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$TMP/agy-acp.zip" "$DEST"
fi
chmod +x "$DEST"/agy_acp_server* 2>/dev/null || true
rm -rf "$TMP"

echo "Installiert nach $DEST:"
ls -la "$DEST"
