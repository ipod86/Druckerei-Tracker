'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/database');
const { requireAdmin, requireAuth } = require('../middleware/auth');

// Branding upload storage
const brandingStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.resolve(process.env.UPLOAD_PATH || './uploads', 'branding');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Keep fixed names for logo/favicon
    cb(null, file.fieldname === 'logo' ? 'logo.png' : 'favicon.ico');
  }
});
const brandingUpload = multer({ storage: brandingStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// GET /settings
router.get('/settings', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

// PUT /settings
router.put('/settings', requireAdmin, (req, res) => {
  const update = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const updateMany = db.transaction(() => {
    for (const [key, value] of Object.entries(req.body)) {
      update.run(key, String(value));
    }
  });
  updateMany();
  res.json({ success: true });
});

// POST /settings/logo
router.post('/settings/logo', requireAdmin, (req, res) => {
  brandingUpload.single('logo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('logo_path', '/uploads/branding/logo.png');
    res.json({ path: '/uploads/branding/logo.png' });
  });
});

// POST /settings/favicon
router.post('/settings/favicon', requireAdmin, (req, res) => {
  brandingUpload.single('favicon')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('favicon_path', '/uploads/branding/favicon.ico');
    res.json({ path: '/uploads/branding/favicon.ico' });
  });
});

// GET /backup/status
router.get('/backup/status', requireAdmin, (req, res) => {
  const last = db.prepare('SELECT * FROM backup_log ORDER BY started_at DESC LIMIT 1').get();
  res.json(last || null);
});

