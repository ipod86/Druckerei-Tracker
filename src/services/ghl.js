'use strict';

const db = require('../db/database');

const GHL_BASE = 'https://services.leadconnectorhq.com';

// ── Debug event queue (in-memory, max 20 entries) ─────────────────────────────
const debugQueue = [];
function pushDebugEvent(action, payload, result) {
  debugQueue.unshift({ ts: Date.now(), action, payload, result });
  if (debugQueue.length > 20) debugQueue.pop();
}
function popDebugEvents() {
  return debugQueue.splice(0);
}
// populated after module.exports below

function getSettings() {
  return db.prepare('SELECT * FROM ghl_settings WHERE id = 1').get();
}

function authHeaders(apiKey) {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };
}

async function ghlFetch(path, options = {}) {
  const settings = getSettings();
  if (!settings?.api_key) throw new Error('GHL API Key nicht konfiguriert');

  const isDebug = settings.debug_mode === 1;
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : undefined;

  if (isDebug && method !== 'GET') {
    pushDebugEvent(`${method} ${path}`, body, { debug: true, message: 'Debug-Modus — Request NICHT gesendet' });
    // Return a fake success response so callers don't throw
    return { opportunity: { id: 'DEBUG-' + Date.now() } };
  }

  const res = await fetch(`${GHL_BASE}${path}`, {
    ...options,
    headers: { ...authHeaders(settings.api_key), ...(options.headers || {}) },
  });

  let responseBody;
  try { responseBody = await res.json(); } catch { responseBody = {}; }

  if (isDebug && method !== 'GET') {
    pushDebugEvent(`${method} ${path}`, body, { status: res.status, body: responseBody });
  }

  if (!res.ok) {
    throw new Error(`GHL API Fehler ${res.status}: ${JSON.stringify(responseBody)}`);
  }
  return responseBody;
}

// ── Pipelines ─────────────────────────────────────────────────────────────────

async function getPipelines() {
  const settings = getSettings();
  const data = await ghlFetch(`/opportunities/pipelines?locationId=${settings.location_id}`);
  return data.pipelines || [];
}

// ── Contacts ──────────────────────────────────────────────────────────────────

let _kundennummerFieldId = null;

async function getKundennummerFieldId() {
  if (_kundennummerFieldId) return _kundennummerFieldId;
  const settings = getSettings();
  try {
    const data = await ghlFetch(`/locations/${settings.location_id}/customFields`);
    const fields = data.customFields || [];
    if (isDebug()) pushDebugEvent('getKundennummerFieldId – alle Felder', null, fields.map(f => ({ id: f.id, name: f.name, fieldKey: f.fieldKey })));
    const field = fields.find(f =>
      f.name === 'Kundennummer' ||
      f.fieldKey?.toLowerCase().includes('kundennummer')
    );
    if (field) {
      _kundennummerFieldId = field.id;
      if (isDebug()) pushDebugEvent('getKundennummerFieldId – gefunden', null, { id: field.id, name: field.name, fieldKey: field.fieldKey });
    } else {
      if (isDebug()) pushDebugEvent('getKundennummerFieldId – NICHT gefunden', null, 'Kein Feld mit Name/Key "Kundennummer" in GHL – Suche nach Wert ohne Feld-Filter');
    }
  } catch (e) {
    const hint = e.message.includes('401')
      ? e.message + ' → In GHL: Settings → Integrations → Private Integrations → Scopes "Contacts: Read" und "Locations/CustomFields: Read" aktivieren'
      : e.message;
    if (isDebug()) pushDebugEvent('getKundennummerFieldId – Fehler', null, hint);
  }
  return _kundennummerFieldId;
}

async function findContactByCustomerNumber(customerNumber) {
  if (!customerNumber) return null;
  const settings = getSettings();
  try {
    const [data, fieldId] = await Promise.all([
      ghlFetch(`/contacts/?locationId=${settings.location_id}&query=${encodeURIComponent(customerNumber)}&limit=10`),
      getKundennummerFieldId(),
    ]);
    const contacts = data.contacts || [];
    if (isDebug()) {
      pushDebugEvent('findContact – GHL Antwort', { query: customerNumber, fieldId },
        contacts.map(c => ({ id: c.id, name: c.name, customFields: c.customFields || [] }))
      );
    }
    if (fieldId) {
      const match = contacts.find(c =>
        (c.customFields || []).some(f => f.id === fieldId && String(f.value) === String(customerNumber))
      ) || null;
      if (isDebug()) pushDebugEvent('findContact – Ergebnis (nach Feld-ID)', { customerNumber, fieldId }, match ? { found: true, contact_id: match.id, name: match.name } : 'kein Treffer');
      return match;
    }
    // Fallback: any custom field value matches
    const match = contacts.find(c =>
      (c.customFields || []).some(f => String(f.value) === String(customerNumber))
    ) || null;
    if (isDebug()) pushDebugEvent('findContact – Ergebnis (Wert-Suche)', { customerNumber }, match ? { found: true, contact_id: match.id, name: match.name } : 'kein Treffer');
    return match;
  } catch (e) {
    if (isDebug()) pushDebugEvent('findContact – Fehler', { customerNumber }, e.message);
    return null;
  }
}

