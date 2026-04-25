'use strict';

const cron = require('node-cron');
const db = require('../db/database');

function getSettingValue(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function startScheduler() {
  // Check escalations every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    try {
      const { checkEscalations } = require('../services/escalation');
      await checkEscalations();
    } catch (e) {
      console.error('Escalation check error:', e.message);
    }
  });

  // Daily backup at 02:00
  cron.schedule('0 2 * * *', async () => {
    try {
      const intervalDays = parseInt(getSettingValue('backup_interval_days') || '1');
      if (intervalDays <= 0) return; // Disabled

      // Check if backup already ran today
      const today = new Date().toISOString().slice(0, 10);
      const lastBackup = db.prepare("SELECT * FROM backup_log WHERE success = 1 AND started_at >= ? LIMIT 1").get(today + ' 00:00:00');
      if (lastBackup) return; // Already backed up today

      const { runBackup } = require('../services/backup');
      await runBackup();
      console.log('Scheduled backup completed');
    } catch (e) {
      console.error('Scheduled backup error:', e.message);
    }
  });

  // Check GHL for deleted opportunities every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    try {
      const { syncDeletedOpportunities } = require('../services/ghl');
      await syncDeletedOpportunities();
    } catch (e) {
      console.error('[GHL sync] syncDeletedOpportunities error:', e.message);
    }
  });

  // Auto-archive cards daily at 03:00
  cron.schedule('0 3 * * *', () => {
    try {
      const autoDays = parseInt(getSettingValue('auto_archive_days') || '0');
      if (autoDays <= 0) return; // Disabled

      const result = db.prepare(`
        UPDATE cards SET archived = 1, archived_at = CURRENT_TIMESTAMP
        WHERE archived = 0
        AND updated_at < datetime('now', ? || ' days')
      `).run(`-${autoDays}`);

      if (result.changes > 0) {
        console.log(`Auto-archived ${result.changes} cards`);
      }
    } catch (e) {
      console.error('Auto-archive error:', e.message);
    }
  });

  console.log('Scheduler started');
}

module.exports = { startScheduler };
