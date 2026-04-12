# Druckerei Tracker – Installation

Kanban-basiertes Auftragsverwaltungssystem für Druckereien.

---

## Voraussetzungen

- Linux (Debian/Ubuntu empfohlen)
- **Node.js 18 oder neuer**
- `wget` und `unzip` (meist vorinstalliert)

### Node.js installieren (falls nicht vorhanden)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs
```

---

## Installation

```bash
wget -qO- https://raw.githubusercontent.com/ipod86/Druckerei-Tracker/main/install.sh | bash
```

Das Skript erledigt automatisch:

- ZIP von GitHub herunterladen und entpacken
- Abhängigkeiten installieren (`npm install`)
- `.env` mit zufälligem Session-Secret anlegen
- Datenbank initialisieren
- Optionalen Autostart via systemd einrichten
- Temporäre Dateien löschen

Installiert wird nach `/opt/druckerei-tracker`. Eigener Pfad:

```bash
wget -qO- https://raw.githubusercontent.com/ipod86/Druckerei-Tracker/main/install.sh | bash -s /pfad/nach/wahl
```

---

## Update

Denselben Befehl nochmal ausführen. Vorhandene Daten (`.env`, Datenbank, Uploads) bleiben erhalten.

```bash
wget -qO- https://raw.githubusercontent.com/ipod86/Druckerei-Tracker/main/install.sh | bash
```

---

## Standard-Login

Nach der Installation im Browser öffnen:

```
http://<server-ip>:<port>
```

| Feld       | Wert       |
|------------|------------|
| Benutzer   | `admin`    |
| Passwort   | `admin` |

> **Passwort sofort nach dem ersten Login ändern!**

---

## Konfiguration

Die Konfiguration liegt in `/opt/druckerei-tracker/.env`:

| Variable                   | Beschreibung                        | Standard              |
|----------------------------|-------------------------------------|-----------------------|
| `PORT`                     | Port auf dem die App läuft          | `3000`                |
| `SESSION_SECRET`           | Geheimer Schlüssel für Sessions     | *(automatisch generiert)* |
| `DB_PATH`                  | Pfad zur SQLite-Datenbank           | `./data/database.sqlite` |
| `UPLOAD_PATH`              | Pfad für hochgeladene Dateien       | `./uploads`           |
| `BACKUP_PATH`              | Pfad für Backups                    | `./backups`           |
| `SESSION_TIMEOUT_MINUTES`  | Session-Timeout in Minuten          | `60`                  |

Nach Änderungen Service neu starten:

```bash
sudo systemctl restart druckerei-tracker
```

---

## Service-Befehle

```bash
sudo systemctl status  druckerei-tracker   # Status anzeigen
sudo systemctl start   druckerei-tracker   # Starten
sudo systemctl stop    druckerei-tracker   # Stoppen
sudo systemctl restart druckerei-tracker   # Neu starten

journalctl -u druckerei-tracker -f         # Live-Log anzeigen
```

---

## Deinstallation

```bash
sudo systemctl stop    druckerei-tracker
sudo systemctl disable druckerei-tracker
sudo rm -f /etc/systemd/system/druckerei-tracker.service
sudo systemctl daemon-reload
sudo rm -rf /opt/druckerei-tracker
```
