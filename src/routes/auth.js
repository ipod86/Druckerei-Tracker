'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

// ── Brute-force protection (in-memory, per IP) ────────────────────────────────
const loginAttempts = new Map(); // ip → { count, blockedUntil }
const MAX_ATTEMPTS = 10;         // max failures before block
const BLOCK_MINUTES = 15;        // block duration

function getClientIp(req) {
  return (req.headers['cf-connecting-ip'] ||           // Cloudflare real IP
          req.headers['x-forwarded-for']?.split(',')[0] ||
          req.socket.remoteAddress || 'unknown').trim();
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry?.blockedUntil && now < entry.blockedUntil) {
    const remaining = Math.ceil((entry.blockedUntil - now) / 60000);
    return { blocked: true, remaining };
  }
  return { blocked: false };
}

function recordFailure(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, blockedUntil: null };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_MINUTES * 60 * 1000;
    entry.count = 0;
  }
  loginAttempts.set(ip, entry);
}

function clearFailures(ip) {
  loginAttempts.delete(ip);
}

// Clean up old entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (!entry.blockedUntil || now > entry.blockedUntil + 3600000) loginAttempts.delete(ip);
  }
}, 3600000);

// POST /api/auth/login
router.post('/login', (req, res) => {
  const ip = getClientIp(req);
  const limit = checkRateLimit(ip);
  if (limit.blocked) {
    return res.status(429).json({ error: `Zu viele Fehlversuche. Bitte ${limit.remaining} Min. warten.` });
  }

  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  clearFailures(ip);

  // Get timeout from settings or user setting
  const settingRow = db.prepare("SELECT value FROM settings WHERE key = 'session_timeout'").get();
  const timeoutMinutes = user.session_timeout_minutes || parseInt(settingRow?.value || '60');

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  req.session.locationId = user.location_id;
  req.session.sessionTimeoutMinutes = timeoutMinutes;
  req.session.lastActivity = Date.now();

  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    email: user.email,
    location_id: user.location_id,
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.json({ success: true });
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const settings = db.prepare('SELECT key, value FROM settings').all();
  const settingsObj = {};
  for (const s of settings) settingsObj[s.key] = s.value;

  res.json({
    id: req.user.id,
    username: req.user.username,
    role: req.user.role,
    email: req.user.email,
    location_id: req.user.location_id,
    settings: settingsObj,
  });
});

module.exports = router;
