'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET / - all boards
router.get('/', requireAuth, (req, res) => {
  const boards = db.prepare('SELECT * FROM boards ORDER BY order_index, id').all();
  res.json(boards);
});

// POST / - create board
router.post('/', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const maxOrder = db.prepare('SELECT MAX(order_index) as mx FROM boards').get();
  const result = db.prepare('INSERT INTO boards (name, order_index) VALUES (?, ?)')
    .run(name, (maxOrder.mx ?? 0) + 1);

  res.status(201).json(db.prepare('SELECT * FROM boards WHERE id = ?').get(result.lastInsertRowid));
});

// PUT /reorder
router.put('/reorder', requireAdmin, (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });

  const update = db.prepare('UPDATE boards SET order_index = ? WHERE id = ?');
  db.transaction(() => { for (const item of order) update.run(item.order_index, item.id); })();
  res.json({ ok: true });
});

// PUT /:id
router.put('/:id', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  db.prepare('UPDATE boards SET name = ? WHERE id = ?').run(name, req.params.id);
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: 'Board not found' });
  res.json(board);
});

// DELETE /:id
router.delete('/:id', requireAdmin, (req, res) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: 'Board not found' });

  const total = db.prepare('SELECT COUNT(*) as cnt FROM boards').get();
  if (total.cnt <= 1) return res.status(409).json({ error: 'Mindestens ein Board muss vorhanden sein' });

  const groupCount = db.prepare('SELECT COUNT(*) as cnt FROM groups WHERE board_id = ?').get(req.params.id);
  if (groupCount.cnt > 0) return res.status(409).json({ error: 'Board hat noch Gruppen. Zuerst Gruppen löschen oder verschieben.' });

  db.prepare('DELETE FROM boards WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
