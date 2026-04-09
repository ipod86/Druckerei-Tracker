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
