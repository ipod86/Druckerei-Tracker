'use strict';

const db = require('../db/database');

const GHL_BASE = 'https://services.leadconnectorhq.com';

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

  const res = await fetch(`${GHL_BASE}${path}`, {
    ...options,
    headers: { ...authHeaders(settings.api_key), ...(options.headers || {}) },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GHL API Fehler ${res.status}: ${text}`);
  }
  return res.json();
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
    const data = await ghlFetch(
      `/contacts/?locationId=${settings.location_id}&query=${encodeURIComponent(customerNumber)}&limit=5`
    );
    const contacts = data.contacts || [];
    // Match by customField or name containing the number
    return contacts.find(c =>
      (c.customFields || []).some(f => f.value === String(customerNumber)) ||
      c.name?.includes(String(customerNumber))
    ) || contacts[0] || null;
  } catch {
    return null;
  }
}

async function resolveContact(card) {
  const settings = getSettings();

  // Card → Person → Company → customer_number → GHL contact
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

  // Fallback contact
  if (settings?.fallback_contact_id) return settings.fallback_contact_id;
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
  await ghlFetch(`/opportunities/${ghlOpportunityId}/move-to-stage`, {
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

async function syncCardCreated(card) {
  try {
    const mapping = getColumnMapping(card.column_id);
    if (!mapping) return;
    await createOpportunity(card, mapping.pipeline_id, mapping.stage_id);
  } catch (e) {
    console.error('[GHL] syncCardCreated:', e.message);
  }
}

async function syncCardMoved(cardId, newColumnId) {
  try {
    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
    if (!card) return;

    const mapping = getColumnMapping(newColumnId);

    if (!card.ghl_opportunity_id) {
      // No opportunity yet — create one if the target column is mapped
      if (mapping) {
        await createOpportunity(card, mapping.pipeline_id, mapping.stage_id);
      }
      return;
    }

    if (mapping) {
      await moveOpportunity(card.ghl_opportunity_id, mapping.stage_id);
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
};
