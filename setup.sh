#!/bin/bash
set -e

APP_NAME="druckerei-tracker"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║        Druckerei Tracker – Setup         ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# ── Node.js prüfen ──────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "✗ Node.js nicht gefunden. Bitte Node.js 18+ installieren."
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -"
  echo "  sudo apt-get install -y nodejs"
  exit 1
fi

NODE_VER=$(node -e "console.log(parseInt(process.version.slice(1)))" 2>/dev/null)
if [ "$NODE_VER" -lt 18 ]; then
  echo "✗ Node.js $NODE_VER zu alt. Mindestens Node.js 18 erforderlich."
  exit 1
fi
echo "✓ Node.js $(node --version) gefunden"

# ── Laufende Instanz stoppen ────────────────────────────────────────────────
if systemctl is-active --quiet "$APP_NAME" 2>/dev/null; then
  echo "↺ Laufende Instanz wird gestoppt..."
  sudo systemctl stop "$APP_NAME"
fi

# ── Port abfragen ───────────────────────────────────────────────────────────
while true; do
  read -rp "Port [3000]: " PORT
  PORT="${PORT:-3000}"
  if ss -tuln 2>/dev/null | grep -q ":${PORT} "; then
    echo "⚠  Port $PORT ist belegt – bitte anderen wählen."
  else
    echo "✓ Port $PORT ist frei."
    break
  fi
done

# ── Autostart abfragen ──────────────────────────────────────────────────────
read -rp "Autostart beim Systemstart einrichten? [Y/n]: " AUTOSTART
AUTOSTART="${AUTOSTART:-Y}"

# ── npm install ─────────────────────────────────────────────────────────────
echo ""
echo "▸ Abhängigkeiten installieren..."
cd "$APP_DIR"
npm install --omit=dev --silent
echo "✓ Abhängigkeiten installiert"

# ── Verzeichnisse anlegen ───────────────────────────────────────────────────
mkdir -p "$APP_DIR/data" "$APP_DIR/uploads/branding" "$APP_DIR/uploads/attachments" "$APP_DIR/backups"
echo "✓ Verzeichnisse angelegt"

# ── .env anlegen (falls nicht vorhanden) ────────────────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
  SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))" 2>/dev/null || cat /dev/urandom | tr -dc 'a-f0-9' | head -c 96)
  cat > "$APP_DIR/.env" << EOF
PORT=${PORT}
SESSION_SECRET=${SECRET}
DB_PATH=./data/database.sqlite
UPLOAD_PATH=./uploads
BACKUP_PATH=./backups
SESSION_TIMEOUT_MINUTES=60
EOF
  echo "✓ .env erstellt (Session-Secret automatisch generiert)"
else
  # Port in bestehender .env aktualisieren
  sed -i "s/^PORT=.*/PORT=${PORT}/" "$APP_DIR/.env"
  echo "✓ .env vorhanden (Port aktualisiert)"
fi

# ── Datenbank initialisieren ────────────────────────────────────────────────
echo "▸ Datenbank initialisieren..."
node -e "require('./src/db/database.js')" && echo "✓ Datenbank bereit"

# ── Systemd-Service ─────────────────────────────────────────────────────────
if [[ "${AUTOSTART^^}" == "Y" ]]; then
  RUN_USER="${SUDO_USER:-$(whoami)}"
  sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Druckerei Tracker
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${APP_DIR}
ExecStart=$(command -v node) src/server.js
Restart=on-failure
RestartSec=5
EnvironmentFile=${APP_DIR}/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable "$APP_NAME" --quiet
  sudo systemctl start "$APP_NAME"
  sleep 2

  if systemctl is-active --quiet "$APP_NAME"; then
    echo "✓ Service läuft (${APP_NAME})"
  else
    echo "⚠  Service konnte nicht gestartet werden. Log:"
    journalctl -u "$APP_NAME" -n 20 --no-pager
    exit 1
  fi
else
  echo ""
  echo "  Manuell starten: cd $APP_DIR && node src/server.js"
fi

# ── Fertig ───────────────────────────────────────────────────────────────────
echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║  ✓  Druckerei Tracker ist bereit!        ║"
printf  "  ║     http://$(hostname -I | awk '{print $1}'):%-5s                  ║\n" "${PORT}"
echo "  ║                                          ║"
echo "  ║  Standard-Login:                         ║"
echo "  ║    Benutzer: admin                       ║"
echo "  ║    Passwort: admin123                    ║"
echo "  ║  (bitte sofort ändern!)                  ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""
