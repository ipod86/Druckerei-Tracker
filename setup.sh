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
if systemctl list-units --all --quiet "$APP_NAME.service" 2>/dev/null | grep -q "$APP_NAME"; then
  echo "↺ Laufende Instanz wird gestoppt..."
  sudo systemctl stop "$APP_NAME" 2>/dev/null || true
fi
# Verbliebene Prozesse auf dem App-Port beenden
_PREV_PORT=$(grep '^PORT=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2)
if [ -n "$_PREV_PORT" ]; then
  _PIDS=$(ss -tlnp "sport = :${_PREV_PORT}" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u)
  if [ -n "$_PIDS" ]; then
    echo "↺ Prozess(e) auf Port $_PREV_PORT beenden: $_PIDS"
    echo "$_PIDS" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
fi

# ── Dedizierter System-User ─────────────────────────────────────────────────
APP_USER="druckerei"
if ! id "$APP_USER" &>/dev/null; then
  echo "▸ System-User '$APP_USER' wird angelegt..."
  sudo useradd --system --no-create-home --shell /usr/sbin/nologin --comment "Druckerei Tracker Service" "$APP_USER"
  echo "✓ User '$APP_USER' angelegt (kein Shell-Zugriff)"
else
  echo "✓ User '$APP_USER' bereits vorhanden"
fi

# ── Port abfragen (nur bei Erstinstallation) ─────────────────────────────────
if [ -f "$APP_DIR/.env" ]; then
  PORT=$(grep '^PORT=' "$APP_DIR/.env" | cut -d= -f2)
  PORT="${PORT:-3000}"
  echo "✓ Port $PORT (aus vorhandener .env übernommen)"
elif [ -t 0 ]; then
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
else
  PORT="3000"
  echo "✓ Port $PORT (Standard)"
fi

# ── Autostart abfragen (nur bei Erstinstallation) ────────────────────────────
if [ -f "$APP_DIR/.env" ]; then
  AUTOSTART="Y"
elif [ -t 0 ]; then
  read -rp "Autostart beim Systemstart einrichten? [Y/n]: " AUTOSTART
fi
AUTOSTART="${AUTOSTART:-Y}"

# ── Build-Abhängigkeiten (für better-sqlite3 Kompilierung) ──────────────────
echo ""
echo "▸ Build-Abhängigkeiten prüfen..."
MISSING_PKGS=""
command -v make &>/dev/null   || MISSING_PKGS="$MISSING_PKGS make"
command -v g++  &>/dev/null   || MISSING_PKGS="$MISSING_PKGS g++"
command -v python3 &>/dev/null || MISSING_PKGS="$MISSING_PKGS python3"
if [ -n "$MISSING_PKGS" ]; then
  echo "  → Installiere:$MISSING_PKGS"
  sudo apt-get install -y $MISSING_PKGS -qq
fi

# Python 3.13 hat distutils entfernt — Shim erstellen falls nötig
python3 -c "import distutils" 2>/dev/null || {
  echo "  → Python distutils-Shim für Python 3.13 einrichten..."
  # Erst setuptools aktualisieren
  pip3 install --quiet --upgrade setuptools 2>/dev/null || true
  # Shim-Verzeichnis anlegen
  SITE=$(python3 -c "import site; print(site.getsitepackages()[0])" 2>/dev/null || echo "/usr/local/lib/python3.13/dist-packages")
  mkdir -p "$SITE/distutils"
  cat > "$SITE/distutils/__init__.py" << 'PYEOF'
# Shim: leitet distutils auf setuptools._distutils um (Python 3.13+)
import setuptools._distutils as _du
import sys
sys.modules[__name__].__dict__.update({
    k: v for k, v in vars(_du).items() if not k.startswith('__')
})
PYEOF
  python3 -c "import distutils; print('  ✓ distutils-Shim OK')" 2>/dev/null || echo "  ⚠ distutils-Shim fehlgeschlagen – trotzdem weiter"
}

# ── npm install ─────────────────────────────────────────────────────────────
echo "▸ Abhängigkeiten installieren (kann 1–2 Min dauern)..."
cd "$APP_DIR"
npm install --omit=dev 2>&1 | grep -E "^(npm warn|npm error|added)" || true
echo "✓ Abhängigkeiten installiert"

# ── Verzeichnisse anlegen und Berechtigungen setzen ─────────────────────────
mkdir -p "$APP_DIR/data" "$APP_DIR/uploads/branding" "$APP_DIR/uploads/attachments" "$APP_DIR/backups"
sudo chown -R "$APP_USER:$APP_USER" "$APP_DIR/data" "$APP_DIR/uploads" "$APP_DIR/backups"
# .env lesbar für Service-User
sudo chown root:"$APP_USER" "$APP_DIR/.env" 2>/dev/null || true
sudo chmod 640 "$APP_DIR/.env" 2>/dev/null || true
echo "✓ Verzeichnisse angelegt und Berechtigungen gesetzt"

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
  echo "✓ .env vorhanden"
fi
sudo chown root:"$APP_USER" "$APP_DIR/.env" 2>/dev/null || true
sudo chmod 640 "$APP_DIR/.env" 2>/dev/null || true

# ── Datenbank initialisieren ────────────────────────────────────────────────
echo "▸ Datenbank initialisieren..."
node -e "require('./src/db/database.js')" && echo "✓ Datenbank bereit"
sudo chown "$APP_USER:$APP_USER" "$APP_DIR/data/database.sqlite" 2>/dev/null || true
# update.log muss existieren damit ProtectSystem=strict/ReadWritePaths greift
touch "$APP_DIR/update.log"
sudo chown "$APP_USER:$APP_USER" "$APP_DIR/update.log"

# ── Sudo-Regel für App-Updates (git pull + npm install ohne Passwort) ────────
SUDOERS_FILE="/etc/sudoers.d/${APP_NAME}"
sudo tee "$SUDOERS_FILE" > /dev/null << EOF
# Erlaubt dem $APP_USER-Service git pull und npm install für App-Updates
$APP_USER ALL=(root) NOPASSWD: /usr/bin/git -C ${APP_DIR} pull origin main
$APP_USER ALL=(root) NOPASSWD: /usr/bin/npm install --production
EOF
sudo chmod 440 "$SUDOERS_FILE"
echo "✓ Sudo-Regel für App-Updates eingerichtet"

# ── Systemd-Service ─────────────────────────────────────────────────────────
if [[ "${AUTOSTART^^}" == "Y" ]]; then
  sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Druckerei Tracker
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=$(command -v node) src/server.js
Restart=on-failure
RestartSec=5
EnvironmentFile=${APP_DIR}/.env
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${APP_DIR}/data ${APP_DIR}/uploads ${APP_DIR}/backups ${APP_DIR}/update.log

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
echo "  ║    Passwort: admin                       ║"
echo "  ║  (bitte sofort ändern!)                  ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""
