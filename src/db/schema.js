'use strict';

const bcrypt = require('bcrypt');

function setupSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'employee',
      email TEXT,
      location_id INTEGER REFERENCES locations(id),
      active INTEGER DEFAULT 1,
      session_timeout_minutes INTEGER DEFAULT 60,
      notify_email INTEGER DEFAULT 1,
      last_login DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT '#4a90d9',
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES groups(id),
      name TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      time_limit_hours REAL DEFAULT NULL,
      escalation_emails TEXT DEFAULT NULL,
      reminder_interval_hours REAL DEFAULT 24,
      color TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#4a90d9',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company TEXT,
      email TEXT,
      phone TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      order_number TEXT,
      description TEXT,
      column_id INTEGER NOT NULL REFERENCES columns(id),
      location_id INTEGER REFERENCES locations(id),
      customer_id INTEGER REFERENCES customers(id),
      customer_email TEXT,
      due_date DATE,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      archived INTEGER DEFAULT 0,
      archived_at DATETIME,
      position REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS card_labels (
      card_id INTEGER NOT NULL REFERENCES cards(id),
      label_id INTEGER NOT NULL REFERENCES labels(id),
      PRIMARY KEY (card_id, label_id)
    );

    CREATE TABLE IF NOT EXISTS card_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL REFERENCES cards(id),
      action_type TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id),
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS card_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL REFERENCES cards(id),
      user_id INTEGER REFERENCES users(id),
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS card_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL REFERENCES cards(id),
      user_id INTEGER REFERENCES users(id),
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL REFERENCES cards(id),
      title TEXT NOT NULL,
      order_index INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS checklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checklist_id INTEGER NOT NULL REFERENCES checklists(id),
      text TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      completed_by INTEGER REFERENCES users(id),
      completed_at DATETIME,
      order_index INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS checklist_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      trigger_column_id INTEGER DEFAULT NULL REFERENCES columns(id),
      trigger_group_id INTEGER DEFAULT NULL REFERENCES groups(id)
    );

    CREATE TABLE IF NOT EXISTS checklist_template_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES checklist_templates(id),
      text TEXT NOT NULL,
      order_index INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS transition_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_group_id INTEGER DEFAULT NULL REFERENCES groups(id),
      to_group_id INTEGER NOT NULL REFERENCES groups(id),
      field_name TEXT NOT NULL,
      field_type TEXT NOT NULL DEFAULT 'text',
      field_options TEXT DEFAULT NULL,
      required INTEGER DEFAULT 0,
      order_index INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS transition_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL REFERENCES cards(id),
      field_id INTEGER NOT NULL REFERENCES transition_fields(id),
      value TEXT,
      user_id INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS email_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      html_content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS email_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      from_group_id INTEGER DEFAULT NULL REFERENCES groups(id),
      to_group_id INTEGER REFERENCES groups(id),
      recipients TEXT NOT NULL,
      include_card_email INTEGER DEFAULT 0,
      template_id INTEGER REFERENCES email_templates(id),
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS email_escalation_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      column_id INTEGER NOT NULL REFERENCES columns(id),
      time_limit_hours REAL NOT NULL,
      recipients TEXT NOT NULL,
      repeat_interval_hours REAL DEFAULT 24,
      template_id INTEGER REFERENCES email_templates(id),
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      card_id INTEGER REFERENCES cards(id),
      message TEXT NOT NULL,
      read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS backup_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at DATETIME,
      completed_at DATETIME,
      success INTEGER DEFAULT 0,
      error_message TEXT,
      file_path TEXT
    );
  `);
}

function setupDefaultData(db) {
  // Check if already initialized
  const existing = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (existing.cnt > 0) return;

  // Default admin user
  const passwordHash = bcrypt.hashSync('admin', 10);
  db.prepare(`INSERT INTO users (username, password_hash, role, active) VALUES (?, ?, 'admin', 1)`)
    .run('admin', passwordHash);

  // Default location
  db.prepare(`INSERT INTO locations (name, active) VALUES ('Hauptstandort', 1)`).run();

  // Default groups
  const groups = [
    { name: 'Akquise', order_index: 1, color: '#6366f1' },
    { name: 'Auftrag', order_index: 2, color: '#0ea5e9' },
    { name: 'Vorstufe', order_index: 3, color: '#f59e0b' },
    { name: 'Druck', order_index: 4, color: '#ef4444' },
    { name: 'Weiterverarbeitung', order_index: 5, color: '#8b5cf6' },
    { name: 'Abschluss', order_index: 6, color: '#10b981' },
  ];
  const insertGroup = db.prepare('INSERT INTO groups (name, order_index, color) VALUES (?, ?, ?)');
  const groupIds = {};
  for (const g of groups) {
    const result = insertGroup.run(g.name, g.order_index, g.color);
    groupIds[g.name] = result.lastInsertRowid;
  }

  // Default columns
  const insertColumn = db.prepare('INSERT INTO columns (group_id, name, order_index) VALUES (?, ?, ?)');
  insertColumn.run(groupIds['Akquise'], 'Angebot erstellt', 0);
  insertColumn.run(groupIds['Auftrag'], 'Auftrag erstellt', 0);
  insertColumn.run(groupIds['Vorstufe'], 'Druckvorstufe', 0);
  insertColumn.run(groupIds['Druck'], 'Druckmaschine 1', 0);
  insertColumn.run(groupIds['Druck'], 'Druckmaschine 2', 1);
  insertColumn.run(groupIds['Weiterverarbeitung'], 'Druckweiterverarbeitung', 0);
  insertColumn.run(groupIds['Abschluss'], 'Verschickt', 0);
  insertColumn.run(groupIds['Abschluss'], 'Rechnung geschrieben', 1);

  // Default settings
  const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const defaultSettings = {
    app_name: 'Druckerei Tracker',
    primary_color: '#2563eb',
    secondary_color: '#64748b',
    bg_color: '#f1f5f9',
    nav_color: '#1e3a5f',
    session_timeout: '60',
    backup_interval_days: '1',
    backup_keep_count: '14',
    auto_archive_days: '0',
    smtp_host: '',
    smtp_port: '587',
    smtp_user: '',
    smtp_pass: '',
    smtp_from: 'noreply@druckerei.local',
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    insertSetting.run(key, value);
  }

  // Default labels
  const insertLabel = db.prepare('INSERT INTO labels (name, color) VALUES (?, ?)');
  insertLabel.run('Dringend', '#ef4444');
  insertLabel.run('Wichtig', '#f59e0b');
  insertLabel.run('Normal', '#10b981');
  insertLabel.run('Warten', '#64748b');
}

module.exports = { setupSchema, setupDefaultData };
