'use strict';

let archiveFilters = { from: '', to: '', customer_id: '', location_id: '', label_id: '' };
let archivePage = { limit: 20, offset: 0, total: 0 };

window.loadArchive = async function() {
  const container = document.getElementById('page-archive');

  try {
    const [customers, locations, labels] = await Promise.all([
      apiFetch('/api/customers'),
      apiFetch('/api/locations'),
      apiFetch('/api/labels'),
    ]);

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Archiv</h1>
      </div>
      <div class="archive-filters">
        <div class="form-group" style="margin:0">
          <label style="font-size:12px;margin-bottom:2px">Von</label>
          <input type="date" id="archive-from" value="${archiveFilters.from}">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:12px;margin-bottom:2px">Bis</label>
          <input type="date" id="archive-to" value="${archiveFilters.to}">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:12px;margin-bottom:2px">Kunde</label>
          <select id="archive-customer">
            <option value="">Alle Kunden</option>
            ${customers.map(c => `<option value="${c.id}" ${archiveFilters.customer_id == c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:12px;margin-bottom:2px">Standort</label>
          <select id="archive-location">
            <option value="">Alle Standorte</option>
            ${locations.map(l => `<option value="${l.id}" ${archiveFilters.location_id == l.id ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:12px;margin-bottom:2px">Label</label>
          <select id="archive-label">
            <option value="">Alle Labels</option>
            ${labels.map(l => `<option value="${l.id}" ${archiveFilters.label_id == l.id ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary btn-sm" id="archive-search-btn">Suchen</button>
        <button class="btn btn-secondary btn-sm" id="archive-reset-btn">Zurücksetzen</button>
      </div>
      <div id="archive-results" style="padding:20px">
        <div class="loading"><div class="spinner"></div></div>
      </div>
    `;

    // Filter events
    document.getElementById('archive-search-btn').addEventListener('click', () => {
      archiveFilters.from = document.getElementById('archive-from').value;
      archiveFilters.to = document.getElementById('archive-to').value;
      archiveFilters.customer_id = document.getElementById('archive-customer').value;
      archiveFilters.location_id = document.getElementById('archive-location').value;
      archiveFilters.label_id = document.getElementById('archive-label').value;
      archivePage.offset = 0;
      fetchArchive();
    });

    document.getElementById('archive-reset-btn').addEventListener('click', () => {
      archiveFilters = { from: '', to: '', customer_id: '', location_id: '', label_id: '' };
      document.getElementById('archive-from').value = '';
      document.getElementById('archive-to').value = '';
      document.getElementById('archive-customer').value = '';
      document.getElementById('archive-location').value = '';
      document.getElementById('archive-label').value = '';
      archivePage.offset = 0;
      fetchArchive();
    });

    fetchArchive();
  } catch (e) {
    container.innerHTML = `<div class="empty-state">Fehler: ${escapeHtml(e.message)}</div>`;
  }
};

async function fetchArchive() {
  const params = new URLSearchParams({ limit: archivePage.limit, offset: archivePage.offset });
  if (archiveFilters.from) params.set('from', archiveFilters.from);
  if (archiveFilters.to) params.set('to', archiveFilters.to);
  if (archiveFilters.customer_id) params.set('customer_id', archiveFilters.customer_id);
  if (archiveFilters.location_id) params.set('location_id', archiveFilters.location_id);
  if (archiveFilters.label_id) params.set('label_id', archiveFilters.label_id);

  const resultsContainer = document.getElementById('archive-results');
  resultsContainer.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const data = await apiFetch(`/api/archive?${params.toString()}`);
    archivePage.total = data.total;
    renderArchiveTable(resultsContainer, data.cards, data.total);
  } catch (e) {
    resultsContainer.innerHTML = `<div class="empty-state">Fehler: ${escapeHtml(e.message)}</div>`;
  }
}

function renderArchiveTable(container, cards, total) {
  const canEdit = currentUser && (currentUser.role === 'admin' || currentUser.role === 'employee');

  if (cards.length === 0) {
    container.innerHTML = '<div class="empty-state">Keine archivierten Karten gefunden</div>';
    return;
  }

  const totalPages = Math.ceil(total / archivePage.limit);
  const currentPage = Math.floor(archivePage.offset / archivePage.limit) + 1;

  container.innerHTML = `
    <div class="archive-table">
      <div style="margin-bottom:12px;font-size:13px;color:var(--secondary)">${total} Karte(n) gefunden</div>
      <table>
        <thead>
          <tr>
            <th>Auftragsnr.</th>
            <th>Titel</th>
            <th>Kunde</th>
            <th>Zuletzt in</th>
            <th>Standort</th>
            <th>Archiviert am</th>
            <th>Labels</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          ${cards.map(card => `
            <tr>
              <td>${escapeHtml(card.order_number || '—')}</td>
              <td>
                <span style="cursor:pointer;color:var(--primary);font-weight:500" onclick="openCard(${card.id})">${escapeHtml(card.title)}</span>
              </td>
              <td>${escapeHtml(card.customer_name || '—')}</td>
              <td>
                <span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${escapeHtml(card.group_color)};color:white;font-size:12px">
                  ${escapeHtml(card.group_name)}
                </span>
                <span style="font-size:12px;color:var(--secondary)"> / ${escapeHtml(card.column_name)}</span>
              </td>
              <td>${escapeHtml(card.location_name || '—')}</td>
              <td>${formatDate(card.archived_at)}</td>
              <td>
                <div style="display:flex;flex-wrap:wrap;gap:3px">
                  ${(card.labels || []).slice(0, 3).map(l =>
                    `<span class="card-label" style="background:${escapeHtml(l.color)}">${escapeHtml(l.name)}</span>`
                  ).join('')}
                  ${card.labels && card.labels.length > 3 ? `<span class="card-label-more">+${card.labels.length - 3}</span>` : ''}
                </div>
              </td>
              <td style="white-space:nowrap">
                <button class="btn btn-sm btn-secondary" onclick="openCard(${card.id})">Öffnen</button>
                ${canEdit ? `<button class="btn btn-sm btn-success restore-btn" data-card-id="${card.id}" style="margin-left:4px">Wiederherstellen</button>` : ''}
                <a href="/api/cards/${card.id}/pdf" class="btn btn-sm btn-secondary" target="_blank" style="margin-left:4px">PDF</a>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      ${totalPages > 1 ? `
      <div class="pagination">
        <button onclick="archiveGoPage(${currentPage - 2})" ${currentPage <= 1 ? 'disabled' : ''}>← Zurück</button>
        <span class="current-page">Seite ${currentPage} von ${totalPages}</span>
        <button onclick="archiveGoPage(${currentPage})" ${currentPage >= totalPages ? 'disabled' : ''}>Weiter →</button>
      </div>` : ''}
    </div>
  `;

  // Restore buttons
  container.querySelectorAll('.restore-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cardId = btn.dataset.cardId;
      if (!await showConfirm('Wiederherstellen', 'Karte aus dem Archiv wiederherstellen?')) return;
      try {
        await apiFetch(`/api/cards/${cardId}/restore`, { method: 'POST' });
        showToast('Karte wiederhergestellt', 'success');
        fetchArchive();
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });
}

window.archiveGoPage = function(page) {
  archivePage.offset = page * archivePage.limit;
  fetchArchive();
};

// Customers page
window.loadCustomers = async function() {
  const container = document.getElementById('page-customers');
  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Kunden</h1>
      ${currentUser && currentUser.role !== 'readonly' ? `<button class="btn btn-primary" id="add-customer-btn">+ Neuer Kunde</button>` : ''}
    </div>
    <div style="padding:20px">
      <div class="form-group" style="max-width:300px">
        <input type="text" id="customer-search" placeholder="Kunde suchen...">
      </div>
      <div class="loading"><div class="spinner"></div></div>
    </div>
  `;

  // Search
  document.getElementById('customer-search').addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    try {
      const customers = await apiFetch(`/api/customers?q=${encodeURIComponent(q)}`);
      renderCustomerList(customers);
    } catch (e) {}
  });

  if (currentUser && currentUser.role !== 'readonly') {
    document.getElementById('add-customer-btn').addEventListener('click', () => showCustomerForm(null));
  }

  await refreshCustomerList();
};

async function refreshCustomerList(q = '') {
  try {
    const customers = await apiFetch(`/api/customers?q=${encodeURIComponent(q)}`);
    renderCustomerList(customers);
  } catch (e) {
    showToast('Fehler beim Laden', 'error');
  }
}

function renderCustomerList(customers) {
  const container = document.querySelector('#page-customers > div:last-child');
  if (!container) return;

  const canEdit = currentUser && (currentUser.role === 'admin' || currentUser.role === 'employee');

  container.innerHTML = `
    <div class="form-group" style="max-width:300px">
      <input type="text" id="customer-search" placeholder="Kunde suchen..." value="">
    </div>
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Firma</th>
            <th>E-Mail</th>
            <th>Telefon</th>
            <th>Karten</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          ${customers.map(c => `
            <tr>
              <td><strong>${escapeHtml(c.name)}</strong></td>
              <td>${escapeHtml(c.company || '—')}</td>
              <td>${c.email ? `<a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>` : '—'}</td>
              <td>${escapeHtml(c.phone || '—')}</td>
              <td>${c.card_count || 0}</td>
              <td style="white-space:nowrap">
                ${canEdit ? `
                  <button class="btn btn-sm btn-secondary edit-customer-btn" data-customer-id="${c.id}">Bearbeiten</button>
                  <button class="btn btn-sm btn-danger delete-customer-btn" data-customer-id="${c.id}" style="margin-left:4px">Löschen</button>
                ` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('customer-search').addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    const result = await apiFetch(`/api/customers?q=${encodeURIComponent(q)}`);
    renderCustomerList(result);
  });

  container.querySelectorAll('.edit-customer-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const customer = await apiFetch(`/api/customers/${btn.dataset.customerId}`);
      showCustomerForm(customer);
    });
  });

  container.querySelectorAll('.delete-customer-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showConfirm('Kunden löschen', 'Kunden wirklich löschen? Verknüpfte Karten werden getrennt.')) return;
      try {
        await apiFetch(`/api/customers/${btn.dataset.customerId}`, { method: 'DELETE' });
        showToast('Kunde gelöscht', 'success');
        refreshCustomerList();
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });
}

