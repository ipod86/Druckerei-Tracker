'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET / - all columns with group info
router.get('/', requireAuth, (req, res) => {
  const columns = db.prepare(`
    SELECT c.*, g.name as group_name, g.color as group_color, g.order_index as group_order
    FROM columns c
    JOIN groups g ON c.group_id = g.id
    ORDER BY g.order_index, c.order_index
  `).all();
  res.json(columns);
});

// POST / - create column
router.post('/', requireAdmin, (req, res) => {
  const { group_id, name, time_limit_hours, time_limit_days, escalation_time, escalation_emails, reminder_interval_hours, color } = req.body;
  if (!group_id || !name) return res.status(400).json({ error: 'group_id and name required' });

  const maxOrder = db.prepare('SELECT MAX(order_index) as mx FROM columns WHERE group_id = ?').get(group_id);
  const order_index = (maxOrder.mx !== null ? maxOrder.mx : -1) + 1;

  const result = db.prepare(`
    INSERT INTO columns (group_id, name, order_index, time_limit_hours, time_limit_days, escalation_time, escalation_emails, reminder_interval_hours, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    group_id, name, order_index,
    time_limit_hours || null,
    time_limit_days !== undefined ? (time_limit_days || null) : null,
    escalation_time || null,
    escalation_emails ? JSON.stringify(escalation_emails) : null,
    reminder_interval_hours || 24,
    color || null
  );

  const col = db.prepare(`
    SELECT c.*, g.name as group_name, g.color as group_color
    FROM columns c JOIN groups g ON c.group_id = g.id
    WHERE c.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json(col);
});

// PUT /reorder - reorder columns within group
router.put('/reorder', requireAdmin, (req, res) => {
  const { order } = req.body; // array of { id, order_index }
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });

  const update = db.prepare('UPDATE columns SET order_index = ? WHERE id = ?');
  const updateMany = db.transaction(() => {
    for (const item of order) {
      update.run(item.order_index, item.id);
    }
  });
  updateMany();
  res.json({ success: true });
});

// PUT /:id - update column
router.put('/:id', requireAdmin, (req, res) => {
  const { name, time_limit_hours, time_limit_days, escalation_time, escalation_emails, reminder_interval_hours, color, group_id } = req.body;
  const col = db.prepare('SELECT * FROM columns WHERE id = ?').get(req.params.id);
  if (!col) return res.status(404).json({ error: 'Column not found' });

  db.prepare(`
    UPDATE columns SET
      name = COALESCE(?, name),
      time_limit_hours = ?,
      time_limit_days = ?,
      escalation_time = ?,
      escalation_emails = ?,
      reminder_interval_hours = COALESCE(?, reminder_interval_hours),
      color = ?,
      group_id = COALESCE(?, group_id)
    WHERE id = ?
  `).run(
    name || null,
    time_limit_hours !== undefined ? time_limit_hours : col.time_limit_hours,
    time_limit_days !== undefined ? (time_limit_days || null) : col.time_limit_days,
    escalation_time !== undefined ? (escalation_time || null) : col.escalation_time,
    escalation_emails !== undefined ? JSON.stringify(escalation_emails) : col.escalation_emails,
    reminder_interval_hours || null,
    color !== undefined ? color : col.color,
    group_id || null,
    req.params.id
  );

  const updated = db.prepare(`
    SELECT c.*, g.name as group_name, g.color as group_color
    FROM columns c JOIN groups g ON c.group_id = g.id
    WHERE c.id = ?
  `).get(req.params.id);
  res.json(updated);
});

// DELETE /:id - delete column (only if no cards)
router.delete('/:id', requireAdmin, (req, res) => {
  const col = db.prepare('SELECT * FROM columns WHERE id = ?').get(req.params.id);
  if (!col) return res.status(404).json({ error: 'Column not found' });

  const cardCount = db.prepare('SELECT COUNT(*) as cnt FROM cards WHERE column_id = ? AND archived = 0').get(req.params.id);
  if (cardCount.cnt > 0) {
    return res.status(409).json({ error: 'Column has active cards. Archive or move them first.' });
  }

  db.prepare('DELETE FROM columns WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
