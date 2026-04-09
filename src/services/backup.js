'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db/database');

async function runBackup() {
  const backupPath = path.resolve(process.env.BACKUP_PATH || './backups');
  const dbPath = path.resolve(process.env.DB_PATH || './data/database.sqlite');
  const uploadPath = path.resolve(process.env.UPLOAD_PATH || './uploads');

  const startedAt = new Date().toISOString();
  const logId = db.prepare('INSERT INTO backup_log (started_at, success) VALUES (?, 0)').run(startedAt).lastInsertRowid;

  try {
    // Create backup directory
    const timestamp = startedAt.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const backupDir = path.join(backupPath, `backup-${timestamp}`);
    fs.mkdirSync(backupDir, { recursive: true });

    // Copy database
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, path.join(backupDir, 'database.sqlite'));
    }

    // Copy uploads directory
    if (fs.existsSync(uploadPath)) {
      copyDirRecursive(uploadPath, path.join(backupDir, 'uploads'));
    }

    const completedAt = new Date().toISOString();
    db.prepare('UPDATE backup_log SET completed_at = ?, success = 1, file_path = ? WHERE id = ?')
      .run(completedAt, backupDir, logId);

    // Rotate old backups
    const keepCount = parseInt(getSettingValue('backup_keep_count') || '14');
    rotateBackups(backupPath, keepCount);

    return { success: true, path: backupDir, started_at: startedAt, completed_at: completedAt };
  } catch (err) {
    const completedAt = new Date().toISOString();
    db.prepare('UPDATE backup_log SET completed_at = ?, success = 0, error_message = ? WHERE id = ?')
      .run(completedAt, err.message, logId);
    throw err;
  }
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function rotateBackups(backupPath, keepCount) {
  if (!fs.existsSync(backupPath)) return;
  const dirs = fs.readdirSync(backupPath)
    .filter(d => d.startsWith('backup-'))
    .map(d => ({ name: d, time: fs.statSync(path.join(backupPath, d)).mtime.getTime() }))
    .sort((a, b) => b.time - a.time);

  // Remove old backups beyond keepCount
  for (let i = keepCount; i < dirs.length; i++) {
    const oldDir = path.join(backupPath, dirs[i].name);
    try {
      deleteDirRecursive(oldDir);
    } catch (e) {
      console.error('Failed to delete old backup:', oldDir, e.message);
    }
  }
}

function deleteDirRecursive(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      deleteDirRecursive(p);
    } else {
      fs.unlinkSync(p);
    }
  }
  fs.rmdirSync(dir);
}

function getSettingValue(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

module.exports = { runBackup };
