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
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table>
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
      </table></div>

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

// ===== Customers page =====
let customerSort = { col: 'name', dir: 'asc' };

window.loadCustomers = async function() {
  const container = document.getElementById('page-customers');
  const canEdit = currentUser && (currentUser.role === 'admin' || currentUser.role === 'employee');

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Kunden</h1>
      ${canEdit ? `
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary" id="add-company-btn">+ Neue Firma</button>
          <button class="btn btn-primary" id="add-customer-btn">+ Neue Person</button>
        </div>` : ''}
    </div>
    <div style="padding:16px 20px">
      <input type="text" id="customer-search" placeholder="Suchen nach Name, Firma, E-Mail…" style="max-width:320px;width:100%">
    </div>
    <div id="customer-list-area" style="padding:0 20px 20px"></div>
  `;

  document.getElementById('customer-search').addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    await refreshCustomerPage(q);
  });

  if (canEdit) {
    document.getElementById('add-company-btn').addEventListener('click', () => showCompanyForm(null));
    document.getElementById('add-customer-btn').addEventListener('click', () => showCustomerForm(null, null));
  }

  await refreshCustomerPage();
};

async function refreshCustomerPage(q = '') {
  try {
    const [companies, customers] = await Promise.all([
      apiFetch(`/api/companies?q=${encodeURIComponent(q)}`),
      apiFetch(`/api/customers?q=${encodeURIComponent(q)}`),
    ]);
    renderCustomerPage(companies, customers);
  } catch (e) {
    showToast('Fehler beim Laden', 'error');
  }
}

function sortCustomers(customers) {
  const { col, dir } = customerSort;
  return [...customers].sort((a, b) => {
    let av = (a[col] || '').toString().toLowerCase();
    let bv = (b[col] || '').toString().toLowerCase();
    if (col === 'card_count') { av = a.card_count || 0; bv = b.card_count || 0; }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === 'asc' ? cmp : -cmp;
  });
}

function sortIcon(col) {
  if (customerSort.col !== col) return '<span style="opacity:.3;font-size:10px"> ↕</span>';
  return customerSort.dir === 'asc' ? '<span style="font-size:10px"> ↑</span>' : '<span style="font-size:10px"> ↓</span>';
}

function renderCustomerPage(companies, allCustomers) {
  const area = document.getElementById('customer-list-area');
  if (!area) return;
  const canEdit = currentUser && (currentUser.role === 'admin' || currentUser.role === 'employee');

  // Group customers by company
  const byCompany = {};
  const standalone = [];
  for (const c of allCustomers) {
    if (c.company_id) {
      if (!byCompany[c.company_id]) byCompany[c.company_id] = [];
      byCompany[c.company_id].push(c);
    } else {
      standalone.push(c);
    }
  }

  function personTable(persons) {
    if (!persons.length) return '<p style="font-size:12px;color:var(--text-muted);padding:8px 0;margin:0">Keine Personen</p>';
    const sorted = sortCustomers(persons);
    return `
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
      <table>
        <thead><tr>
          <th class="sort-th" data-col="name" style="cursor:pointer">Name${sortIcon('name')}</th>
          <th class="sort-th" data-col="email" style="cursor:pointer">E-Mail${sortIcon('email')}</th>
          <th class="sort-th" data-col="phone" style="cursor:pointer">Telefon${sortIcon('phone')}</th>
          <th class="sort-th" data-col="card_count" style="cursor:pointer">Karten${sortIcon('card_count')}</th>
          <th>Aktionen</th>
        </tr></thead>
        <tbody>
          ${sorted.map(c => `
            <tr>
              <td><strong>${escapeHtml(c.name)}</strong></td>
              <td>${c.email ? `<a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>` : '—'}</td>
              <td>${escapeHtml(c.phone || '—')}</td>
              <td>${c.card_count || 0}</td>
              <td style="white-space:nowrap">
                ${canEdit ? `
                  <button class="btn btn-sm btn-secondary edit-customer-btn" data-id="${c.id}">Bearb.</button>
                  <button class="btn btn-sm btn-danger delete-customer-btn" data-id="${c.id}" style="margin-left:4px">Löschen</button>
                ` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>`;
  }

  let html = '';

  // Companies with their persons
  for (const co of companies) {
    const persons = byCompany[co.id] || [];
    html += `
      <div class="company-block">
        <div class="company-block-header">
          <div style="flex:1;min-width:0">
            <strong>${escapeHtml(co.name)}</strong>
            ${co.email ? `<a href="mailto:${escapeHtml(co.email)}" style="font-size:12px;color:var(--secondary);margin-left:8px">${escapeHtml(co.email)}</a>` : ''}
            ${co.phone ? `<span style="font-size:12px;color:var(--secondary);margin-left:8px">${escapeHtml(co.phone)}</span>` : ''}
          </div>
          ${canEdit ? `
            <button class="btn btn-sm btn-secondary add-person-btn" data-company-id="${co.id}" data-company-name="${escapeHtml(co.name)}">+ Person</button>
            <button class="btn btn-sm btn-secondary edit-company-btn" data-id="${co.id}" style="margin-left:4px">Bearb.</button>
            <button class="btn btn-sm btn-danger delete-company-btn" data-id="${co.id}" style="margin-left:4px">Löschen</button>
          ` : ''}
        </div>
        <div class="company-block-body">${personTable(persons)}</div>
      </div>`;
  }

  // Standalone persons (no company)
  if (standalone.length > 0) {
    html += `
      <div class="company-block">
        <div class="company-block-header">
          <div style="flex:1"><strong style="color:var(--secondary)">Ohne Firma</strong></div>
        </div>
        <div class="company-block-body">${personTable(standalone)}</div>
      </div>`;
  }

  if (!html) html = '<div class="empty-state">Keine Kunden gefunden</div>';
  area.innerHTML = html;

  // Sort handlers
  area.querySelectorAll('.sort-th').forEach(th => {
    th.addEventListener('click', async () => {
      const col = th.dataset.col;
      if (customerSort.col === col) {
        customerSort.dir = customerSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        customerSort.col = col;
        customerSort.dir = 'asc';
      }
      const q = document.getElementById('customer-search')?.value || '';
      await refreshCustomerPage(q);
    });
  });

  // Company actions
  area.querySelectorAll('.edit-company-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const co = await apiFetch(`/api/companies?q=`);
      const found = co.find(c => c.id === parseInt(btn.dataset.id));
      if (found) showCompanyForm(found);
    });
  });
  area.querySelectorAll('.delete-company-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showConfirm('Firma löschen', 'Firma löschen? Zugehörige Personen bleiben erhalten.')) return;
      try {
        await apiFetch(`/api/companies/${btn.dataset.id}`, { method: 'DELETE' });
        showToast('Firma gelöscht', 'success');
        refreshCustomerPage(document.getElementById('customer-search')?.value || '');
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });
  area.querySelectorAll('.add-person-btn').forEach(btn => {
    btn.addEventListener('click', () => showCustomerForm(null, parseInt(btn.dataset.companyId)));
  });

  // Person actions
  area.querySelectorAll('.edit-customer-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const c = await apiFetch(`/api/customers/${btn.dataset.id}`);
      showCustomerForm(c, c.company_id);
    });
  });
  area.querySelectorAll('.delete-customer-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showConfirm('Person löschen', 'Person löschen? Verknüpfte Karten werden getrennt.')) return;
      try {
        await apiFetch(`/api/customers/${btn.dataset.id}`, { method: 'DELETE' });
        showToast('Person gelöscht', 'success');
        refreshCustomerPage(document.getElementById('customer-search')?.value || '');
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });
}

