'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const { requireAuth, requireAdmin, requireEmployee } = require('../middleware/auth');
const { uploadMultiple } = require('../middleware/upload');

// Helper: apply checklist templates for a column/group
function applyChecklistTemplates(cardId, columnId) {
  const col = db.prepare('SELECT * FROM columns WHERE id = ?').get(columnId);
  if (!col) return;

  const templates = db.prepare(`
    SELECT * FROM checklist_templates
    WHERE trigger_column_id = ? OR trigger_group_id = ?
  `).all(columnId, col.group_id);

  for (const tpl of templates) {
    // Check if already applied (same-name checklist exists)
    const existing = db.prepare('SELECT id FROM checklists WHERE card_id = ? AND title = ?').get(cardId, tpl.name);
    if (existing) continue;

    const clResult = db.prepare('INSERT INTO checklists (card_id, title, order_index) VALUES (?, ?, ?)')
      .run(cardId, tpl.name, 0);

    const items = db.prepare('SELECT * FROM checklist_template_items WHERE template_id = ? ORDER BY order_index').all(tpl.id);
    for (const item of items) {
      db.prepare('INSERT INTO checklist_items (checklist_id, text, order_index) VALUES (?, ?, ?)')
        .run(clResult.lastInsertRowid, item.text, item.order_index);
    }
  }
}

// Helper: create notifications for card watchers
function notifyWatchers(cardId, excludeUserId, message, type) {
  // Watchers = users who commented on the card
  const commenters = db.prepare(`
    SELECT DISTINCT user_id FROM card_comments WHERE card_id = ? AND user_id != ?
  `).all(cardId, excludeUserId || 0);

  for (const c of commenters) {
    db.prepare('INSERT INTO notifications (user_id, type, card_id, message) VALUES (?, ?, ?, ?)')
      .run(c.user_id, type || 'card_moved', cardId, message);
  }
}

// Helper: trigger email rules
function triggerEmailRules(cardId, fromGroupId, toGroupId) {
  try {
    const { sendTransitionEmails } = require('../services/email');
    sendTransitionEmails(cardId, toGroupId, fromGroupId).catch(() => {});
  } catch (e) { /* email not configured */ }
}

// GET / - all non-archived cards
router.get('/', requireAuth, (req, res) => {
  const { column_id, group_id, location_id, label_id, user_id, overdue } = req.query;
  let query = `
    SELECT ca.*, col.name as column_name, col.group_id,
           g.name as group_name, g.color as group_color, g.order_index as group_order,
           cu.name as customer_name,
           l.name as location_name,
           u.username as created_by_name,
           (SELECT COUNT(*) FROM checklist_items ci JOIN checklists ch ON ci.checklist_id = ch.id WHERE ch.card_id = ca.id) as checklist_total,
           (SELECT COUNT(*) FROM checklist_items ci JOIN checklists ch ON ci.checklist_id = ch.id WHERE ch.card_id = ca.id AND ci.completed = 1) as checklist_done
    FROM cards ca
    JOIN columns col ON ca.column_id = col.id
    JOIN groups g ON col.group_id = g.id
    LEFT JOIN customers cu ON ca.customer_id = cu.id
    LEFT JOIN locations l ON ca.location_id = l.id
    LEFT JOIN users u ON ca.created_by = u.id
    WHERE ca.archived = 0
  `;
  const params = [];

  if (column_id) { query += ' AND ca.column_id = ?'; params.push(column_id); }
  if (group_id) { query += ' AND col.group_id = ?'; params.push(group_id); }
  if (location_id) { query += ' AND ca.location_id = ?'; params.push(location_id); }
  if (user_id) { query += ' AND ca.created_by = ?'; params.push(user_id); }
  if (overdue === 'true') {
    query += ` AND (
      (ca.due_date IS NOT NULL AND ca.due_date < date('now'))
      OR (col.time_limit_hours IS NOT NULL AND (
        julianday('now') - julianday(
          COALESCE((SELECT MAX(h.created_at) FROM card_history h WHERE h.card_id = ca.id AND h.action_type IN ('moved','created')), ca.created_at)
        )
      ) * 24 > col.time_limit_hours)
    )`;
  }
  if (label_id) {
    query += ' AND EXISTS (SELECT 1 FROM card_labels cl WHERE cl.card_id = ca.id AND cl.label_id = ?)';
    params.push(label_id);
  }

  query += ' ORDER BY g.order_index, col.order_index, ca.position, ca.created_at';

  const cards = db.prepare(query).all(...params);

  // Attach labels
  for (const card of cards) {
    card.labels = db.prepare(`
      SELECT l.* FROM labels l
      JOIN card_labels cl ON l.id = cl.label_id
      WHERE cl.card_id = ?
    `).all(card.id);
  }

  res.json(cards);
});

