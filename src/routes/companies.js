'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, requireEmployee } = require('../middleware/auth');

// GET / - all companies with person count
router.get('/', requireAuth, (req, res) => {
  const q = req.query.q || '';
  const companies = db.prepare(`
    SELECT c.*,
           COUNT(cu.id) as person_count
    FROM companies c
    LEFT JOIN customers cu ON cu.company_id = c.id
    WHERE c.name LIKE ?
    GROUP BY c.id
    ORDER BY c.name COLLATE NOCASE
  `).all(`%${q}%`);
  res.json(companies);
});

// GET /:id/persons - all persons belonging to a company
router.get('/:id/persons', requireAuth, (req, res) => {
  const persons = db.prepare(`
    SELECT cu.*,
           (SELECT COUNT(*) FROM cards WHERE customer_id = cu.id AND archived = 0) as card_count
    FROM customers cu
    WHERE cu.company_id = ?
    ORDER BY cu.name COLLATE NOCASE
  `).all(req.params.id);
  res.json(persons);
});

// POST /
router.post('/', requireEmployee, (req, res) => {
  const { name, email, phone, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = db.prepare('INSERT INTO companies (name, email, phone, notes) VALUES (?,?,?,?)').run(name, email || null, phone || null, notes || null);
  res.status(201).json(db.prepare('SELECT * FROM companies WHERE id = ?').get(result.lastInsertRowid));
});

// PUT /:id
router.put('/:id', requireEmployee, (req, res) => {
  const co = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!co) return res.status(404).json({ error: 'Company not found' });
  const { name, email, phone, notes } = req.body;
  db.prepare('UPDATE companies SET name=COALESCE(?,name), email=?, phone=?, notes=? WHERE id=?')
    .run(name || null, email ?? co.email, phone ?? co.phone, notes ?? co.notes, req.params.id);
  res.json(db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id));
});

// DELETE /:id - unlinks persons but keeps them
router.delete('/:id', requireEmployee, (req, res) => {
  db.prepare('UPDATE customers SET company_id = NULL WHERE company_id = ?').run(req.params.id);
  db.prepare('DELETE FROM companies WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
