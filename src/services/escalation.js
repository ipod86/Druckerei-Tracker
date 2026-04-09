'use strict';

const db = require('../db/database');

async function checkEscalations() {
  // Find columns with escalation rules
  const rules = db.prepare(`
    SELECT er.*, col.name as column_name
    FROM email_escalation_rules er
    JOIN columns col ON er.column_id = col.id
    WHERE er.active = 1
  `).all();

  const { sendEscalationEmail } = require('./email');

  for (const rule of rules) {
    // Find cards in this column that have exceeded the time limit
    const cards = db.prepare(`
      SELECT ca.*,
             COALESCE(
               (SELECT MAX(h.created_at) FROM card_history h WHERE h.card_id = ca.id AND h.action_type IN ('moved','created')),
               ca.created_at
             ) as last_moved_at
      FROM cards ca
      WHERE ca.column_id = ? AND ca.archived = 0
      AND (julianday('now') - julianday(
             COALESCE(
               (SELECT MAX(h.created_at) FROM card_history h WHERE h.card_id = ca.id AND h.action_type IN ('moved','created')),
               ca.created_at
             )
           )) * 24 > ?
    `).all(rule.column_id, rule.time_limit_hours);

    for (const card of cards) {
      // Check if we already sent an escalation recently (within repeat_interval_hours)
      const lastEscalation = db.prepare(`
        SELECT MAX(created_at) as last_sent FROM card_history
        WHERE card_id = ? AND action_type = 'escalation_sent' AND details LIKE ?
      `).get(card.id, `%"rule_id":${rule.id}%`);

      if (lastEscalation && lastEscalation.last_sent) {
        const hoursAgo = (Date.now() - new Date(lastEscalation.last_sent).getTime()) / 3600000;
        if (hoursAgo < rule.repeat_interval_hours) continue;
      }

      // Send escalation email
      try {
        await sendEscalationEmail({ ...card, column_name: rule.column_name }, rule);

        // Log that escalation was sent
        db.prepare('INSERT INTO card_history (card_id, action_type, user_id, details) VALUES (?, ?, NULL, ?)')
          .run(card.id, 'escalation_sent', JSON.stringify({ rule_id: rule.id, column_id: rule.column_id }));
      } catch (e) {
        console.error('Escalation email error for card', card.id, ':', e.message);
      }
    }
  }

  // Also check cards with column time_limit_hours (column-level escalation)
  const columnsWithLimit = db.prepare(`
    SELECT col.*, g.name as group_name
    FROM columns col
    JOIN groups g ON col.group_id = g.id
    WHERE col.time_limit_hours IS NOT NULL AND col.escalation_emails IS NOT NULL
  `).all();

  for (const col of columnsWithLimit) {
    let emails = [];
    try { emails = JSON.parse(col.escalation_emails); } catch (e) {}
    if (emails.length === 0) continue;

    const cards = db.prepare(`
      SELECT ca.*
      FROM cards ca
      WHERE ca.column_id = ? AND ca.archived = 0
      AND (julianday('now') - julianday(
             COALESCE(
               (SELECT MAX(h.created_at) FROM card_history h WHERE h.card_id = ca.id AND h.action_type IN ('moved','created')),
               ca.created_at
             )
           )) * 24 > ?
    `).all(col.id, col.time_limit_hours);

    for (const card of cards) {
      const intervalHours = col.reminder_interval_hours || 24;
      const lastNotif = db.prepare(`
        SELECT MAX(created_at) as last_sent FROM card_history
        WHERE card_id = ? AND action_type = 'column_escalation_sent' AND details LIKE ?
      `).get(card.id, `%"column_id":${col.id}%`);

      if (lastNotif && lastNotif.last_sent) {
        const hoursAgo = (Date.now() - new Date(lastNotif.last_sent).getTime()) / 3600000;
        if (hoursAgo < intervalHours) continue;
      }

      try {
        const { sendEmail } = require('./email');
        await sendEmail(
          emails,
          `Zeitlimit überschritten: ${card.title}`,
          `<p>Die Karte <strong>${card.title}</strong> befindet sich seit mehr als ${col.time_limit_hours} Stunden in der Spalte <strong>${col.name}</strong>.</p>`
        );
        db.prepare('INSERT INTO card_history (card_id, action_type, user_id, details) VALUES (?, ?, NULL, ?)')
          .run(card.id, 'column_escalation_sent', JSON.stringify({ column_id: col.id }));
      } catch (e) {
        console.error('Column escalation email error:', e.message);
      }
    }
  }
}

module.exports = { checkEscalations };
