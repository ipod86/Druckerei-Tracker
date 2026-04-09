'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

// GET /?q= - search cards
router.get('/', requireAuth, (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json([]);

  const like = `%${q.trim()}%`;

  const cards = db.prepare(`
    SELECT DISTINCT ca.id, ca.title, ca.order_number, ca.archived,
           col.name as column_name, col.id as column_id,
           g.name as group_name, g.color as group_color,
           cu.name as customer_name
    FROM cards ca
    JOIN columns col ON ca.column_id = col.id
    JOIN groups g ON col.group_id = g.id
    LEFT JOIN customers cu ON ca.customer_id = cu.id
    WHERE (
      ca.title LIKE ?
      OR ca.order_number LIKE ?
      OR cu.name LIKE ?
      OR EXISTS (SELECT 1 FROM card_comments cc WHERE cc.card_id = ca.id AND cc.content LIKE ?)
      OR EXISTS (SELECT 1 FROM transition_values tv WHERE tv.card_id = ca.id AND tv.value LIKE ?)
    )
    ORDER BY ca.archived, ca.updated_at DESC
    LIMIT 20
  `).all(like, like, like, like, like);

  res.json(cards);
});

module.exports = router;