// GET /board - cards grouped by column
router.get('/board', requireAuth, (req, res) => {
  const { location_id, label_id, user_id } = req.query;

  let cardQuery = `
    SELECT ca.*, col.name as column_name, col.group_id, col.time_limit_hours, col.time_limit_days, col.escalation_time,
           g.name as group_name, g.color as group_color, g.order_index as group_order,
           cu.name as customer_name,
           l.name as location_name,
           (SELECT COUNT(*) FROM checklist_items ci JOIN checklists ch ON ci.checklist_id = ch.id WHERE ch.card_id = ca.id) as checklist_total,
           (SELECT COUNT(*) FROM checklist_items ci JOIN checklists ch ON ci.checklist_id = ch.id WHERE ch.card_id = ca.id AND ci.completed = 1) as checklist_done,
           (SELECT COUNT(*) FROM card_files cf WHERE cf.card_id = ca.id) as files_count,
           COALESCE(
             (SELECT MAX(h.created_at) FROM card_history h WHERE h.card_id = ca.id AND h.action_type IN ('moved','created')),
             ca.created_at
           ) as last_moved_at
    FROM cards ca
    JOIN columns col ON ca.column_id = col.id
    JOIN groups g ON col.group_id = g.id
    LEFT JOIN customers cu ON ca.customer_id = cu.id
    LEFT JOIN locations l ON ca.location_id = l.id
    WHERE ca.archived = 0
  `;
  const params = [];

  if (location_id) { cardQuery += ' AND ca.location_id = ?'; params.push(location_id); }
  if (user_id) { cardQuery += ' AND ca.created_by = ?'; params.push(user_id); }
  if (label_id) {
    cardQuery += ' AND EXISTS (SELECT 1 FROM card_labels cl WHERE cl.card_id = ca.id AND cl.label_id = ?)';
    params.push(label_id);
  }
  cardQuery += ' ORDER BY ca.position, ca.created_at';

  const cards = db.prepare(cardQuery).all(...params);

  for (const card of cards) {
    card.labels = db.prepare(`
      SELECT l.* FROM labels l JOIN card_labels cl ON l.id = cl.label_id WHERE cl.card_id = ?
    `).all(card.id);
  }

  // Group by column_id
  const byColumn = {};
  for (const card of cards) {
    if (!byColumn[card.column_id]) byColumn[card.column_id] = [];
    byColumn[card.column_id].push(card);
  }

  const groups = db.prepare('SELECT * FROM groups ORDER BY order_index').all();
  const columns = db.prepare('SELECT c.*, g.name as group_name, g.color as group_color, g.order_index as group_order FROM columns c JOIN groups g ON c.group_id = g.id ORDER BY g.order_index, c.order_index').all();

  res.json({
    groups,
    columns,
    cardsByColumn: byColumn,
  });
});