function showCompanyForm(company) {
  const modal = document.getElementById('create-card-modal');
  const body = document.getElementById('create-card-modal-body');
  document.querySelector('#create-card-modal .modal-header h2').textContent = company ? 'Firma bearbeiten' : 'Neue Firma';

  body.innerHTML = `
    <div class="modal-body">
      <form id="company-form">
        <div class="form-group">
          <label class="required">Firmenname</label>
          <input type="text" name="name" required value="${escapeHtml(company?.name || '')}">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>E-Mail</label>
            <input type="email" name="email" value="${escapeHtml(company?.email || '')}">
          </div>
          <div class="form-group">
            <label>Telefon</label>
            <input type="text" name="phone" value="${escapeHtml(company?.phone || '')}">
          </div>
        </div>
        <div class="form-group">
          <label>Notizen</label>
          <textarea name="notes">${escapeHtml(company?.notes || '')}</textarea>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="co-cancel-btn">Abbrechen</button>
      <button class="btn btn-primary" id="co-save-btn">${company ? 'Speichern' : 'Erstellen'}</button>
    </div>
  `;

  modal.classList.remove('hidden');
  const close = () => modal.classList.add('hidden');
  document.getElementById('create-card-modal-close').onclick = close;
  document.getElementById('create-card-modal-backdrop').onclick = close;
  document.getElementById('co-cancel-btn').onclick = close;

  document.getElementById('co-save-btn').addEventListener('click', async () => {
    const data = Object.fromEntries(new FormData(document.getElementById('company-form')));
    if (!data.name) { showToast('Name erforderlich', 'error'); return; }
    try {
      if (company) {
        await apiFetch(`/api/companies/${company.id}`, { method: 'PUT', body: JSON.stringify(data) });
        showToast('Firma gespeichert', 'success');
      } else {
        await apiFetch('/api/companies', { method: 'POST', body: JSON.stringify(data) });
        showToast('Firma erstellt', 'success');
      }
      close();
      refreshCustomerPage(document.getElementById('customer-search')?.value || '');
    } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
  });
}

