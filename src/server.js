'use strict';

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Cloudflare / reverse proxy (set TRUST_PROXY=1 in .env when behind Cloudflare)
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', parseInt(process.env.TRUST_PROXY) || 1);
}

// Ensure data directory exists
const dbPath = path.resolve(process.env.DB_PATH || './data/database.sqlite');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ── Security headers ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('X-XSS-Protection', '1; mode=block');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Only send HSTS when actually behind HTTPS
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Session store
const SQLiteStore = require('connect-sqlite3')(session);
const sessionDbPath = path.join(dataDir, 'sessions.sqlite');

const isHttps = !!process.env.TRUST_PROXY;
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: dataDir }),
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: parseInt(process.env.SESSION_TIMEOUT_MINUTES || '60') * 60 * 1000,
    httpOnly: true,
    secure: isHttps,
    sameSite: 'strict',
  }
}));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── CSRF-Schutz ───────────────────────────────────────────────────────────────
// Token wird in der Session gespeichert und als JS-lesbares Cookie gesetzt.
// Alle state-ändernden API-Requests müssen ihn als X-CSRF-Token Header senden.
app.use((req, res, next) => {
  if (!req.session) return next();

  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  try {
    res.cookie('csrf-token', req.session.csrfToken, {
      httpOnly: false,
      sameSite: 'strict',
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    });
  } catch (e) {
    console.error('[CSRF] Cookie-Fehler:', e.message);
  }

  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  if (!req.path.startsWith('/api/')) return next();
  if (req.path === '/api/auth/login') return next();
  if (req.path === '/api/ghl/webhook') return next(); // external webhook, has own secret key check

  const token = req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    console.warn(`[CSRF] Abgelehnt: ${req.method} ${req.path}`);
    return res.status(403).json({ error: 'CSRF-Validierung fehlgeschlagen' });
  }
  next();
});

// Static files — no caching for JS/CSS so updates are always picked up immediately
app.use((req, res, next) => {
  if (req.path.match(/\.(js|css)$/)) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
  }
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve uploaded files (branding, etc.)
const uploadPath = path.resolve(process.env.UPLOAD_PATH || './uploads');
app.use('/uploads', express.static(uploadPath));

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const locationRoutes = require('./routes/locations');
const groupRoutes = require('./routes/groups');
const columnRoutes = require('./routes/columns');
const labelRoutes = require('./routes/labels');
const customerRoutes = require('./routes/customers');
const companyRoutes = require('./routes/companies');
const cardRoutes = require('./routes/cards');
const archiveRoutes = require('./routes/archive');
const searchRoutes = require('./routes/search');
const notificationRoutes = require('./routes/notifications');
const dashboardRoutes = require('./routes/dashboard');
const transitionRoutes = require('./routes/transitions');
const emailRuleRoutes = require('./routes/emailRules');
const adminRoutes = require('./routes/admin');
const ghlRoutes = require('./routes/ghl');
const boardsRoutes = require('./routes/boards');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/columns', columnRoutes);
app.use('/api/labels', labelRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/cards', cardRoutes);
app.use('/api/archive', archiveRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/transitions', transitionRoutes);
app.use('/api/email-rules', emailRuleRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ghl', ghlRoutes);
app.use('/api/boards', boardsRoutes);

// SPA fallback - serve index.html for all non-API routes
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Error handler — never leak stack traces to client
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start scheduler
const { startScheduler } = require('./jobs/scheduler');
startScheduler();

app.listen(PORT, () => {
  console.log(`Print Shop Tracker running on http://localhost:${PORT}`);
});

module.exports = app;