// GET /:id - full card detail
router.get('/:id', requireAuth, (req, res) => {
  const card = db.prepare(`
    SELECT ca.*, col.name as column_name, col.group_id, col.time_limit_hours, col.time_limit_days, col.escalation_time,
           g.name as group_name, g.color as group_color, g.order_index as group_order,
           cu.name as customer_name, co.name as customer_company, cu.email as customer_email_addr,
           l.name as location_name,
           u.username as created_by_name,
           COALESCE(
             (SELECT MAX(h.created_at) FROM card_history h WHERE h.card_id = ca.id AND h.action_type IN ('moved','created')),
             ca.created_at
           ) as last_moved_at
    FROM cards ca
    JOIN columns col ON ca.column_id = col.id
    JOIN groups g ON col.group_id = g.id
    LEFT JOIN customers cu ON ca.customer_id = cu.id
    LEFT JOIN companies co ON cu.company_id = co.id
    LEFT JOIN locations l ON ca.location_id = l.id
    LEFT JOIN users u ON ca.created_by = u.id
    WHERE ca.id = ?
  `).get(req.params.id);

  if (!card) return res.status(404).json({ error: 'Card not found' });

  card.labels = db.prepare(`
    SELECT l.* FROM labels l JOIN card_labels cl ON l.id = cl.label_id WHERE cl.card_id = ?
  `).all(card.id);

  card.comments = db.prepare(`
    SELECT cc.*, u.username FROM card_comments cc
    LEFT JOIN users u ON cc.user_id = u.id
    WHERE cc.card_id = ? ORDER BY cc.created_at
  `).all(card.id);

  card.files = db.prepare(`
    SELECT cf.*, u.username FROM card_files cf
    LEFT JOIN users u ON cf.user_id = u.id
    WHERE cf.card_id = ? ORDER BY cf.created_at
  `).all(card.id);

  const checklists = db.prepare('SELECT * FROM checklists WHERE card_id = ? ORDER BY order_index').all(card.id);
  for (const cl of checklists) {
    cl.items = db.prepare(`
      SELECT ci.*, u.username as completed_by_name FROM checklist_items ci
      LEFT JOIN users u ON ci.completed_by = u.id
      WHERE ci.checklist_id = ? ORDER BY ci.order_index
    `).all(cl.id);
  }
  card.checklists = checklists;

  card.history = db.prepare(`
    SELECT ch.*, u.username FROM card_history ch
    LEFT JOIN users u ON ch.user_id = u.id
    WHERE ch.card_id = ? ORDER BY ch.created_at
  `).all(card.id);

  card.transition_values = db.prepare(`
    SELECT tv.*, tf.field_name, tf.field_type,
           gf.name as from_group_name, gt.name as to_group_name
    FROM transition_values tv
    JOIN transition_fields tf ON tv.field_id = tf.id
    LEFT JOIN groups gf ON tf.from_group_id = gf.id
    LEFT JOIN groups gt ON tf.to_group_id = gt.id
    WHERE tv.card_id = ? ORDER BY tv.created_at
  `).all(card.id);

  res.json(card);
});