function showCustomerForm(customer, defaultCompanyId) {
  const modal = document.getElementById('create-card-modal');
  const body = document.getElementById('create-card-modal-body');
  document.querySelector('#create-card-modal .modal-header h2').textContent = customer ? 'Person bearbeiten' : 'Neue Person';

  const companyId = customer?.company_id ?? defaultCompanyId ?? null;

  body.innerHTML = `
    <div class="modal-body">
      <form id="customer-form">
        <div class="form-group">
          <label class="required">Name</label>
          <input type="text" name="name" required value="${escapeHtml(customer?.name || '')}">
        </div>
        <div class="form-group">
          <label>Firma</label>
          <select name="company_id" id="customer-company-select">
            <option value="">— Keine Firma —</option>
          </select>
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
      </form>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="customer-cancel-btn">Abbrechen</button>
      <button class="btn btn-primary" id="customer-save-btn">${customer ? 'Speichern' : 'Erstellen'}</button>
    </div>
  `;

  // Populate company dropdown
  apiFetch('/api/companies').then(companies => {
    const sel = document.getElementById('customer-company-select');
    if (!sel) return;
    for (const co of companies) {
      const opt = document.createElement('option');
      opt.value = co.id;
      opt.textContent = co.name;
      if (co.id === companyId) opt.selected = true;
      sel.appendChild(opt);
    }
  });

  modal.classList.remove('hidden');
  const close = () => modal.classList.add('hidden');
  document.getElementById('create-card-modal-close').onclick = close;
  document.getElementById('create-card-modal-backdrop').onclick = close;
  document.getElementById('customer-cancel-btn').onclick = close;

  document.getElementById('customer-save-btn').addEventListener('click', async () => {
    const formData = new FormData(document.getElementById('customer-form'));
    const data = Object.fromEntries(formData);
    data.company_id = data.company_id || null;
    if (!data.name) { showToast('Name erforderlich', 'error'); return; }
    try {
      if (customer) {
        await apiFetch(`/api/customers/${customer.id}`, { method: 'PUT', body: JSON.stringify(data) });
        showToast('Person gespeichert', 'success');
      } else {
        await apiFetch('/api/customers', { method: 'POST', body: JSON.stringify(data) });
        showToast('Person erstellt', 'success');
      }
      close();
      refreshCustomerPage(document.getElementById('customer-search')?.value || '');
    } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
  });
}
