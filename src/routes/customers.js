'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, requireAdmin, requireEmployee } = require('../middleware/auth');

// GET / - list customers with card count
router.get('/', requireAuth, (req, res) => {
  const { q } = req.query;
  let query = `
    SELECT c.*, COUNT(DISTINCT ca.id) as card_count
    FROM customers c
    LEFT JOIN cards ca ON ca.customer_id = c.id AND ca.archived = 0
  `;
  const params = [];
  if (q) {
    query += ` WHERE (c.name LIKE ? OR c.company LIKE ? OR c.email LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  query += ` GROUP BY c.id ORDER BY c.name`;

  const customers = db.prepare(query).all(...params);
  res.json(customers);
});

// GET /:id - customer detail with cards
router.get('/:id', requireAuth, (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const cards = db.prepare(`
    SELECT ca.*, col.name as column_name, g.name as group_name, g.color as group_color
    FROM cards ca
    JOIN columns col ON ca.column_id = col.id
    JOIN groups g ON col.group_id = g.id
    WHERE ca.customer_id = ?
    ORDER BY ca.archived, ca.created_at DESC
  `).all(req.params.id);

  res.json({ ...customer, cards });
});

// POST /
router.post('/', requireEmployee, (req, res) => {
  const { name, company, email, phone, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const result = db.prepare('INSERT INTO customers (name, company, email, phone, notes) VALUES (?, ?, ?, ?, ?)')
    .run(name, company || null, email || null, phone || null, notes || null);

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(customer);
});

// PUT /:id
router.put('/:id', requireEmployee, (req, res) => {
  const { name, company, email, phone, notes } = req.body;
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  db.prepare(`
    UPDATE customers SET
      name = COALESCE(?, name),
      company = ?,
      email = ?,
      phone = ?,
      notes = ?
    WHERE id = ?
  `).run(
    name || null,
    company !== undefined ? company : customer.company,
    email !== undefined ? email : customer.email,
    phone !== undefined ? phone : customer.phone,
    notes !== undefined ? notes : customer.notes,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /:id
router.delete('/:id', requireAdmin, (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  // Unlink cards
  db.prepare('UPDATE cards SET customer_id = NULL WHERE customer_id = ?').run(req.params.id);
  db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
