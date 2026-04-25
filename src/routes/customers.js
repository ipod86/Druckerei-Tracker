'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, requireAdmin, requireEmployee } = require('../middleware/auth');

// GET / - list customers with card count and company name
router.get('/', requireAuth, (req, res) => {
  const { q } = req.query;
  let query = `
    SELECT cu.*, co.name as company_name, co.customer_number,
           COUNT(DISTINCT ca.id) as card_count
    FROM customers cu
    LEFT JOIN companies co ON cu.company_id = co.id
    LEFT JOIN cards ca ON ca.customer_id = cu.id AND ca.archived = 0
  `;
  const params = [];
  if (q) {
    query += ` WHERE (cu.name LIKE ? OR co.name LIKE ? OR cu.email LIKE ? OR co.customer_number LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  query += ` GROUP BY cu.id ORDER BY cu.name COLLATE NOCASE`;

  res.json(db.prepare(query).all(...params));
});

// GET /:id
router.get('/:id', requireAuth, (req, res) => {
  const customer = db.prepare(`
    SELECT cu.*, co.name as company_name
    FROM customers cu
    LEFT JOIN companies co ON cu.company_id = co.id
    WHERE cu.id = ?
  `).get(req.params.id);
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
  const { name, company_id, email, phone, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const result = db.prepare('INSERT INTO customers (name, company_id, email, phone, notes) VALUES (?,?,?,?,?)')
    .run(name, company_id || null, email || null, phone || null, notes || null);

  const customer = db.prepare(`
    SELECT cu.*, co.name as company_name FROM customers cu
    LEFT JOIN companies co ON cu.company_id = co.id WHERE cu.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json(customer);
});

// PUT /:id
router.put('/:id', requireEmployee, (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const { name, company_id, email, phone, notes } = req.body;
  db.prepare(`
    UPDATE customers SET
      name = COALESCE(?, name),
      company_id = ?,
      email = ?,
      phone = ?,
      notes = ?
    WHERE id = ?
  `).run(
    name || null,
    company_id !== undefined ? (company_id || null) : customer.company_id,
    email !== undefined ? email : customer.email,
    phone !== undefined ? phone : customer.phone,
    notes !== undefined ? notes : customer.notes,
    req.params.id
  );

  const updated = db.prepare(`
    SELECT cu.*, co.name as company_name FROM customers cu
    LEFT JOIN companies co ON cu.company_id = co.id WHERE cu.id = ?
  `).get(req.params.id);
  res.json(updated);
});

// DELETE /:id
router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE cards SET customer_id = NULL WHERE customer_id = ?').run(req.params.id);
  db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
