'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET / - list all users
router.get('/', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.role, u.email, u.active, u.location_id, u.notify_email, u.last_login, u.created_at,
           l.name as location_name
    FROM users u
    LEFT JOIN locations l ON u.location_id = l.id
    ORDER BY u.username
  `).all();
  res.json(users);
});

// POST / - create user
router.post('/', requireAdmin, (req, res) => {
  const { username, password, role, email, location_id, notify_email } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (!['admin', 'employee', 'readonly'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, role, email, location_id, notify_email)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(username, hash, role || 'employee', email || null, location_id || null, notify_email !== undefined ? notify_email : 1);

  const user = db.prepare('SELECT id, username, role, email, location_id, active, notify_email FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(user);
});

// PUT /:id - update user
router.put('/:id', requireAdmin, (req, res) => {
  const { username, role, email, location_id, notify_email, active, session_timeout_minutes } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare(`
    UPDATE users SET
      username = COALESCE(?, username),
      role = COALESCE(?, role),
      email = ?,
      location_id = ?,
      notify_email = COALESCE(?, notify_email),
      active = COALESCE(?, active),
      session_timeout_minutes = COALESCE(?, session_timeout_minutes)
    WHERE id = ?
  `).run(
    username || null,
    role || null,
    email !== undefined ? email : user.email,
    location_id !== undefined ? location_id : user.location_id,
    notify_email !== undefined ? notify_email : null,
    active !== undefined ? active : null,
    session_timeout_minutes || null,
    req.params.id
  );

  const updated = db.prepare('SELECT id, username, role, email, location_id, active, notify_email FROM users WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /:id - deactivate user
router.delete('/:id', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Prevent deleting self
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'Cannot deactivate your own account' });
  }

  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// PUT /:id/password - change password
router.put('/:id/password', requireAuth, (req, res) => {
  const { password, current_password } = req.body;
  if (!password) return res.status(400).json({ error: 'New password required' });

  // Non-admins can only change own password and must provide current
  if (req.user.role !== 'admin') {
    if (parseInt(req.params.id) !== req.user.id) {
      return res.status(403).json({ error: 'Cannot change another user\'s password' });
    }
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.params.id);
    if (!current_password || !bcrypt.compareSync(current_password, user.password_hash)) {
      return res.status(401).json({ error: 'Current password incorrect' });
    }
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ success: true });
});

module.exports = router;
