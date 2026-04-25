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

  const debugMode = settings.debug_mode === 1;
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : undefined;

  const res = await fetch(`${GHL_BASE}${path}`, {
    ...options,
    headers: { ...authHeaders(settings.api_key), ...(options.headers || {}) },
  });

  let responseBody;
  try { responseBody = await res.json(); } catch { responseBody = {}; }

  if (debugMode) {
    pushDebugEvent(`${method} ${path}`, body ?? null, { status: res.status, body: responseBody });
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

async function findContactByCustomerNumber(customerNumber) {
  if (!customerNumber) return null;
  const settings = getSettings();
  try {
    const data = await ghlFetch('/contacts/search', {
      method: 'POST',
      body: JSON.stringify({
        locationId: settings.location_id,
        filters: [{ field: 'customFields.kundennummer', operator: 'eq', value: String(customerNumber) }],
        pageLimit: 5,
      }),
    });
    const contacts = data.contacts || [];
    if (isDebug()) pushDebugEvent('findContact – Ergebnis', { customerNumber }, contacts.length ? { found: true, contact_id: contacts[0].id, name: contacts[0].contactName } : 'kein Treffer');
    return contacts[0] || null;
  } catch (e) {
    if (isDebug()) pushDebugEvent('findContact – Fehler', { customerNumber }, e.message);
    return null;
  }
}

async function resolveContact(card) {
  const settings = getSettings();

  // Card → direct Company → customer_number
  if (card.company_id) {
    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(card.company_id);
    if (company?.customer_number) {
      const contact = await findContactByCustomerNumber(company.customer_number);
      if (contact) return contact.id;
    }
  }

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

  // Check if GHL returned an existing opportunity (deduplication)
  const existingCard = oppId ? db.prepare('SELECT id FROM cards WHERE ghl_opportunity_id = ? AND id != ?').get(oppId, card.id) : null;
  pushDebugEvent('createOpportunity – Ergebnis', { card_id: card.id, card_title: card.title },
    oppId
      ? (existingCard ? `GHL hat bestehende Opportunity zurückgegeben (Karte #${existingCard.id} hat dieselbe ID ${oppId}) – GHL dedupliziert!` : `Neue Opportunity erstellt: ${oppId}`)
      : 'Keine Opportunity-ID in GHL-Antwort'
  );

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

async function deleteOpportunity(ghlOpportunityId) {
  await ghlFetch(`/opportunities/${ghlOpportunityId}`, { method: 'DELETE' });
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
    if (isDebug()) pushDebugEvent('syncCardArchived', { card_id: card.id, ghl_opportunity_id: card.ghl_opportunity_id }, 'Lösche Opportunity in GHL…');
    await deleteOpportunity(card.ghl_opportunity_id);
    db.prepare('UPDATE cards SET ghl_opportunity_id = NULL WHERE id = ?').run(card.id);
  } catch (e) {
    if (isDebug()) pushDebugEvent('syncCardArchived – Fehler', { card_id: cardId }, e.message);
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
  pushDebugEvent,
};
