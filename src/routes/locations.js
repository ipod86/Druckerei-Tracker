'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET /
router.get('/', requireAuth, (req, res) => {
  const locations = db.prepare('SELECT * FROM locations ORDER BY name').all();
  res.json(locations);
});

// POST /
router.post('/', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const result = db.prepare('INSERT INTO locations (name) VALUES (?)').run(name);
  const location = db.prepare('SELECT * FROM locations WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(location);
});

// PUT /:id
router.put('/:id', requireAdmin, (req, res) => {
  const { name, active } = req.body;
  const loc = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id);
  if (!loc) return res.status(404).json({ error: 'Location not found' });

  db.prepare('UPDATE locations SET name = COALESCE(?, name), active = COALESCE(?, active) WHERE id = ?')
    .run(name || null, active !== undefined ? active : null, req.params.id);

  const updated = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /:id
router.delete('/:id', requireAdmin, (req, res) => {
  const loc = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id);
  if (!loc) return res.status(404).json({ error: 'Location not found' });

  // Check if any users or cards reference this location
  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE location_id = ? AND active = 1').get(req.params.id);
  if (userCount.cnt > 0) {
    return res.status(409).json({ error: 'Location has active users' });
  }

  db.prepare('UPDATE locations SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
