'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const { getPipelines, getSettings, syncCardMoved, popDebugEvents } = require('../services/ghl');

// GET /api/ghl/settings
router.get('/settings', requireAdmin, (req, res) => {
  const s = db.prepare('SELECT * FROM ghl_settings WHERE id = 1').get();
  res.json({
    api_key:             s?.api_key            || '',
    location_id:         s?.location_id        || '',
    fallback_contact_id: s?.fallback_contact_id || '',
    webhook_secret:      s?.webhook_secret      || '',
    debug_mode:          s?.debug_mode === 1,
  });
});

// GET /api/ghl/debug-events  — poll for debug payloads
router.get('/debug-events', requireAdmin, (req, res) => {
  res.json(popDebugEvents());
});

// PUT /api/ghl/settings
router.put('/settings', requireAdmin, (req, res) => {
  const { api_key, location_id, fallback_contact_id, debug_mode } = req.body;

  // Generate webhook secret if not yet set
  const existing = db.prepare('SELECT webhook_secret FROM ghl_settings WHERE id = 1').get();
  const secret = existing?.webhook_secret || crypto.randomBytes(24).toString('hex');

  db.prepare(`
    UPDATE ghl_settings SET api_key = ?, location_id = ?, fallback_contact_id = ?, webhook_secret = ?, debug_mode = ?
    WHERE id = 1
  `).run(api_key || null, location_id || null, fallback_contact_id || null, secret, debug_mode ? 1 : 0);

  res.json({ ok: true, webhook_secret: secret });
});

// GET /api/ghl/test  — verify API key + location
router.get('/test', requireAdmin, async (req, res) => {
  const settings = db.prepare('SELECT * FROM ghl_settings WHERE id = 1').get();
  if (!settings?.api_key || !settings?.location_id) {
    return res.json({ ok: false, error: 'API Key oder Location ID fehlt' });
  }
  try {
    const data = await getPipelines();
    res.json({ ok: true, pipelines: data.length, message: `Verbindung OK — ${data.length} Pipeline(s) gefunden` });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// GET /api/ghl/pipelines  — proxy to GHL
router.get('/pipelines', requireAdmin, async (req, res) => {
  try {
    const pipelines = await getPipelines();
    res.json(pipelines);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/ghl/mappings
router.get('/mappings', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM ghl_column_mappings').all();
  const map = {};
  for (const r of rows) map[r.column_id] = { pipeline_id: r.pipeline_id, stage_id: r.stage_id };
  res.json(map);
});

// PUT /api/ghl/mappings
router.put('/mappings', requireAdmin, (req, res) => {
  const { mappings } = req.body; // { column_id: { pipeline_id, stage_id } | null }
  if (!mappings || typeof mappings !== 'object') return res.status(400).json({ error: 'mappings object required' });

  const del = db.prepare('DELETE FROM ghl_column_mappings WHERE column_id = ?');
  const upsert = db.prepare(`
    INSERT INTO ghl_column_mappings (column_id, pipeline_id, stage_id) VALUES (?, ?, ?)
    ON CONFLICT(column_id) DO UPDATE SET pipeline_id = excluded.pipeline_id, stage_id = excluded.stage_id
  `);

  db.transaction(() => {
    for (const [colId, val] of Object.entries(mappings)) {
      if (!val || !val.stage_id) {
        del.run(parseInt(colId));
      } else {
        upsert.run(parseInt(colId), val.pipeline_id, val.stage_id);
      }
    }
  })();

  res.json({ ok: true });
});

// POST /api/ghl/webhook  — inbound from GHL
router.post('/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const settings = getSettings();
  if (!settings?.webhook_secret) return res.sendStatus(200); // not configured → ignore

  const incoming = req.headers['x-webhook-key'] || req.headers['x-ghl-signature'] || '';
  if (incoming !== settings.webhook_secret) {
    console.warn('[GHL webhook] Ungültiger Key');
    return res.sendStatus(401);
  }

  let payload;
  try { payload = JSON.parse(req.body.toString()); } catch { return res.sendStatus(400); }

  res.sendStatus(200); // acknowledge immediately

  setImmediate(async () => {
    try {
      const type = payload.type || payload.event;
      if (type !== 'OpportunityStageUpdate' && type !== 'opportunity.stageUpdate') return;

      const oppId   = payload.id || payload.opportunity?.id;
      const stageId = payload.pipelineStageId || payload.opportunity?.pipelineStageId;
      if (!oppId || !stageId) return;

      // Find card by ghl_opportunity_id
      const card = db.prepare('SELECT * FROM cards WHERE ghl_opportunity_id = ?').get(oppId);
      if (!card) return;

      // Find column mapped to this stage
      const mapping = db.prepare('SELECT * FROM ghl_column_mappings WHERE stage_id = ?').get(stageId);
      if (!mapping || mapping.column_id === card.column_id) return;

      // Move card
      const col = db.prepare('SELECT group_id FROM columns WHERE id = ?').get(mapping.column_id);
      if (!col) return;

      db.prepare('UPDATE cards SET column_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(mapping.column_id, card.id);
      db.prepare("INSERT INTO card_history (card_id, action_type, user_id, details) VALUES (?, 'moved', NULL, ?)")
        .run(card.id, JSON.stringify({ from_column_id: card.column_id, to_column_id: mapping.column_id, source: 'ghl_webhook' }));

      console.log(`[GHL webhook] Karte ${card.id} → Spalte ${mapping.column_id}`);
    } catch (e) {
      console.error('[GHL webhook]', e.message);
    }
  });
});

module.exports = router;
