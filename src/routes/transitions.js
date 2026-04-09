'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET / - all named transitions with their fields
router.get('/', requireAuth, (req, res) => {
  const transitions = db.prepare(`
    SELECT t.*, g1.name as from_group_name, g2.name as to_group_name
    FROM transitions t
    JOIN groups g1 ON t.from_group_id = g1.id
    LEFT JOIN groups g2 ON t.to_group_id = g2.id
    ORDER BY t.from_group_id, t.order_index, t.id
  `).all();

  for (const t of transitions) {
    const fields = db.prepare(`
      SELECT * FROM transition_fields WHERE transition_id = ? ORDER BY order_index
    `).all(t.id);
    for (const f of fields) {
      if (f.field_options) {
        try { f.field_options = JSON.parse(f.field_options); } catch (e) { f.field_options = []; }
      }
    }
    t.fields = fields;
  }

  res.json(transitions);
});

// GET /group/:fromGroupId - flat field list for move modal, triggered by leaving this group
router.get('/group/:fromGroupId', requireAuth, (req, res) => {
  const toGroupId = req.query.to;

  let query = `
    SELECT tf.*, t.name as transition_name, t.id as transition_id,
           g1.name as from_group_name, g2.name as to_group_name
    FROM transition_fields tf
    JOIN transitions t ON tf.transition_id = t.id
    JOIN groups g1 ON t.from_group_id = g1.id
    LEFT JOIN groups g2 ON t.to_group_id = g2.id
    WHERE t.from_group_id = ?
  `;
  const params = [req.params.fromGroupId];

  if (toGroupId) {
    query += ` AND (t.to_group_id IS NULL OR t.to_group_id = ?)`;
    params.push(toGroupId);
  }

  query += ` ORDER BY t.order_index, t.id, tf.order_index`;

  const fields = db.prepare(query).all(...params);
  for (const f of fields) {
    if (f.field_options) {
      try { f.field_options = JSON.parse(f.field_options); } catch (e) { f.field_options = []; }
    }
  }

  res.json(fields);
});

// POST / - create named transition (from_group_id required, to_group_id optional)
router.post('/', requireAdmin, (req, res) => {
  const { name, from_group_id, to_group_id } = req.body;
  if (!name || !from_group_id) return res.status(400).json({ error: 'name and from_group_id required' });

  const maxOrder = db.prepare('SELECT MAX(order_index) as mx FROM transitions WHERE from_group_id = ?').get(from_group_id);
  const result = db.prepare(`
    INSERT INTO transitions (name, from_group_id, to_group_id, order_index)
    VALUES (?, ?, ?, ?)
  `).run(name, from_group_id, to_group_id || null, (maxOrder.mx || 0) + 1);

  const transition = db.prepare(`
    SELECT t.*, g1.name as from_group_name, g2.name as to_group_name
    FROM transitions t
    JOIN groups g1 ON t.from_group_id = g1.id
    LEFT JOIN groups g2 ON t.to_group_id = g2.id
    WHERE t.id = ?
  `).get(result.lastInsertRowid);
  transition.fields = [];
  res.status(201).json(transition);
});

// PUT /fields/:fieldId - edit a field (must come before PUT /:id)
router.put('/fields/:fieldId', requireAdmin, (req, res) => {
  const field = db.prepare('SELECT * FROM transition_fields WHERE id = ?').get(req.params.fieldId);
  if (!field) return res.status(404).json({ error: 'Field not found' });

  const { field_name, field_type, field_options, required, order_index } = req.body;

  db.prepare(`
    UPDATE transition_fields SET
      field_name = COALESCE(?, field_name),
      field_type = COALESCE(?, field_type),
      field_options = ?,
      required = COALESCE(?, required),
      order_index = COALESCE(?, order_index)
    WHERE id = ?
  `).run(
    field_name || null,
    field_type || null,
    field_options !== undefined ? JSON.stringify(field_options) : field.field_options,
    required !== undefined ? (required ? 1 : 0) : null,
    order_index !== undefined ? order_index : null,
    req.params.fieldId
  );

  const updated = db.prepare('SELECT * FROM transition_fields WHERE id = ?').get(req.params.fieldId);
  if (updated.field_options) try { updated.field_options = JSON.parse(updated.field_options); } catch (e) {}
  res.json(updated);
});

// DELETE /fields/:fieldId (must come before DELETE /:id)
router.delete('/fields/:fieldId', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM transition_fields WHERE id = ?').run(req.params.fieldId);
  res.json({ success: true });
});

// PUT /:id - edit named transition
router.put('/:id', requireAdmin, (req, res) => {
  const t = db.prepare('SELECT * FROM transitions WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Transition not found' });

  const { name, from_group_id, to_group_id } = req.body;

  db.prepare(`
    UPDATE transitions SET
      name = COALESCE(?, name),
      from_group_id = COALESCE(?, from_group_id),
      to_group_id = ?
    WHERE id = ?
  `).run(
    name || null,
    from_group_id || null,
    to_group_id !== undefined ? (to_group_id || null) : t.to_group_id,
    req.params.id
  );

  const updated = db.prepare(`
    SELECT t.*, g1.name as from_group_name, g2.name as to_group_name
    FROM transitions t
    JOIN groups g1 ON t.from_group_id = g1.id
    LEFT JOIN groups g2 ON t.to_group_id = g2.id
    WHERE t.id = ?
  `).get(req.params.id);
  res.json(updated);
});

// DELETE /:id - delete transition and its fields
router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM transition_fields WHERE transition_id = ?').run(req.params.id);
  db.prepare('DELETE FROM transitions WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// POST /:id/fields - add field to a transition
router.post('/:id/fields', requireAdmin, (req, res) => {
  const t = db.prepare('SELECT * FROM transitions WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Transition not found' });

  const { field_name, field_type, field_options, required, order_index } = req.body;
  if (!field_name) return res.status(400).json({ error: 'field_name required' });

  const maxOrder = db.prepare('SELECT MAX(order_index) as mx FROM transition_fields WHERE transition_id = ?').get(t.id);
  const result = db.prepare(`
    INSERT INTO transition_fields (transition_id, from_group_id, to_group_id, field_name, field_type, field_options, required, order_index)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    t.id,
    t.from_group_id,
    t.to_group_id,
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

module.exports = router;
