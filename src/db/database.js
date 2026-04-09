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

module.exports = db;
