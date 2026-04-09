'use strict';

const nodemailer = require('nodemailer');
const db = require('../db/database');

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings WHERE key LIKE ?').all('smtp%');
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return s;
}

function createTransport() {
  const s = getSettings();
  if (!s.smtp_host) throw new Error('SMTP not configured');

  return nodemailer.createTransport({
    host: s.smtp_host,
    port: parseInt(s.smtp_port || '587'),
    secure: parseInt(s.smtp_port || '587') === 465,
    auth: s.smtp_user ? {
      user: s.smtp_user,
      pass: s.smtp_pass,
    } : undefined,
  });
}

async function sendEmail(to, subject, html) {
  const s = getSettings();
  const transport = createTransport();
  const from = s.smtp_from || 'noreply@druckerei.local';

  const info = await transport.sendMail({
    from,
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    html,
  });
  return info;
}

function renderTemplate(template, vars) {
  if (!template) return '';
  let html = template.html_content || '';
  let subject = template.subject || '';

  for (const [key, value] of Object.entries(vars || {})) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    html = html.replace(regex, value || '');
    subject = subject.replace(regex, value || '');
  }
  return { html, subject };
}

async function sendTransitionEmails(cardId, toGroupId, fromGroupId) {
  const card = db.prepare(`
    SELECT ca.*, col.name as column_name, cu.name as customer_name, cu.email as customer_email_val
    FROM cards ca
    JOIN columns col ON ca.column_id = col.id
    LEFT JOIN customers cu ON ca.customer_id = cu.id
    WHERE ca.id = ?
  `).get(cardId);
  if (!card) return;

  const rules = db.prepare(`
    SELECT * FROM email_rules
    WHERE active = 1 AND (to_group_id = ? OR to_group_id IS NULL)
    AND (from_group_id IS NULL OR from_group_id = ?)
  `).all(toGroupId, fromGroupId || 0);

  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of settingsRows) settings[r.key] = r.value;

  const vars = {
    card_title: card.title,
    order_number: card.order_number || '',
    column_name: card.column_name || '',
    customer_name: card.customer_name || '',
    customer_email: card.customer_email || card.customer_email_val || '',
    due_date: card.due_date || '',
    app_name: settings.app_name || 'Druckerei Tracker',
  };

  for (const rule of rules) {
    let recipients = [];
    try { recipients = JSON.parse(rule.recipients); } catch (e) {}
    if (rule.include_card_email && (card.customer_email || card.customer_email_val)) {
      recipients.push(card.customer_email || card.customer_email_val);
    }
    if (recipients.length === 0) continue;

    let subject = `Karte verschoben: ${card.title}`;
    let html = `<p>Die Karte <strong>${card.title}</strong> wurde in eine neue Spalte verschoben.</p>`;

    if (rule.template_id) {
      const tpl = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(rule.template_id);
      if (tpl) {
        const rendered = renderTemplate(tpl, vars);
        subject = rendered.subject;
        html = rendered.html;
      }
    }

    try {
      await sendEmail(recipients, subject, html);
    } catch (e) {
      console.error('Email send error:', e.message);
    }
  }
}

async function sendEscalationEmail(card, rule) {
  let recipients = [];
  try { recipients = JSON.parse(rule.recipients); } catch (e) {}
  if (rule.include_card_email && card.customer_email) recipients.push(card.customer_email);
  if (recipients.length === 0) return;

  let subject = `Eskalation: Karte "${card.title}" überschreitet Zeitlimit`;
  let html = `<p>Die Karte <strong>${card.title}</strong> (Auftragsnr: ${card.order_number || 'N/A'}) befindet sich seit mehr als ${rule.time_limit_hours} Stunden in der Spalte und benötigt Aufmerksamkeit.</p>`;

  if (rule.template_id) {
    const tpl = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(rule.template_id);
    if (tpl) {
      const rendered = renderTemplate(tpl, {
        card_title: card.title,
        order_number: card.order_number || '',
        column_name: card.column_name || '',
        time_limit_hours: String(rule.time_limit_hours),
      });
      subject = rendered.subject;
      html = rendered.html;
    }
  }

  await sendEmail(recipients, subject, html);
}

module.exports = { sendEmail, renderTemplate, sendTransitionEmails, sendEscalationEmail };