// POST / - create card
router.post('/', requireEmployee, (req, res) => {
  const { title, order_number, description, column_id, location_id, customer_id, customer_email, due_date, labels, card_type } = req.body;
  if (!title || !column_id) return res.status(400).json({ error: 'title and column_id required' });

  const maxPos = db.prepare('SELECT MAX(position) as mx FROM cards WHERE column_id = ? AND archived = 0').get(column_id);
  const position = (maxPos.mx || 0) + 1000;
  const type = card_type === 'divider' ? 'divider' : 'card';

  const result = db.prepare(`
    INSERT INTO cards (title, order_number, description, column_id, location_id, customer_id, customer_email, due_date, created_by, position, card_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, order_number || null, description || null, column_id, location_id || null, customer_id || null, customer_email || null, due_date || null, req.user.id, position, type);

  const cardId = result.lastInsertRowid;

  // Insert labels
  if (Array.isArray(labels)) {
    for (const labelId of labels) {
      db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)').run(cardId, labelId);
    }
  }

  // History
  db.prepare('INSERT INTO card_history (card_id, action_type, user_id, details) VALUES (?, ?, ?, ?)')
    .run(cardId, 'created', req.user.id, JSON.stringify({ column_id, title }));

  // Apply checklist templates
  applyChecklistTemplates(cardId, column_id);

  // Trigger email rules
  const col = db.prepare('SELECT group_id FROM columns WHERE id = ?').get(column_id);
  if (col) triggerEmailRules(cardId, null, col.group_id);

  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  res.status(201).json(card);
});

// PUT /:id - update card fields
router.put('/:id', requireEmployee, (req, res) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  const { title, order_number, description, customer_id, customer_email, due_date, location_id } = req.body;

  const updates = [];
  const vals = [];

  if (title !== undefined) { updates.push('title = ?'); vals.push(title); }
  if (order_number !== undefined) { updates.push('order_number = ?'); vals.push(order_number); }
  if (description !== undefined) { updates.push('description = ?'); vals.push(description); }
  if (customer_id !== undefined) { updates.push('customer_id = ?'); vals.push(customer_id); }
  if (customer_email !== undefined) { updates.push('customer_email = ?'); vals.push(customer_email); }
  if (due_date !== undefined) { updates.push('due_date = ?'); vals.push(due_date); }
  if (location_id !== undefined) { updates.push('location_id = ?'); vals.push(location_id); }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    vals.push(req.params.id);
    db.prepare(`UPDATE cards SET ${updates.join(', ')} WHERE id = ?`).run(...vals);

    db.prepare('INSERT INTO card_history (card_id, action_type, user_id, details) VALUES (?, ?, ?, ?)')
      .run(req.params.id, 'field_updated', req.user.id, JSON.stringify(req.body));
  }

  const updated = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /:id - hard delete for dividers, soft delete (archive) for cards
router.delete('/:id', requireEmployee, (req, res) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  if (card.card_type === 'divider') {
    db.prepare('DELETE FROM cards WHERE id = ?').run(req.params.id);
  } else {
    db.prepare('UPDATE cards SET archived = 1, archived_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
    db.prepare('INSERT INTO card_history (card_id, action_type, user_id, details) VALUES (?, ?, ?, ?)')
      .run(req.params.id, 'archived', req.user.id, JSON.stringify({}));
  }
  res.json({ success: true });
});

// POST /reorder - update positions within a column (no history/timestamp change)
router.post('/reorder', requireEmployee, (req, res) => {
  const { column_id, card_ids } = req.body;
  if (!column_id || !Array.isArray(card_ids)) return res.status(400).json({ error: 'column_id and card_ids required' });
  const update = db.prepare('UPDATE cards SET position = ? WHERE id = ? AND column_id = ?');
  const updateAll = db.transaction((ids) => {
    ids.forEach((id, idx) => update.run((idx + 1) * 1000, id, column_id));
  });
  updateAll(card_ids);
  res.json({ ok: true });
});

// POST /:id/move - move card to new column
router.post('/:id/move', requireEmployee, (req, res) => {
  const { column_id, transition_values, position } = req.body;
  if (!column_id) return res.status(400).json({ error: 'column_id required' });

  const card = db.prepare(`
    SELECT ca.*, col.group_id, g.order_index as group_order
    FROM cards ca
    JOIN columns col ON ca.column_id = col.id
    JOIN groups g ON col.group_id = g.id
    WHERE ca.id = ?
  `).get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  const targetCol = db.prepare(`
    SELECT col.*, g.order_index as group_order, g.id as gid
    FROM columns col JOIN groups g ON col.group_id = g.id
    WHERE col.id = ?
  `).get(column_id);
  if (!targetCol) return res.status(404).json({ error: 'Target column not found' });

  // Forward-only rule: can move to same group OR higher order_index group
  if (targetCol.gid !== card.group_id && targetCol.group_order < card.group_order) {
    return res.status(400).json({ error: 'Cannot move card backwards to a previous group stage' });
  }

  const oldColumnId = card.column_id;
  const oldGroupId = card.group_id;

  // Save transition values
  if (Array.isArray(transition_values)) {
    for (const tv of transition_values) {
      // Check for existing value for this field/card combo
      const existing = db.prepare('SELECT id FROM transition_values WHERE card_id = ? AND field_id = ?').get(req.params.id, tv.field_id);
      if (existing) {
        db.prepare('UPDATE transition_values SET value = ?, user_id = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(tv.value, req.user.id, existing.id);
      } else {
        db.prepare('INSERT INTO transition_values (card_id, field_id, value, user_id) VALUES (?, ?, ?, ?)')
          .run(req.params.id, tv.field_id, tv.value, req.user.id);
      }
    }
  }

  // Update position
  let newPosition = position;
  if (!newPosition) {
    const maxPos = db.prepare('SELECT MAX(position) as mx FROM cards WHERE column_id = ? AND archived = 0').get(column_id);
    newPosition = (maxPos.mx || 0) + 1000;
  }

  db.prepare('UPDATE cards SET column_id = ?, position = ?, updated_at = CURRENT_TIMESTAMP, snoozed_until = NULL WHERE id = ?')
    .run(column_id, newPosition, req.params.id);

  // History
  db.prepare('INSERT INTO card_history (card_id, action_type, user_id, details) VALUES (?, ?, ?, ?)')
    .run(req.params.id, 'moved', req.user.id, JSON.stringify({
      from_column_id: oldColumnId,
      to_column_id: column_id,
      from_group_id: oldGroupId,
      to_group_id: targetCol.gid,
    }));

  // Apply checklist templates for new column
  applyChecklistTemplates(req.params.id, column_id);

  // Trigger email rules
  triggerEmailRules(req.params.id, oldGroupId, targetCol.gid);

  // Notify watchers
  const cardInfo = db.prepare('SELECT title FROM cards WHERE id = ?').get(req.params.id);
  notifyWatchers(req.params.id, req.user.id, `Karte "${cardInfo.title}" wurde verschoben`, 'card_moved');

  const updated = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// POST /:id/archive
router.post('/:id/archive', requireEmployee, (req, res) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  db.prepare('UPDATE cards SET archived = 1, archived_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  db.prepare('INSERT INTO card_history (card_id, action_type, user_id, details) VALUES (?, ?, ?, ?)')
    .run(req.params.id, 'archived', req.user.id, JSON.stringify({}));
  res.json({ success: true });
});

// POST /:id/restore
router.post('/:id/restore', requireEmployee, (req, res) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  db.prepare('UPDATE cards SET archived = 0, archived_at = NULL WHERE id = ?').run(req.params.id);
  db.prepare('INSERT INTO card_history (card_id, action_type, user_id, details) VALUES (?, ?, ?, ?)')
    .run(req.params.id, 'restored', req.user.id, JSON.stringify({}));
  res.json({ success: true });
});

// POST /:id/snooze - snooze or cancel snooze for a card
router.post('/:id/snooze', requireEmployee, (req, res) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  const { until } = req.body;
  db.prepare('UPDATE cards SET snoozed_until = ? WHERE id = ?').run(until || null, req.params.id);
  res.json({ success: true });
});

// GET /:id/history
router.get('/:id/history', requireAuth, (req, res) => {
  const history = db.prepare(`
    SELECT ch.*, u.username FROM card_history ch
    LEFT JOIN users u ON ch.user_id = u.id
    WHERE ch.card_id = ? ORDER BY ch.created_at
  `).all(req.params.id);
  res.json(history);
});

// POST /:id/comments
router.post('/:id/comments', requireAuth, (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Content required' });

  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  const result = db.prepare('INSERT INTO card_comments (card_id, user_id, content) VALUES (?, ?, ?)')
    .run(req.params.id, req.user.id, content);

  db.prepare('INSERT INTO card_history (card_id, action_type, user_id, details) VALUES (?, ?, ?, ?)')
    .run(req.params.id, 'comment', req.user.id, JSON.stringify({ comment_id: result.lastInsertRowid }));

  // Parse @mentions
  const mentions = content.match(/@(\w+)/g) || [];
  for (const mention of mentions) {
    const uname = mention.slice(1);
    const mentionedUser = db.prepare('SELECT id FROM users WHERE username = ? AND active = 1').get(uname);
    if (mentionedUser && mentionedUser.id !== req.user.id) {
      db.prepare('INSERT INTO notifications (user_id, type, card_id, message) VALUES (?, ?, ?, ?)')
        .run(mentionedUser.id, 'mention', req.params.id, `${req.user.username} hat Sie in einem Kommentar erwähnt`);
    }
  }

  const comment = db.prepare(`
    SELECT cc.*, u.username FROM card_comments cc
    LEFT JOIN users u ON cc.user_id = u.id
    WHERE cc.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json(comment);
});

// DELETE /:id/comments/:commentId
router.delete('/:id/comments/:commentId', requireAuth, (req, res) => {
  const comment = db.prepare('SELECT * FROM card_comments WHERE id = ? AND card_id = ?').get(req.params.commentId, req.params.id);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  if (comment.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Cannot delete another user\'s comment' });
  }

  db.prepare('DELETE FROM card_comments WHERE id = ?').run(req.params.commentId);
  res.json({ success: true });
});

