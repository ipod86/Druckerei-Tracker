'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const { getPipelines, getSettings, syncCardMoved, syncDeletedOpportunities, popDebugEvents, pushDebugEvent } = require('../services/ghl');

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

// POST /api/ghl/sync-deleted  — manual trigger: check all linked opportunities
router.post('/sync-deleted', requireAdmin, async (req, res) => {
  try {
    const result = await syncDeletedOpportunities();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
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
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    payload = req.body; // already parsed by global middleware
  } else {
    const rawBody = req.body?.toString() || '';
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      pushDebugEvent('webhook – parse fehler', { 'content-type': req.headers['content-type'] }, rawBody.substring(0, 500));
      return res.sendStatus(400);
    }
  }

  pushDebugEvent('webhook – empfangen', { 'content-type': req.headers['content-type'] }, payload);

  res.sendStatus(200); // acknowledge immediately

  setImmediate(async () => {
    try {
      // Support both standard webhook and GHL Workflow webhook formats
      const type = payload.type || payload.event || '';
      const isOpportunityEvent = !type
        || type === 'OpportunityStageUpdate'
        || type === 'opportunity.stageUpdate'
        || type.toLowerCase().includes('opportunity');

      if (!isOpportunityEvent) return;

      const oppId = payload.id || payload.opportunity?.id || payload.opportunityId;
      if (!oppId) return;

      // ── Status lost/won → archive card ────────────────────────────────────
      const status = payload.status || payload.opportunity?.status || '';
      if (status === 'lost' || status === 'won') {
        const card = db.prepare('SELECT * FROM cards WHERE ghl_opportunity_id = ? AND archived = 0').get(oppId);
        if (!card) return;
        db.prepare('UPDATE cards SET archived = 1, ghl_opportunity_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(card.id);
        db.prepare("INSERT INTO card_history (card_id, action_type, user_id, details) VALUES (?, 'archived', NULL, ?)")
          .run(card.id, JSON.stringify({ source: 'ghl_webhook', reason: `opportunity status → ${status}` }));
        pushDebugEvent('webhook – Karte archiviert', { oppId, card_id: card.id }, `Status in GHL auf "${status}" gesetzt → Karte archiviert`);
        console.log(`[GHL webhook] Karte ${card.id} archiviert (Status: ${status})`);
        return;
      }

      // ── Stage change → move card ───────────────────────────────────────────
      let stageId = payload.pipelineStageId || payload.opportunity?.pipelineStageId || payload.stageId;
      if (!stageId) {
        const stageName = payload.pipleline_stage || payload.pipeline_stage || payload.stageName;
        const pipelineId = payload.pipeline_id || payload.pipelineId;
        if (stageName && pipelineId) {
          try {
            const pipelines = await getPipelines();
            const pipeline = pipelines.find(p => p.id === pipelineId);
            const stage = pipeline?.stages?.find(s => s.name === stageName);
            stageId = stage?.id || null;
          } catch { /* ignore */ }
        }
      }
      if (!stageId) {
        pushDebugEvent('webhook – keine Stage-ID gefunden', null, payload);
        return;
      }

      const card = db.prepare('SELECT * FROM cards WHERE ghl_opportunity_id = ?').get(oppId);
      if (!card) {
        pushDebugEvent('webhook – Karte nicht gefunden', { oppId }, 'Keine Karte mit dieser GHL Opportunity ID');
        return;
      }

      const mapping = db.prepare('SELECT * FROM ghl_column_mappings WHERE stage_id = ?').get(stageId);
      if (!mapping || mapping.column_id === card.column_id) return;

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
