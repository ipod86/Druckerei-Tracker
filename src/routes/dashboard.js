'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  // Cards per column
  const cards_per_column = db.prepare(`
    SELECT col.id as column_id, col.name as column_name, g.name as group_name, g.color as group_color,
           COUNT(ca.id) as count
    FROM columns col
    JOIN groups g ON col.group_id = g.id
    LEFT JOIN cards ca ON ca.column_id = col.id AND ca.archived = 0
    GROUP BY col.id
    ORDER BY g.order_index, col.order_index
  `).all();

  // Overdue cards
  const overdue_cards = db.prepare(`
    SELECT ca.id, ca.title, ca.order_number, ca.due_date,
           col.name as column_name, g.name as group_name, g.color as group_color,
           cu.name as customer_name
    FROM cards ca
    JOIN columns col ON ca.column_id = col.id
    JOIN groups g ON col.group_id = g.id
    LEFT JOIN customers cu ON ca.customer_id = cu.id
    WHERE ca.archived = 0
    AND (
      (ca.due_date IS NOT NULL AND ca.due_date < date('now'))
      OR (col.time_limit_hours IS NOT NULL AND (
        julianday('now') - julianday(
          COALESCE(
            (SELECT MAX(h.created_at) FROM card_history h WHERE h.card_id = ca.id AND h.action_type IN ('moved','created')),
            ca.created_at
          )
        )
      ) * 24 > col.time_limit_hours)
    )
    ORDER BY ca.due_date
    LIMIT 20
  `).all();

  // My recent cards (activity in last 7 days)
  const my_recent = db.prepare(`
    SELECT DISTINCT ca.id, ca.title, ca.order_number, col.name as column_name, g.name as group_name, g.color as group_color,
           MAX(ch.created_at) as last_activity
    FROM card_history ch
    JOIN cards ca ON ch.card_id = ca.id
    JOIN columns col ON ca.column_id = col.id
    JOIN groups g ON col.group_id = g.id
    WHERE ch.user_id = ?
    AND ch.created_at >= datetime('now', '-7 days')
    AND ca.archived = 0
    GROUP BY ca.id
    ORDER BY last_activity DESC
    LIMIT 10
  `).all(req.user.id);

  // Recently moved cards (last 10 moves)
  const recently_moved = db.prepare(`
    SELECT ch.id as history_id, ch.created_at, ch.details,
           ca.id as card_id, ca.title, ca.order_number,
           col.name as column_name, g.name as group_name, g.color as group_color,
           u.username
    FROM card_history ch
    JOIN cards ca ON ch.card_id = ca.id
    JOIN columns col ON ca.column_id = col.id
    JOIN groups g ON col.group_id = g.id
    LEFT JOIN users u ON ch.user_id = u.id
    WHERE ch.action_type = 'moved'
    ORDER BY ch.created_at DESC
    LIMIT 10
  `).all();

  // Completed this week (archived or in last group this week)
  const lastGroup = db.prepare('SELECT id FROM groups ORDER BY order_index DESC LIMIT 1').get();
  const completed_this_week = db.prepare(`
    SELECT COUNT(*) as count FROM cards ca
    JOIN columns col ON ca.column_id = col.id
    WHERE (ca.archived = 1 AND ca.archived_at >= datetime('now', '-7 days'))
    OR (col.group_id = ? AND ca.updated_at >= datetime('now', '-7 days'))
  `).get(lastGroup ? lastGroup.id : 0);

  // Open checklists
  const open_checklists = db.prepare(`
    SELECT ca.id as card_id, ca.title, ca.order_number,
           col.name as column_name, g.name as group_name, g.color as group_color,
           COUNT(ci.id) as incomplete_count
    FROM checklist_items ci
    JOIN checklists ch ON ci.checklist_id = ch.id
    JOIN cards ca ON ch.card_id = ca.id
    JOIN columns col ON ca.column_id = col.id
    JOIN groups g ON col.group_id = g.id
    WHERE ci.completed = 0 AND ca.archived = 0
    GROUP BY ca.id
    ORDER BY incomplete_count DESC
    LIMIT 10
  `).all();

  res.json({
    cards_per_column,
    overdue_cards,
    my_recent,
    recently_moved,
    completed_this_week: completed_this_week.count,
    open_checklists,
  });
});

module.exports = router;
