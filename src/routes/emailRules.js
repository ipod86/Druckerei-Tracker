'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// ---- Email Templates ----

router.get('/templates', requireAuth, (req, res) => {
  const templates = db.prepare('SELECT * FROM email_templates ORDER BY name').all();
  res.json(templates);
});

router.post('/templates', requireAdmin, (req, res) => {
  const { name, subject, html_content } = req.body;
  if (!name || !subject || !html_content) return res.status(400).json({ error: 'name, subject, html_content required' });

  const result = db.prepare('INSERT INTO email_templates (name, subject, html_content) VALUES (?, ?, ?)')
    .run(name, subject, html_content);
  const tpl = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(tpl);
});

router.put('/templates/:id', requireAdmin, (req, res) => {
  const { name, subject, html_content } = req.body;
  db.prepare('UPDATE email_templates SET name = COALESCE(?, name), subject = COALESCE(?, subject), html_content = COALESCE(?, html_content) WHERE id = ?')
    .run(name || null, subject || null, html_content || null, req.params.id);
  const tpl = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(req.params.id);
  res.json(tpl);
});

router.delete('/templates/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM email_templates WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ---- Email Rules ----

router.get('/', requireAuth, (req, res) => {
  const { board_id } = req.query;
  const rules = board_id
    ? db.prepare(`
        SELECT er.*, g1.name as from_group_name, g2.name as to_group_name, et.name as template_name
        FROM email_rules er
        LEFT JOIN groups g1 ON er.from_group_id = g1.id
        LEFT JOIN groups g2 ON er.to_group_id = g2.id
        LEFT JOIN email_templates et ON er.template_id = et.id
        WHERE (g2.board_id = ? OR er.to_group_id IS NULL)
          AND (g1.board_id = ? OR er.from_group_id IS NULL)
        ORDER BY er.name
      `).all(board_id, board_id)
    : db.prepare(`
        SELECT er.*, g1.name as from_group_name, g2.name as to_group_name, et.name as template_name
        FROM email_rules er
        LEFT JOIN groups g1 ON er.from_group_id = g1.id
        LEFT JOIN groups g2 ON er.to_group_id = g2.id
        LEFT JOIN email_templates et ON er.template_id = et.id
        ORDER BY er.name
      `).all();

  for (const r of rules) {
    if (r.recipients) try { r.recipients = JSON.parse(r.recipients); } catch (e) { r.recipients = []; }
  }

  res.json(rules);
});

router.post('/', requireAdmin, (req, res) => {
  const { name, from_group_id, to_group_id, recipients, include_card_email, template_id, active } = req.body;
  if (!name || !recipients) return res.status(400).json({ error: 'name and recipients required' });

  const result = db.prepare(`
    INSERT INTO email_rules (name, from_group_id, to_group_id, recipients, include_card_email, template_id, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    from_group_id || null,
    to_group_id || null,
    JSON.stringify(Array.isArray(recipients) ? recipients : [recipients]),
    include_card_email ? 1 : 0,
    template_id || null,
    active !== undefined ? active : 1
  );

  const rule = db.prepare('SELECT * FROM email_rules WHERE id = ?').get(result.lastInsertRowid);
  try { rule.recipients = JSON.parse(rule.recipients); } catch (e) {}
  res.status(201).json(rule);
});

router.put('/:id', requireAdmin, (req, res) => {
  const { name, from_group_id, to_group_id, recipients, include_card_email, template_id, active } = req.body;
  const rule = db.prepare('SELECT * FROM email_rules WHERE id = ?').get(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });

  db.prepare(`
    UPDATE email_rules SET
      name = COALESCE(?, name),
      from_group_id = ?,
      to_group_id = ?,
      recipients = COALESCE(?, recipients),
      include_card_email = COALESCE(?, include_card_email),
      template_id = ?,
      active = COALESCE(?, active)
    WHERE id = ?
  `).run(
    name || null,
    from_group_id !== undefined ? from_group_id : rule.from_group_id,
    to_group_id !== undefined ? to_group_id : rule.to_group_id,
    recipients ? JSON.stringify(Array.isArray(recipients) ? recipients : [recipients]) : null,
    include_card_email !== undefined ? (include_card_email ? 1 : 0) : null,
    template_id !== undefined ? template_id : rule.template_id,
    active !== undefined ? active : null,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM email_rules WHERE id = ?').get(req.params.id);
  try { updated.recipients = JSON.parse(updated.recipients); } catch (e) {}
  res.json(updated);
});

router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM email_rules WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ---- Escalation Rules ----

router.get('/escalation', requireAuth, (req, res) => {
  const rules = db.prepare(`
    SELECT er.*, col.name as column_name
    FROM email_escalation_rules er
    JOIN columns col ON er.column_id = col.id
    ORDER BY col.name
  `).all();

  for (const r of rules) {
    if (r.recipients) try { r.recipients = JSON.parse(r.recipients); } catch (e) { r.recipients = []; }
  }
  res.json(rules);
});

router.post('/escalation', requireAdmin, (req, res) => {
  const { column_id, time_limit_hours, recipients, repeat_interval_hours, template_id, active } = req.body;
  if (!column_id || !time_limit_hours || !recipients) return res.status(400).json({ error: 'column_id, time_limit_hours, recipients required' });

  const result = db.prepare(`
    INSERT INTO email_escalation_rules (column_id, time_limit_hours, recipients, repeat_interval_hours, template_id, active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    column_id, time_limit_hours,
    JSON.stringify(Array.isArray(recipients) ? recipients : [recipients]),
    repeat_interval_hours || 24,
    template_id || null,
    active !== undefined ? active : 1
  );

  const rule = db.prepare('SELECT * FROM email_escalation_rules WHERE id = ?').get(result.lastInsertRowid);
  try { rule.recipients = JSON.parse(rule.recipients); } catch (e) {}
  res.status(201).json(rule);
});

router.put('/escalation/:id', requireAdmin, (req, res) => {
  const { column_id, time_limit_hours, recipients, repeat_interval_hours, template_id, active } = req.body;
  const rule = db.prepare('SELECT * FROM email_escalation_rules WHERE id = ?').get(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });

  db.prepare(`
    UPDATE email_escalation_rules SET
      column_id = COALESCE(?, column_id),
      time_limit_hours = COALESCE(?, time_limit_hours),
      recipients = COALESCE(?, recipients),
      repeat_interval_hours = COALESCE(?, repeat_interval_hours),
      template_id = ?,
      active = COALESCE(?, active)
    WHERE id = ?
  `).run(
    column_id || null,
    time_limit_hours || null,
    recipients ? JSON.stringify(Array.isArray(recipients) ? recipients : [recipients]) : null,
    repeat_interval_hours || null,
    template_id !== undefined ? template_id : rule.template_id,
    active !== undefined ? active : null,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM email_escalation_rules WHERE id = ?').get(req.params.id);
  try { updated.recipients = JSON.parse(updated.recipients); } catch (e) {}
  res.json(updated);
});

router.delete('/escalation/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM email_escalation_rules WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