// POST /backup/run
router.post('/backup/run', requireAdmin, async (req, res) => {
  try {
    const { runBackup } = require('../services/backup');
    const result = await runBackup();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /backup/list
router.get('/backup/list', requireAdmin, (req, res) => {
  const fs = require('fs');
  const backupPath = path.resolve(process.env.BACKUP_PATH || './backups');
  try {
    const dirs = fs.readdirSync(backupPath)
      .filter(d => d.startsWith('backup-'))
      .map(d => {
        const stat = fs.statSync(path.join(backupPath, d));
        return { name: d, created_at: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    res.json(dirs);
  } catch(e) { res.json([]); }
});

// POST /backup/restore
router.post('/backup/restore', requireAdmin, (req, res) => {
  const { backup_name } = req.body;
  if (!backup_name || !/^backup-[\d\-T]+$/.test(backup_name)) {
    return res.status(400).json({ error: 'Ungültiger Backup-Name' });
  }
  const fs = require('fs');
  const backupPath = path.resolve(process.env.BACKUP_PATH || './backups');
  const backupDir = path.join(backupPath, backup_name);
  if (!fs.existsSync(backupDir)) return res.status(404).json({ error: 'Backup nicht gefunden' });

  const dbPath = path.resolve(process.env.DB_PATH || './data/database.sqlite');
  const uploadPath = path.resolve(process.env.UPLOAD_PATH || './uploads');
  const appDir = path.resolve(__dirname, '../..');

  const restoredDb = path.join(backupDir, 'database.sqlite');
  if (!fs.existsSync(restoredDb)) return res.status(400).json({ error: 'Keine Datenbank im Backup gefunden' });

  res.json({ ok: true, message: 'Restore wird durchgeführt, App startet neu…' });

  // Copy DB
  fs.copyFileSync(restoredDb, dbPath);

  // Copy uploads
  const restoredUploads = path.join(backupDir, 'uploads');
  if (fs.existsSync(restoredUploads)) {
    const { execSync } = require('child_process');
    execSync(`cp -a "${restoredUploads}/." "${uploadPath}/"`);
  }

  // Restart
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [path.join(appDir, 'src/server.js')], {
    detached: true,
    stdio: 'ignore',
    cwd: appDir, env: process.env,
  });
  child.unref();
  setTimeout(() => process.exit(1), 500);
});

// ---- Checklist Templates ----

router.get('/checklist-templates', requireAuth, (req, res) => {
  const templates = db.prepare('SELECT * FROM checklist_templates ORDER BY name').all();
  for (const tpl of templates) {
    tpl.items = db.prepare('SELECT * FROM checklist_template_items WHERE template_id = ? ORDER BY order_index').all(tpl.id);
  }
  res.json(templates);
});

router.post('/checklist-templates', requireAdmin, (req, res) => {
  const { name, trigger_column_id, trigger_group_id, items } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const result = db.prepare('INSERT INTO checklist_templates (name, trigger_column_id, trigger_group_id) VALUES (?, ?, ?)')
    .run(name, trigger_column_id || null, trigger_group_id || null);

  const templateId = result.lastInsertRowid;

  if (Array.isArray(items)) {
    for (let i = 0; i < items.length; i++) {
      db.prepare('INSERT INTO checklist_template_items (template_id, text, order_index) VALUES (?, ?, ?)')
        .run(templateId, items[i].text || items[i], i);
    }
  }

  const tpl = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(templateId);
  tpl.items = db.prepare('SELECT * FROM checklist_template_items WHERE template_id = ? ORDER BY order_index').all(templateId);
  res.status(201).json(tpl);
});

router.put('/checklist-templates/:id', requireAdmin, (req, res) => {
  const { name, trigger_column_id, trigger_group_id, items } = req.body;
  const tpl = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Template not found' });

  db.prepare('UPDATE checklist_templates SET name = COALESCE(?, name), trigger_column_id = ?, trigger_group_id = ? WHERE id = ?')
    .run(name || null, trigger_column_id !== undefined ? trigger_column_id : tpl.trigger_column_id, trigger_group_id !== undefined ? trigger_group_id : tpl.trigger_group_id, req.params.id);

  if (Array.isArray(items)) {
    db.prepare('DELETE FROM checklist_template_items WHERE template_id = ?').run(req.params.id);
    for (let i = 0; i < items.length; i++) {
      db.prepare('INSERT INTO checklist_template_items (template_id, text, order_index) VALUES (?, ?, ?)')
        .run(req.params.id, items[i].text || items[i], i);
    }
  }

  const updated = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(req.params.id);
  updated.items = db.prepare('SELECT * FROM checklist_template_items WHERE template_id = ? ORDER BY order_index').all(req.params.id);
  res.json(updated);
});

router.delete('/checklist-templates/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM checklist_template_items WHERE template_id = ?').run(req.params.id);
  db.prepare('DELETE FROM checklist_templates WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET /sysinfo
router.get('/sysinfo', requireAdmin, (req, res) => {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const pathMod = require('path');

  const appPkg = (() => {
    try { return JSON.parse(fs.readFileSync(pathMod.join(__dirname, '../../package.json'), 'utf8')); } catch(e) { return {}; }
  })();

  const cardCount = db.prepare('SELECT COUNT(*) as cnt FROM cards WHERE archived = 0').get().cnt;
  const archivedCount = db.prepare('SELECT COUNT(*) as cnt FROM cards WHERE archived = 1').get().cnt;
  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE active = 1').get().cnt;
  const customerCount = db.prepare('SELECT COUNT(*) as cnt FROM customers').get().cnt;

  const dbPath = path.resolve(process.env.DB_PATH || './data/database.sqlite');
  let dbSize = '—';
  try { dbSize = (fs.statSync(dbPath).size / 1024).toFixed(1) + ' KB'; } catch(e) {}

  const uploadsDir = path.resolve(process.env.UPLOAD_PATH || './uploads');
  let uploadSize = '—';
  try {
    const result = execSync(`du -sh "${uploadsDir}" 2>/dev/null || echo "0"`, { encoding: 'utf8' });
    uploadSize = result.split('\t')[0] || '—';
  } catch(e) {}

  // npm module versions (installed)
  const npmModules = [];
  const deps = Object.keys(appPkg.dependencies || {});
  const nodeModulesDir = pathMod.join(__dirname, '../../node_modules');
  for (const dep of deps) {
    try {
      const depPkg = JSON.parse(fs.readFileSync(pathMod.join(nodeModulesDir, dep, 'package.json'), 'utf8'));
      npmModules.push({ name: dep, version: depPkg.version || '?', required: appPkg.dependencies[dep] });
    } catch(e) {
      npmModules.push({ name: dep, version: 'nicht installiert', required: appPkg.dependencies[dep] });
    }
  }

  // System packages via dpkg
  let systemPackages = [];
  try {
    const dpkgOut = execSync(
      'dpkg -l nodejs npm git sqlite3 libsqlite3-0 openssl nginx 2>/dev/null | grep "^ii" || true',
      { encoding: 'utf8', timeout: 5000 }
    );
    for (const line of dpkgOut.trim().split('\n')) {
      if (!line) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) systemPackages.push({ name: parts[1].replace(/:.*/, ''), version: parts[2] });
    }
  } catch(e) {}

  // OS info
  let osInfo = '—';
  try { osInfo = fs.readFileSync('/etc/os-release', 'utf8').match(/PRETTY_NAME="([^"]+)"/)?.[1] || '—'; } catch(e) {}

  res.json({
    version: appPkg.version || '1.0.0',
    node_version: process.version,
    platform: process.platform,
    os_info: osInfo,
    uptime_seconds: Math.floor(process.uptime()),
    memory_mb: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1),
    db_size: dbSize,
    upload_size: uploadSize,
    cards_active: cardCount,
    cards_archived: archivedCount,
    users_active: userCount,
    customers: customerCount,
    npm_modules: npmModules,
    system_packages: systemPackages,
  });
});

// POST /update - download ZIP from GitHub and restart
router.post('/update', requireAdmin, (req, res) => {
  const { spawn } = require('child_process');
  const fsSync = require('fs');
  const appDir = path.resolve(__dirname, '../..');
  const logFile = path.join(appDir, 'update.log');
  const zipUrl  = 'https://github.com/ipod86/Druckerei-Tracker/archive/refs/heads/main.zip';
  const tmpZip  = `/tmp/druckerei-update-${process.pid}.zip`;
  const tmpDir  = `/tmp/druckerei-update-${process.pid}`;

  res.json({ success: true, message: 'Update wird im Hintergrund ausgeführt...' });

  const log = (msg) => { try { fsSync.appendFileSync(logFile, msg + '\n'); } catch(_) {} };
  log(`\n\n=== Update gestartet: ${new Date().toISOString()} ===`);

  // Hintergrund-Script: Node bleibt reaktionsfähig für Log-Polls
  const script = `
set -e
command -v rsync >/dev/null || apt-get install -y rsync -qq
echo "▸ Herunterladen..." >> "${logFile}"
wget -q -O "${tmpZip}" "${zipUrl}"
echo "▸ Entpacken..." >> "${logFile}"
mkdir -p "${tmpDir}" && unzip -q "${tmpZip}" -d "${tmpDir}"
echo "▸ Dateien kopieren..." >> "${logFile}"
rsync -a --delete --exclude=data/ --exclude=uploads/ --exclude=backups/ --exclude=.env --exclude=update.log --exclude=node_modules/ "${tmpDir}/Druckerei-Tracker-main/" "${appDir}/"
echo "▸ Abhängigkeiten installieren..." >> "${logFile}"
cd "${appDir}" && npm install --omit=dev >> "${logFile}" 2>&1
rm -rf "${tmpZip}" "${tmpDir}"
echo "=== Update erfolgreich ===" >> "${logFile}"
`;

  const child = spawn('bash', ['-c', script], { detached: true, stdio: 'ignore' });
  child.unref();

  // Warte auf "=== Update erfolgreich ===" dann neu starten
  let waited = 0;
  const check = setInterval(() => {
    waited += 2000;
    try {
      const content = fsSync.readFileSync(logFile, 'utf8');
      if (content.includes('=== Update erfolgreich ===')) {
        clearInterval(check);
        log('▸ Neustart...');
        setTimeout(() => process.exit(1), 500);
      }
    } catch(_) {}
    if (waited > 180000) { clearInterval(check); log('FEHLER: Timeout'); }
  }, 2000);
});

// GET /update-log
router.get('/update-log', requireAdmin, (req, res) => {
  const appDir = path.resolve(__dirname, '../..');
  const logFile = path.join(appDir, 'update.log');
  try {
    const content = require('fs').readFileSync(logFile, 'utf8');
    res.json({ log: content.slice(-10000) }); // last 10KB
  } catch(e) {
    res.json({ log: 'Kein Update-Log vorhanden.' });
  }
});

// GET /npm-outdated - run npm outdated and return results
router.get('/npm-outdated', requireAdmin, (req, res) => {
  const { execSync } = require('child_process');
  const appDir = path.resolve(__dirname, '../..');
  try {
    const out = execSync('npm outdated --json 2>/dev/null || true', { cwd: appDir, encoding: 'utf8', timeout: 30000 });
    let data = {};
    try { data = JSON.parse(out || '{}'); } catch(e) {}
    const packages = Object.entries(data).map(([name, info]) => ({
      name,
      current: info.current || '?',
      wanted: info.wanted || '?',
      latest: info.latest || '?',
    }));
    res.json({ packages });
  } catch(e) {
    res.json({ packages: [], error: e.message });
  }
});

// GET /latest-version - check GitHub for latest release
router.get('/latest-version', requireAdmin, async (req, res) => {
  try {
    const https = require('https');
    const data = await new Promise((resolve, reject) => {
      const req2 = https.get('https://api.github.com/repos/ipod86/Druckerei-Tracker/releases/latest', {
        headers: { 'User-Agent': 'druckerei-tracker' }
      }, (r) => {
        let body = '';
        r.on('data', d => body += d);
        r.on('end', () => {
          try { resolve(JSON.parse(body)); } catch(e) { reject(e); }
        });
      });
      req2.on('error', reject);
      req2.setTimeout(5000, () => { req2.destroy(); reject(new Error('timeout')); });
    });
    res.json({ tag_name: data.tag_name || null, html_url: data.html_url || null });
  } catch(e) {
    res.json({ tag_name: null, error: e.message });
  }
});

// POST /email/test
router.post('/email/test', requireAdmin, async (req, res) => {
  try {
    const { sendEmail } = require('../services/email');
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'to email required' });
    await sendEmail(to, 'Test Email - Druckerei Tracker', '<p>Diese E-Mail bestätigt, dass Ihr SMTP-Server korrekt konfiguriert ist.</p>');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
