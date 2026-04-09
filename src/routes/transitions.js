'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET / - all transition fields grouped by to_group_id
router.get('/', requireAuth, (req, res) => {
  const fields = db.prepare(`
    SELECT tf.*, g1.name as from_group_name, g2.name as to_group_name
    FROM transition_fields tf
    LEFT JOIN groups g1 ON tf.from_group_id = g1.id
    JOIN groups g2 ON tf.to_group_id = g2.id
    ORDER BY tf.to_group_id, tf.order_index
  `).all();

  // Parse field_options
  for (const f of fields) {
    if (f.field_options) {
      try { f.field_options = JSON.parse(f.field_options); } catch (e) { f.field_options = []; }
    }
  }

  // Group by to_group_id
  const grouped = {};
  for (const f of fields) {
    if (!grouped[f.to_group_id]) grouped[f.to_group_id] = [];
    grouped[f.to_group_id].push(f);
  }

  res.json(grouped);
});

// GET /group/:toGroupId
router.get('/group/:toGroupId', requireAuth, (req, res) => {
  const fields = db.prepare(`
    SELECT tf.*, g1.name as from_group_name, g2.name as to_group_name
    FROM transition_fields tf
    LEFT JOIN groups g1 ON tf.from_group_id = g1.id
    JOIN groups g2 ON tf.to_group_id = g2.id
    WHERE tf.to_group_id = ?
    ORDER BY tf.order_index
  `).all(req.params.toGroupId);

  for (const f of fields) {
    if (f.field_options) {
      try { f.field_options = JSON.parse(f.field_options); } catch (e) { f.field_options = []; }
    }
  }

  res.json(fields);
});

// POST /
router.post('/', requireAdmin, (req, res) => {
  const { from_group_id, to_group_id, field_name, field_type, field_options, required, order_index } = req.body;
  if (!to_group_id || !field_name) return res.status(400).json({ error: 'to_group_id and field_name required' });

  const maxOrder = db.prepare('SELECT MAX(order_index) as mx FROM transition_fields WHERE to_group_id = ?').get(to_group_id);

  const result = db.prepare(`
    INSERT INTO transition_fields (from_group_id, to_group_id, field_name, field_type, field_options, required, order_index)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    from_group_id || null,
    to_group_id,
    field_name,
    field_type || 'text',
    field_options ? JSON.stringify(field_options) : null,
    required ? 1 : 0,
    order_index !== undefined ? order_index : (maxOrder.mx || 0) + 1
  );

  const field = db.prepare('SELECT * FROM transition_fields WHERE id = ?').get(result.lastInsertRowid);
  if (field.field_options) try { field.field_options = JSON.parse(field.field_options); } catch (e) {}
  res.status(201).json(field);
});

// PUT /:id
router.put('/:id', requireAdmin, (req, res) => {
  const { from_group_id, to_group_id, field_name, field_type, field_options, required, order_index } = req.body;
  const field = db.prepare('SELECT * FROM transition_fields WHERE id = ?').get(req.params.id);
  if (!field) return res.status(404).json({ error: 'Field not found' });

  db.prepare(`
    UPDATE transition_fields SET
      from_group_id = ?,
      to_group_id = COALESCE(?, to_group_id),
      field_name = COALESCE(?, field_name),
      field_type = COALESCE(?, field_type),
      field_options = ?,
      required = COALESCE(?, required),
      order_index = COALESCE(?, order_index)
    WHERE id = ?
  `).run(
    from_group_id !== undefined ? from_group_id : field.from_group_id,
    to_group_id || null,
    field_name || null,
    field_type || null,
    field_options !== undefined ? JSON.stringify(field_options) : field.field_options,
    required !== undefined ? (required ? 1 : 0) : null,
    order_index || null,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM transition_fields WHERE id = ?').get(req.params.id);
  if (updated.field_options) try { updated.field_options = JSON.parse(updated.field_options); } catch (e) {}
  res.json(updated);
});

// DELETE /:id
router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM transition_fields WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