function showCustomerForm(customer) {
  const modal = document.getElementById('create-card-modal');
  const body = document.getElementById('create-card-modal-body');
  document.querySelector('#create-card-modal .modal-header h2').textContent = customer ? 'Kunden bearbeiten' : 'Neuer Kunde';

  body.innerHTML = `
    <div class="modal-body">
      <form id="customer-form">
        <div class="form-row">
          <div class="form-group">
            <label class="required">Name</label>
            <input type="text" name="name" required value="${escapeHtml(customer?.name || '')}">
          </div>
          <div class="form-group">
            <label>Firma</label>
            <input type="text" name="company" value="${escapeHtml(customer?.company || '')}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>E-Mail</label>
            <input type="email" name="email" value="${escapeHtml(customer?.email || '')}">
          </div>
          <div class="form-group">
            <label>Telefon</label>
            <input type="text" name="phone" value="${escapeHtml(customer?.phone || '')}">
          </div>
        </div>
        <div class="form-group">
          <label>Notizen</label>
          <textarea name="notes">${escapeHtml(customer?.notes || '')}</textarea>
        </div>
        <div id="customer-form-error" class="error-msg hidden"></div>
      </form>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="customer-cancel-btn">Abbrechen</button>
      <button class="btn btn-primary" id="customer-save-btn">${customer ? 'Speichern' : 'Erstellen'}</button>
    </div>
  `;

  modal.classList.remove('hidden');
  document.getElementById('create-card-modal-close').onclick = () => modal.classList.add('hidden');
  document.getElementById('create-card-modal-backdrop').onclick = () => modal.classList.add('hidden');
  document.getElementById('customer-cancel-btn').onclick = () => modal.classList.add('hidden');

  document.getElementById('customer-save-btn').addEventListener('click', async () => {
    const form = document.getElementById('customer-form');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);

    if (!data.name) {
      document.getElementById('customer-form-error').textContent = 'Name ist erforderlich';
      document.getElementById('customer-form-error').classList.remove('hidden');
      return;
    }

    try {
      if (customer) {
        await apiFetch(`/api/customers/${customer.id}`, { method: 'PUT', body: JSON.stringify(data) });
        showToast('Kunde gespeichert', 'success');
      } else {
        await apiFetch('/api/customers', { method: 'POST', body: JSON.stringify(data) });
        showToast('Kunde erstellt', 'success');
      }
      modal.classList.add('hidden');
      refreshCustomerList();
    } catch (e) {
      document.getElementById('customer-form-error').textContent = e.message;
      document.getElementById('customer-form-error').classList.remove('hidden');
    }
  });
}
