'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET /
router.get('/', requireAuth, (req, res) => {
  const labels = db.prepare('SELECT * FROM labels ORDER BY name').all();
  res.json(labels);
});

// POST /
router.post('/', requireAdmin, (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const result = db.prepare('INSERT INTO labels (name, color) VALUES (?, ?)').run(name, color || '#4a90d9');
  const label = db.prepare('SELECT * FROM labels WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(label);
});

// PUT /:id
router.put('/:id', requireAdmin, (req, res) => {
  const { name, color } = req.body;
  const label = db.prepare('SELECT * FROM labels WHERE id = ?').get(req.params.id);
  if (!label) return res.status(404).json({ error: 'Label not found' });

  db.prepare('UPDATE labels SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ?')
    .run(name || null, color || null, req.params.id);

  const updated = db.prepare('SELECT * FROM labels WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /:id
router.delete('/:id', requireAdmin, (req, res) => {
  const label = db.prepare('SELECT * FROM labels WHERE id = ?').get(req.params.id);
  if (!label) return res.status(404).json({ error: 'Label not found' });

  db.prepare('DELETE FROM card_labels WHERE label_id = ?').run(req.params.id);
  db.prepare('DELETE FROM labels WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
