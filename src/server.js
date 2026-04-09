'use strict';

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data directory exists
const dbPath = path.resolve(process.env.DB_PATH || './data/database.sqlite');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Session store
const SQLiteStore = require('connect-sqlite3')(session);
const sessionDbPath = path.join(dataDir, 'sessions.sqlite');

app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: dataDir }),
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: parseInt(process.env.SESSION_TIMEOUT_MINUTES || '60') * 60 * 1000,
    httpOnly: true,
    secure: false,
  }
}));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
const cardRoutes = require('./routes/cards');
const archiveRoutes = require('./routes/archive');
const searchRoutes = require('./routes/search');
const notificationRoutes = require('./routes/notifications');
const dashboardRoutes = require('./routes/dashboard');
const transitionRoutes = require('./routes/transitions');
const emailRuleRoutes = require('./routes/emailRules');
const adminRoutes = require('./routes/admin');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/columns', columnRoutes);
app.use('/api/labels', labelRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/cards', cardRoutes);
app.use('/api/archive', archiveRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/transitions', transitionRoutes);
app.use('/api/email-rules', emailRuleRoutes);
app.use('/api/admin', adminRoutes);

// SPA fallback - serve index.html for all non-API routes
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Start scheduler
const { startScheduler } = require('./jobs/scheduler');
startScheduler();

app.listen(PORT, () => {
  console.log(`Print Shop Tracker running on http://localhost:${PORT}`);
});

module.exports = app;
