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

// Add snoozed_until to cards if missing
try { db.exec('ALTER TABLE cards ADD COLUMN snoozed_until DATETIME DEFAULT NULL'); } catch (_) {}

// Add companies table if missing
try {
  db.exec(`CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
} catch (_) {}

// Migrate customers: create company records from existing company text field, add company_id column
try {
  db.exec('ALTER TABLE customers ADD COLUMN company_id INTEGER REFERENCES companies(id)');
  // Migrate existing company text values → companies table
  const existing = db.prepare("SELECT DISTINCT company FROM customers WHERE company IS NOT NULL AND company != ''").all();
  const insertCo = db.prepare('INSERT INTO companies (name) VALUES (?)');
  const updateCust = db.prepare('UPDATE customers SET company_id = ? WHERE company = ?');
  for (const row of existing) {
    const result = insertCo.run(row.company);
    updateCust.run(result.lastInsertRowid, row.company);
  }
} catch (_) {}

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

// Add card_type to cards if missing
try { db.exec("ALTER TABLE cards ADD COLUMN card_type TEXT DEFAULT 'card'"); } catch (_) {}

// Add time_limit_days and escalation_time to columns if missing
try { db.exec('ALTER TABLE columns ADD COLUMN time_limit_days INTEGER DEFAULT NULL'); } catch (_) {}
try { db.exec('ALTER TABLE columns ADD COLUMN escalation_time TEXT DEFAULT NULL'); } catch (_) {}

// GHL integration tables
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ghl_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      api_key TEXT,
      location_id TEXT,
      fallback_contact_id TEXT,
      webhook_secret TEXT
    );
    INSERT OR IGNORE INTO ghl_settings (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS ghl_column_mappings (
      column_id INTEGER PRIMARY KEY REFERENCES columns(id) ON DELETE CASCADE,
      pipeline_id TEXT NOT NULL,
      stage_id TEXT NOT NULL
    );
  `);
} catch (_) {}
try { db.exec('ALTER TABLE cards ADD COLUMN ghl_opportunity_id TEXT DEFAULT NULL'); } catch (_) {}

module.exports = db;
