'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET / - all groups with their columns
router.get('/', requireAuth, (req, res) => {
  const groups = db.prepare('SELECT * FROM groups ORDER BY order_index').all();
  const columns = db.prepare('SELECT * FROM columns ORDER BY order_index').all();

  const result = groups.map(g => ({
    ...g,
    columns: columns.filter(c => c.group_id === g.id),
  }));
  res.json(result);
});

// POST / - create group
router.post('/', requireAdmin, (req, res) => {
  const { name, color, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const maxOrder = db.prepare('SELECT MAX(order_index) as mx FROM groups').get();
  const order_index = (maxOrder.mx || 0) + 1;

  const result = db.prepare('INSERT INTO groups (name, order_index, color, description) VALUES (?, ?, ?, ?)')
    .run(name, order_index, color || '#4a90d9', description || null);

  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...group, columns: [] });
});

// PUT /reorder - reorder groups
router.put('/reorder', requireAdmin, (req, res) => {
  const { order } = req.body; // array of { id, order_index }
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });

  const update = db.prepare('UPDATE groups SET order_index = ? WHERE id = ?');
  const updateMany = db.transaction(() => {
    for (const item of order) {
      update.run(item.order_index, item.id);
    }
  });
  updateMany();
  res.json({ success: true });
});

// PUT /:id - update group
router.put('/:id', requireAdmin, (req, res) => {
  const { name, color, description, order_index } = req.body;
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  db.prepare('UPDATE groups SET name = COALESCE(?, name), color = COALESCE(?, color), description = ?, order_index = COALESCE(?, order_index) WHERE id = ?')
    .run(name || null, color || null, description !== undefined ? description : group.description, order_index || null, req.params.id);

  const updated = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /:id - delete group (only if no columns)
router.delete('/:id', requireAdmin, (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const colCount = db.prepare('SELECT COUNT(*) as cnt FROM columns WHERE group_id = ?').get(req.params.id);
  if (colCount.cnt > 0) {
    return res.status(409).json({ error: 'Group has columns. Delete columns first.' });
  }

  db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
