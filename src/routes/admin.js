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
  const appPkg = (() => {
    try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../../package.json'), 'utf8')); } catch(e) { return {}; }
  })();

  const cardCount = db.prepare('SELECT COUNT(*) as cnt FROM cards WHERE archived = 0').get().cnt;
  const archivedCount = db.prepare('SELECT COUNT(*) as cnt FROM cards WHERE archived = 1').get().cnt;
  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE active = 1').get().cnt;
  const customerCount = db.prepare('SELECT COUNT(*) as cnt FROM customers').get().cnt;

  const dbPath = path.resolve(process.env.DB_PATH || './data/database.sqlite');
  let dbSize = '—';
  try { dbSize = (require('fs').statSync(dbPath).size / 1024).toFixed(1) + ' KB'; } catch(e) {}

  const uploadsDir = path.resolve(process.env.UPLOAD_PATH || './uploads');
  let uploadSize = '—';
  try {
    const { execSync } = require('child_process');
    const result = execSync(`du -sh "${uploadsDir}" 2>/dev/null || echo "0"`, { encoding: 'utf8' });
    uploadSize = result.split('\t')[0] || '—';
  } catch(e) {}

  res.json({
    version: appPkg.version || '1.0.0',
    node_version: process.version,
    platform: process.platform,
    uptime_seconds: Math.floor(process.uptime()),
    memory_mb: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1),
    db_size: dbSize,
    upload_size: uploadSize,
    cards_active: cardCount,
    cards_archived: archivedCount,
    users_active: userCount,
    customers: customerCount,
  });
});

// POST /update - pull latest from git and restart
router.post('/update', requireAdmin, async (req, res) => {
  const { exec } = require('child_process');
  const appDir = path.resolve(__dirname, '../..');
  const logFile = path.join(appDir, 'update.log');

  res.json({ success: true, message: 'Update wird im Hintergrund ausgeführt...' });

  const timestamp = new Date().toISOString();
  const logStream = require('fs').createWriteStream(logFile, { flags: 'a' });
  logStream.write(`\n\n=== Update gestartet: ${timestamp} ===\n`);

  exec(`cd "${appDir}" && git pull origin main 2>&1 && npm install --production 2>&1`, (err, stdout, stderr) => {
    const output = stdout + (stderr || '');
    logStream.write(output + '\n');
    if (err) {
      logStream.write(`FEHLER: ${err.message}\n`);
      logStream.end();
      return;
    }
    logStream.write('=== Update erfolgreich, starte neu... ===\n');
    logStream.end();
    // Graceful restart: exit and let process manager (pm2/systemd) restart
    setTimeout(() => process.exit(0), 500);
  });
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
