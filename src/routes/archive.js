'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

// GET / - all archived cards with filters
router.get('/', requireAuth, (req, res) => {
  const { from, to, customer_id, location_id, label_id, limit = 50, offset = 0 } = req.query;

  const conditions = ['ca.archived = 1'];
  const params = [];

  if (from) { conditions.push('ca.archived_at >= ?'); params.push(from); }
  if (to) { conditions.push('ca.archived_at <= ?'); params.push(to + ' 23:59:59'); }
  if (customer_id) { conditions.push('ca.customer_id = ?'); params.push(customer_id); }
  if (location_id) { conditions.push('ca.location_id = ?'); params.push(location_id); }
  if (label_id) {
    conditions.push('EXISTS (SELECT 1 FROM card_labels cl WHERE cl.card_id = ca.id AND cl.label_id = ?)');
    params.push(label_id);
  }

  const whereClause = 'WHERE ' + conditions.join(' AND ');

  const countQuery = `
    SELECT COUNT(*) as total
    FROM cards ca
    JOIN columns col ON ca.column_id = col.id
    JOIN groups g ON col.group_id = g.id
    LEFT JOIN customers cu ON ca.customer_id = cu.id
    LEFT JOIN locations l ON ca.location_id = l.id
    ${whereClause}
  `;

  const dataQuery = `
    SELECT ca.*, col.name as column_name, col.group_id,
           g.name as group_name, g.color as group_color,
           cu.name as customer_name,
           l.name as location_name,
           u.username as created_by_name
    FROM cards ca
    JOIN columns col ON ca.column_id = col.id
    JOIN groups g ON col.group_id = g.id
    LEFT JOIN customers cu ON ca.customer_id = cu.id
    LEFT JOIN locations l ON ca.location_id = l.id
    LEFT JOIN users u ON ca.created_by = u.id
    ${whereClause}
    ORDER BY ca.archived_at DESC LIMIT ? OFFSET ?
  `;

  const totalRow = db.prepare(countQuery).get(...params);
  const cards = db.prepare(dataQuery).all(...params, parseInt(limit), parseInt(offset));

  for (const card of cards) {
    card.labels = db.prepare(`
      SELECT l.* FROM labels l JOIN card_labels cl ON l.id = cl.label_id WHERE cl.card_id = ?
    `).all(card.id);
  }

  res.json({
    cards,
    total: totalRow ? totalRow.total : 0,
    limit: parseInt(limit),
    offset: parseInt(offset),
  });
});

module.exports = router;