// POST /:id/files - upload files
router.post('/:id/files', requireEmployee, (req, res) => {
  uploadMultiple(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id);
    if (!card) return res.status(404).json({ error: 'Card not found' });

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const insertedFiles = [];
    for (const file of req.files) {
      const result = db.prepare(`
        INSERT INTO card_files (card_id, user_id, filename, original_name, mime_type, size)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(req.params.id, req.user.id, file.filename, file.originalname, file.mimetype, file.size);

      insertedFiles.push({ id: result.lastInsertRowid, filename: file.filename, original_name: file.originalname, size: file.size, mime_type: file.mimetype });
    }

    db.prepare('INSERT INTO card_history (card_id, action_type, user_id, details) VALUES (?, ?, ?, ?)')
      .run(req.params.id, 'file_uploaded', req.user.id, JSON.stringify({ files: insertedFiles.map(f => f.original_name) }));

    res.status(201).json(insertedFiles);
  });
});

// DELETE /:id/files/:fileId
router.delete('/:id/files/:fileId', requireEmployee, (req, res) => {
  const file = db.prepare('SELECT * FROM card_files WHERE id = ? AND card_id = ?').get(req.params.fileId, req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });

  const uploadPath = path.resolve(process.env.UPLOAD_PATH || './uploads');
  const filePath = path.join(uploadPath, 'attachments', file.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  db.prepare('DELETE FROM card_files WHERE id = ?').run(req.params.fileId);
  res.json({ success: true });
});

// GET /:id/files/:fileId - serve file
router.get('/:id/files/:fileId', requireAuth, (req, res) => {
  const file = db.prepare('SELECT * FROM card_files WHERE id = ? AND card_id = ?').get(req.params.fileId, req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });

  const uploadPath = path.resolve(process.env.UPLOAD_PATH || './uploads');
  const filePath = path.join(uploadPath, 'attachments', file.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

  res.setHeader('Content-Disposition', `inline; filename="${file.original_name}"`);
  res.setHeader('Content-Type', file.mime_type);
  res.sendFile(filePath);
});

// POST /:id/labels
router.post('/:id/labels', requireEmployee, (req, res) => {
  const { label_id } = req.body;
  if (!label_id) return res.status(400).json({ error: 'label_id required' });

  db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)').run(req.params.id, label_id);
  db.prepare('INSERT INTO card_history (card_id, action_type, user_id, details) VALUES (?, ?, ?, ?)')
    .run(req.params.id, 'label_changed', req.user.id, JSON.stringify({ action: 'added', label_id }));
  res.json({ success: true });
});

// DELETE /:id/labels/:labelId
router.delete('/:id/labels/:labelId', requireEmployee, (req, res) => {
  db.prepare('DELETE FROM card_labels WHERE card_id = ? AND label_id = ?').run(req.params.id, req.params.labelId);
  db.prepare('INSERT INTO card_history (card_id, action_type, user_id, details) VALUES (?, ?, ?, ?)')
    .run(req.params.id, 'label_changed', req.user.id, JSON.stringify({ action: 'removed', label_id: req.params.labelId }));
  res.json({ success: true });
});

// POST /:id/checklists
router.post('/:id/checklists', requireEmployee, (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const maxOrder = db.prepare('SELECT MAX(order_index) as mx FROM checklists WHERE card_id = ?').get(req.params.id);
  const result = db.prepare('INSERT INTO checklists (card_id, title, order_index) VALUES (?, ?, ?)')
    .run(req.params.id, title, (maxOrder.mx || 0) + 1);

  const cl = db.prepare('SELECT * FROM checklists WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...cl, items: [] });
});

// PUT /:id/checklists/:checklistId
router.put('/:id/checklists/:checklistId', requireEmployee, (req, res) => {
  const { title } = req.body;
  db.prepare('UPDATE checklists SET title = ? WHERE id = ? AND card_id = ?').run(title, req.params.checklistId, req.params.id);
  const cl = db.prepare('SELECT * FROM checklists WHERE id = ?').get(req.params.checklistId);
  res.json(cl);
});

// DELETE /:id/checklists/:checklistId
router.delete('/:id/checklists/:checklistId', requireEmployee, (req, res) => {
  db.prepare('DELETE FROM checklist_items WHERE checklist_id = ?').run(req.params.checklistId);
  db.prepare('DELETE FROM checklists WHERE id = ? AND card_id = ?').run(req.params.checklistId, req.params.id);
  res.json({ success: true });
});

// POST /:id/checklists/:checklistId/items
router.post('/:id/checklists/:checklistId/items', requireEmployee, (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });

  const maxOrder = db.prepare('SELECT MAX(order_index) as mx FROM checklist_items WHERE checklist_id = ?').get(req.params.checklistId);
  const result = db.prepare('INSERT INTO checklist_items (checklist_id, text, order_index) VALUES (?, ?, ?)')
    .run(req.params.checklistId, text, (maxOrder.mx || 0) + 1);

  const item = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(item);
});

// PUT /:id/checklists/:checklistId/items/:itemId
router.put('/:id/checklists/:checklistId/items/:itemId', requireAuth, (req, res) => {
  const { text, completed } = req.body;
  const item = db.prepare('SELECT * FROM checklist_items WHERE id = ? AND checklist_id = ?').get(req.params.itemId, req.params.checklistId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  if (text !== undefined) {
    db.prepare('UPDATE checklist_items SET text = ? WHERE id = ?').run(text, req.params.itemId);
  }

  if (completed !== undefined) {
    if (completed && !item.completed) {
      db.prepare('UPDATE checklist_items SET completed = 1, completed_by = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(req.user.id, req.params.itemId);
      db.prepare('INSERT INTO card_history (card_id, action_type, user_id, details) VALUES (?, ?, ?, ?)')
        .run(req.params.id, 'checklist_checked', req.user.id, JSON.stringify({ item_id: req.params.itemId, text: item.text }));
    } else if (!completed) {
      db.prepare('UPDATE checklist_items SET completed = 0, completed_by = NULL, completed_at = NULL WHERE id = ?')
        .run(req.params.itemId);
    }
  }

  const updated = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(req.params.itemId);
  res.json(updated);
});

// DELETE /:id/checklists/:checklistId/items/:itemId
router.delete('/:id/checklists/:checklistId/items/:itemId', requireEmployee, (req, res) => {
  db.prepare('DELETE FROM checklist_items WHERE id = ? AND checklist_id = ?').run(req.params.itemId, req.params.checklistId);
  res.json({ success: true });
});

// GET /:id/pdf - generate summary PDF
router.get('/:id/pdf', requireAuth, async (req, res) => {
  try {
    const { generateSummaryPDF } = require('../services/pdf');
    const buffer = await generateSummaryPDF(req.params.id);

    const card = db.prepare('SELECT title, order_number FROM cards WHERE id = ?').get(req.params.id);
    const filename = `karte-${card.order_number || req.params.id}-${card.title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    console.error('PDF generation error:', e);
    res.status(500).json({ error: 'PDF generation failed: ' + e.message });
  }
});

module.exports = router;
