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

// Add transition_id column to transition_fields if missing
try {
  db.exec('ALTER TABLE transition_fields ADD COLUMN transition_id INTEGER REFERENCES transitions(id)');
} catch (_) {}

// Make to_group_id nullable in transitions and transition_fields
// (SQLite requires table recreation to change NOT NULL constraints)
db.pragma('foreign_keys = OFF');
db.transaction(() => {
  const tInfo = db.prepare("PRAGMA table_info(transitions)").all();
  const toGroupCol = tInfo.find(c => c.name === 'to_group_id');
  if (toGroupCol && toGroupCol.notnull) {
    db.exec(`
      CREATE TABLE transitions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        from_group_id INTEGER DEFAULT NULL REFERENCES groups(id),
        to_group_id INTEGER DEFAULT NULL REFERENCES groups(id),
        order_index INTEGER DEFAULT 0
      );
      INSERT INTO transitions_new SELECT id, name, from_group_id, to_group_id, order_index FROM transitions;
      DROP TABLE transitions;
      ALTER TABLE transitions_new RENAME TO transitions;
    `);
  }

  const tfInfo = db.prepare("PRAGMA table_info(transition_fields)").all();
  const tfToGroupCol = tfInfo.find(c => c.name === 'to_group_id');
  if (tfToGroupCol && tfToGroupCol.notnull) {
    db.exec(`
      CREATE TABLE transition_fields_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transition_id INTEGER REFERENCES transitions(id),
        from_group_id INTEGER DEFAULT NULL REFERENCES groups(id),
        to_group_id INTEGER DEFAULT NULL REFERENCES groups(id),
        field_name TEXT NOT NULL,
        field_type TEXT NOT NULL DEFAULT 'text',
        field_options TEXT DEFAULT NULL,
        required INTEGER DEFAULT 0,
        order_index INTEGER DEFAULT 0
      );
      INSERT INTO transition_fields_new SELECT id, transition_id, from_group_id, to_group_id, field_name, field_type, field_options, required, order_index FROM transition_fields;
      DROP TABLE transition_fields;
      ALTER TABLE transition_fields_new RENAME TO transition_fields;
    `);
  }
})();
db.pragma('foreign_keys = ON');

module.exports = db;
