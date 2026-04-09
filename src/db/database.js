'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { setupSchema, setupDefaultData } = require('./schema');

const dbPath = path.resolve(process.env.DB_PATH || './data/database.sqlite');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema and default data
setupSchema(db);
setupDefaultData(db);

// Migrations for existing databases
try {
  db.exec(`CREATE TABLE IF NOT EXISTS transitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    from_group_id INTEGER DEFAULT NULL REFERENCES groups(id),
    to_group_id INTEGER NOT NULL REFERENCES groups(id),
    order_index INTEGER DEFAULT 0
  )`);
} catch (_) {}

try {
  db.exec('ALTER TABLE transition_fields ADD COLUMN transition_id INTEGER REFERENCES transitions(id)');
} catch (_) {} // column already exists

module.exports = db;
