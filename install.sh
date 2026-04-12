#!/bin/bash
set -e

ZIP_URL="https://github.com/ipod86/Druckerei-Tracker/archive/refs/heads/main.zip"
TARGET="${1:-/opt/druckerei-tracker}"
TMP_ZIP="/tmp/druckerei-tracker-$$.zip"
TMP_DIR="/tmp/druckerei-tracker-$$"

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║     Druckerei Tracker – Installer        ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# ── Node.js prüfen ───────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "✗ Node.js nicht gefunden."
  echo ""
  echo "  Node.js installieren:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -"
  echo "  sudo apt-get install -y nodejs"
  exit 1
fi
NODE_VER=$(node -e "console.log(parseInt(process.version.slice(1)))")
if [ "$NODE_VER" -lt 18 ]; then
  echo "✗ Node.js $NODE_VER zu alt. Mindestens Node.js 18 erforderlich."
  exit 1
fi
echo "✓ Node.js $(node --version)"

# ── unzip + rsync prüfen / installieren ─────────────────────────────────────
MISSING=""
command -v unzip &>/dev/null || MISSING="$MISSING unzip"
command -v rsync &>/dev/null || MISSING="$MISSING rsync"
if [ -n "$MISSING" ]; then
  echo "▸ Installiere:$MISSING"
  sudo apt-get install -y $MISSING -qq
fi

# ── ZIP herunterladen ────────────────────────────────────────────────────────
echo "▸ Herunterladen..."
wget -q --show-progress -O "$TMP_ZIP" "$ZIP_URL"

# ── Entpacken ────────────────────────────────────────────────────────────────
echo "▸ Entpacken..."
mkdir -p "$TMP_DIR"
unzip -q "$TMP_ZIP" -d "$TMP_DIR"

# ── In Zielverzeichnis kopieren (Nutzerdaten bleiben erhalten) ───────────────
mkdir -p "$TARGET"
if [ -d "$TARGET/data" ] || [ -f "$TARGET/.env" ]; then
  echo "↺ Vorhandene Installation gefunden – Dateien werden aktualisiert (Daten bleiben erhalten)..."
else
  echo "▸ Neue Installation..."
fi
rsync -a \
  --exclude=data/ \
  --exclude=uploads/ \
  --exclude=backups/ \
  --exclude=.env \
  --exclude=update.log \
  --exclude=node_modules/ \
  "$TMP_DIR/Druckerei-Tracker-main/" "$TARGET/"

# ── Temporäre Dateien löschen ────────────────────────────────────────────────
rm -rf "$TMP_ZIP" "$TMP_DIR"
echo "✓ Temporäre Dateien gelöscht"

# ── Setup ausführen ──────────────────────────────────────────────────────────
# /dev/tty stellt sicher dass interaktive Prompts funktionieren auch wenn
# das Script via "wget | bash" gepipt wird (stdin wäre sonst EOF)
if [ -e /dev/tty ]; then
  bash "$TARGET/setup.sh" < /dev/tty
else
  bash "$TARGET/setup.sh"
fi