async function resolveContact(card) {
  const settings = getSettings();

  // Card → Person → Company → customer_number → GHL contact by Kundennummer field
  if (card.customer_id) {
    const person = db.prepare('SELECT * FROM customers WHERE id = ?').get(card.customer_id);
    if (person?.company_id) {
      const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(person.company_id);
      if (company?.customer_number) {
        const contact = await findContactByCustomerNumber(company.customer_number);
        if (contact) return contact.id;
      }
    }
  }

  // Fallback: look up fallback_contact_id as a Kundennummer in GHL
  if (settings?.fallback_contact_id) {
    const fallback = await findContactByCustomerNumber(settings.fallback_contact_id);
    if (fallback) return fallback.id;
    throw new Error(`Fallback-Kontakt mit Kundennummer "${settings.fallback_contact_id}" nicht in GHL gefunden`);
  }
  throw new Error('Kein GHL-Kontakt gefunden und kein Fallback konfiguriert');
}

// ── Opportunities ─────────────────────────────────────────────────────────────

async function createOpportunity(card, pipelineId, stageId) {
  const contactId = await resolveContact(card);
  const settings = getSettings();

  const body = {
    pipelineId,
    locationId: settings.location_id,
    name: card.title,
    pipelineStageId: stageId,
    contactId,
    status: 'open',
  };

  const data = await ghlFetch('/opportunities/', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const oppId = data.opportunity?.id;
  if (oppId) {
    db.prepare('UPDATE cards SET ghl_opportunity_id = ? WHERE id = ?').run(oppId, card.id);
  }
  return oppId;
}

async function moveOpportunity(ghlOpportunityId, stageId) {
  await ghlFetch(`/opportunities/${ghlOpportunityId}`, {
    method: 'PUT',
    body: JSON.stringify({ pipelineStageId: stageId }),
  });
}

async function updateOpportunityStatus(ghlOpportunityId, status) {
  await ghlFetch(`/opportunities/${ghlOpportunityId}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

// ── Sync hooks (called from cards route) ──────────────────────────────────────

function getColumnMapping(columnId) {
  return db.prepare('SELECT * FROM ghl_column_mappings WHERE column_id = ?').get(columnId);
}

function isDebug() {
  return getSettings()?.debug_mode === 1;
}

async function syncCardCreated(card) {
  try {
    const mapping = getColumnMapping(card.column_id);
    if (!mapping) {
      if (isDebug()) pushDebugEvent('syncCardCreated – kein Mapping', { card_id: card.id, card_title: card.title, column_id: card.column_id }, 'Spalte hat keine GHL-Stage zugeordnet → übersprungen');
      return;
    }
    if (isDebug()) pushDebugEvent('syncCardCreated – starte', { card_id: card.id, card_title: card.title, column_id: card.column_id, pipeline_id: mapping.pipeline_id, stage_id: mapping.stage_id }, 'Mapping gefunden, erstelle Opportunity…');
    await createOpportunity(card, mapping.pipeline_id, mapping.stage_id);
  } catch (e) {
    if (isDebug()) pushDebugEvent('syncCardCreated – Fehler', { card_id: card.id }, e.message);
    console.error('[GHL] syncCardCreated:', e.message);
  }
}

async function syncCardMoved(cardId, newColumnId) {
  try {
    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
    if (!card) return;

    const mapping = getColumnMapping(newColumnId);

    if (!card.ghl_opportunity_id) {
      if (mapping) {
        if (isDebug()) pushDebugEvent('syncCardMoved – neue Opportunity', { card_id: card.id, card_title: card.title, new_column_id: newColumnId }, 'Noch keine Opportunity, erstelle sie in neuer Stage…');
        await createOpportunity(card, mapping.pipeline_id, mapping.stage_id);
      } else {
        if (isDebug()) pushDebugEvent('syncCardMoved – kein Mapping', { card_id: card.id, card_title: card.title, new_column_id: newColumnId }, 'Zielspalte hat kein Mapping → übersprungen');
      }
      return;
    }

    if (mapping) {
      if (isDebug()) pushDebugEvent('syncCardMoved – verschiebe', { card_id: card.id, card_title: card.title, ghl_opportunity_id: card.ghl_opportunity_id, new_stage_id: mapping.stage_id }, 'Verschiebe Opportunity in neue Stage…');
      await moveOpportunity(card.ghl_opportunity_id, mapping.stage_id);
    } else {
      if (isDebug()) pushDebugEvent('syncCardMoved – kein Mapping', { card_id: card.id, card_title: card.title, new_column_id: newColumnId }, 'Zielspalte hat kein Mapping → Opportunity bleibt in alter Stage');
    }
  } catch (e) {
    console.error('[GHL] syncCardMoved:', e.message);
  }
}

async function syncCardArchived(cardId) {
  try {
    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
    if (!card?.ghl_opportunity_id) return;
    await updateOpportunityStatus(card.ghl_opportunity_id, 'lost');
  } catch (e) {
    console.error('[GHL] syncCardArchived:', e.message);
  }
}

module.exports = {
  getSettings,
  getPipelines,
  syncCardCreated,
  syncCardMoved,
  syncCardArchived,
  getColumnMapping,
  popDebugEvents,
};
