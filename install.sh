#!/bin/bash
set -e

REPO="https://github.com/ipod86/Druckerei-Tracker.git"
TARGET="${1:-/opt/druckerei-tracker}"

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║     Druckerei Tracker – Installer        ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# ── Abhängigkeiten prüfen ────────────────────────────────────────────────────
for cmd in git node; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "✗ '$cmd' nicht gefunden."
    if [ "$cmd" = "node" ]; then
      echo ""
      echo "  Node.js installieren:"
      echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -"
      echo "  sudo apt-get install -y nodejs"
    fi
    exit 1
  fi
done

NODE_VER=$(node -e "console.log(parseInt(process.version.slice(1)))")
if [ "$NODE_VER" -lt 18 ]; then
  echo "✗ Node.js $NODE_VER zu alt. Mindestens Node.js 18 erforderlich."
  exit 1
fi
echo "✓ Node.js $(node --version)"

# ── Klonen oder aktualisieren ────────────────────────────────────────────────
if [ -d "$TARGET/.git" ]; then
  echo "↺ Vorhandene Installation gefunden – Update..."
  git -C "$TARGET" pull --quiet
else
  echo "▸ Klone Repository nach $TARGET ..."
  git clone --quiet "$REPO" "$TARGET"
fi

# ── Setup ausführen ──────────────────────────────────────────────────────────
bash "$TARGET/setup.sh"
