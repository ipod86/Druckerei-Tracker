'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

// GET / - user's notifications
router.get('/', requireAuth, (req, res) => {
  const notifications = db.prepare(`
    SELECT n.*, ca.title as card_title
    FROM notifications n
    LEFT JOIN cards ca ON n.card_id = ca.id
    WHERE n.user_id = ?
    ORDER BY n.read ASC, n.created_at DESC
    LIMIT 50
  `).all(req.user.id);
  res.json(notifications);
});

// PUT /read-all
router.put('/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ success: true });
});

// PUT /:id/read
router.put('/:id/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

module.exports = router;
