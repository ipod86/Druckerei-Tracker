'use strict';

const db = require('../db/database');

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Check session timeout
  const timeoutMinutes = req.session.sessionTimeoutMinutes || 60;
  if (req.session.lastActivity) {
    const elapsed = (Date.now() - req.session.lastActivity) / 60000;
    if (elapsed > timeoutMinutes) {
      req.session.destroy();
      return res.status(401).json({ error: 'Session expired' });
    }
  }
  req.session.lastActivity = Date.now();

  // Attach user to request
  const user = db.prepare('SELECT id, username, role, email, location_id, active FROM users WHERE id = ? AND active = 1').get(req.session.userId);
  if (!user) {
    req.session.destroy();
    return res.status(401).json({ error: 'User not found or inactive' });
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

function requireEmployee(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin' && req.user.role !== 'employee') {
      return res.status(403).json({ error: 'Employee or admin access required' });
    }
    next();
  });
}

module.exports = { requireAuth, requireAdmin, requireEmployee };
