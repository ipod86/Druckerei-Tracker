'use strict';

let boardData = null;
let boardFilters = { label_id: '', user_id: '' };
let dragState = null;

window.loadBoard = async function() {
  const container = document.getElementById('page-board');
  container.innerHTML = `
    <div class="board-filter-bar">
      <strong style="font-size:13px;margin-right:4px">Board</strong>
      <select id="board-filter-label">
        <option value="">Alle Labels</option>
      </select>
      <select id="board-filter-user">
        <option value="">Alle Benutzer</option>
      </select>
      <button class="btn btn-secondary btn-sm" onclick="loadBoard()">Aktualisieren</button>
    </div>
    <div class="board-wrapper" id="board-wrapper">
      <div class="loading"><div class="spinner"></div></div>
    </div>
  `;

  // Load filter options
  try {
    const [labels, users] = await Promise.all([
      apiFetch('/api/labels'),
      currentUser.role === 'admin' ? apiFetch('/api/users') : Promise.resolve([]),
    ]);

    const lblSel = document.getElementById('board-filter-label');
    labels.forEach(l => {
      lblSel.innerHTML += `<option value="${l.id}">${escapeHtml(l.name)}</option>`;
    });
    lblSel.value = boardFilters.label_id;

    if (users.length > 0) {
      const userSel = document.getElementById('board-filter-user');
      users.forEach(u => {
        userSel.innerHTML += `<option value="${u.id}">${escapeHtml(u.username)}</option>`;
      });
      userSel.value = boardFilters.user_id;
    }

    lblSel.addEventListener('change', () => { boardFilters.label_id = lblSel.value; renderBoard(); });
    const userSel = document.getElementById('board-filter-user');
    if (userSel) userSel.addEventListener('change', () => { boardFilters.user_id = userSel.value; renderBoard(); });
  } catch (e) {}

  await fetchAndRenderBoard();
};

async function fetchAndRenderBoard() {
  try {
    const params = new URLSearchParams();
    if (boardFilters.label_id) params.set('label_id', boardFilters.label_id);
    if (boardFilters.user_id) params.set('user_id', boardFilters.user_id);

    boardData = await apiFetch(`/api/cards/board?${params.toString()}`);
    renderBoard();
  } catch (e) {
    document.getElementById('board-wrapper').innerHTML = `<div class="empty-state">Fehler beim Laden des Boards: ${escapeHtml(e.message)}</div>`;
  }
}

function renderBoard() {
  if (!boardData) return;
  const wrapper = document.getElementById('board-wrapper');
  if (!wrapper) return;

  const { groups, columns, cardsByColumn } = boardData;

  let html = '<div class="board">';

  for (const group of groups) {
    const groupCols = columns.filter(c => c.group_id === group.id);
    if (groupCols.length === 0) continue;

    html += `<div class="board-group">
      <div class="board-group-header" style="background:${escapeHtml(group.color || '#4a90d9')}">${escapeHtml(group.name)}</div>
      <div class="board-group-columns">`;

    for (const col of groupCols) {
      const cards = (cardsByColumn[col.id] || []).filter(card => {
        if (boardFilters.label_id && !card.labels.find(l => String(l.id) === boardFilters.label_id)) return false;
        if (boardFilters.user_id && String(card.created_by) !== boardFilters.user_id) return false;
        return true;
      });

      html += `<div class="board-column" data-column-id="${col.id}">
        <div class="column-header">
          <span class="column-title">${escapeHtml(col.name)}</span>
          <span class="column-count">${cards.length}</span>
        </div>
        <div class="column-cards" id="col-${col.id}" data-column-id="${col.id}" data-group-id="${group.id}" data-group-order="${group.order_index}">`;

      for (const card of cards) {
        html += renderCardMini(card);
      }

      html += `</div>`;

      if (currentUser && currentUser.role !== 'readonly') {
        html += `<div style="display:flex;gap:4px">
          <button class="add-card-btn" style="flex:1" data-column-id="${col.id}" data-column-name="${escapeHtml(col.name)}">+ Karte hinzufügen</button>
          <button class="add-divider-btn" data-column-id="${col.id}" title="Überschrift hinzufügen" style="padding:6px 8px;background:transparent;border:1px dashed var(--border);border-radius:var(--radius);color:var(--text-muted);cursor:pointer;font-size:14px">≡</button>
        </div>`;
      }

      html += `</div>`;
    }

    html += `</div></div>`;
  }

  html += '</div>';
  wrapper.innerHTML = html;

  // Add event listeners
  setupBoardEvents();
}

function renderCardMini(card) {
  // Divider cards render as section headers
  if (card.card_type === 'divider') {
    return `
      <div class="board-divider"
           data-card-id="${card.id}"
           data-column-id="${card.column_id}">
        <span class="board-divider-text">${escapeHtml(card.title)}</span>
        <button class="board-divider-delete" data-card-id="${card.id}" title="Überschrift löschen">&times;</button>
      </div>`;
  }

  const isOverdueCard = isOverdue(card);
  const labels = card.labels || [];
  const visibleLabels = labels.slice(0, 3);
  const extraLabels = labels.length - 3;

  let labelsHtml = '';
  if (labels.length > 0) {
    labelsHtml = '<div class="card-labels">';
    visibleLabels.forEach(l => {
      labelsHtml += `<span class="card-label" style="background:${escapeHtml(l.color)}">${escapeHtml(l.name)}</span>`;
    });
    if (extraLabels > 0) {
      labelsHtml += `<span class="card-label-more">+${extraLabels}</span>`;
    }
    labelsHtml += '</div>';
  }

  let checklistHtml = '';
  if (card.checklist_total > 0) {
    const pct = Math.round((card.checklist_done / card.checklist_total) * 100);
    checklistHtml = `
      <div class="card-checklist-progress">
        <div class="checklist-progress-bar"><div class="checklist-progress-fill" style="width:${pct}%"></div></div>
        <div class="checklist-progress-text">${card.checklist_done}/${card.checklist_total}</div>
      </div>`;
  }

  let dueHtml = '';
  if (card.due_date) {
    const overdueClass = isOverdueCard ? 'overdue' : '';
    dueHtml = `<span class="card-due ${overdueClass}">${formatDateShort(card.due_date)}</span>`;
  }

  let locationBadge = '';
  if (card.location_name) {
    locationBadge = `<span class="card-badge">${escapeHtml(card.location_name)}</span>`;
  }

  let customerHtml = '';
  if (card.customer_name) {
    customerHtml = `<div class="card-customer">${escapeHtml(card.customer_name)}</div>`;
  }

  let descHtml = '';
  if (card.description) {
    const preview = card.description.length > 80 ? card.description.substring(0, 80) + '…' : card.description;
    descHtml = `<div class="card-desc-preview">${escapeHtml(preview)}</div>`;
  }

  const filesHtml = card.files_count > 0
    ? `<span class="card-files-badge" title="${card.files_count} Anhang${card.files_count !== 1 ? '¨e' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        ${card.files_count}
      </span>`
    : '';

  return `
    <div class="board-card ${isOverdueCard ? 'overdue' : ''}"
         data-card-id="${card.id}"
         data-column-id="${card.column_id}">
      ${card.order_number ? `<div class="card-order">#${escapeHtml(card.order_number)}</div>` : ''}
      ${labelsHtml}
      <div class="card-title">${escapeHtml(card.title)}${filesHtml}</div>
      ${descHtml}
      ${customerHtml}
      <div class="card-meta">
        ${dueHtml}
      </div>
      ${checklistHtml}
    </div>`;
}

function setupBoardEvents() {
  // Sortable for each column
  const boardWrapper = document.getElementById('board-wrapper');

  document.querySelectorAll('.column-cards').forEach(col => {
    new Sortable(col, {
      group: 'kanban',
      animation: 200,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      delay: 150,
      delayOnTouchOnly: true,
      touchStartThreshold: 5,
      scroll: col,           // scroll only this column, never the page
      scrollSensitivity: 60,
      scrollSpeed: 10,
      bubbleScroll: false,   // don't bubble up to page-level scroll containers
      onStart: () => { document.body.style.overflow = 'hidden'; },
      onEnd: async (evt) => {
        document.body.style.overflow = '';
        const cardEl = evt.item;
        const cardId = cardEl.dataset.cardId;
        const sourceColumnId = cardEl.dataset.columnId;
        const targetColEl = evt.to;
        const targetColumnId = targetColEl.dataset.columnId;

        if (sourceColumnId === targetColumnId) {
          // Same column reorder — save positions without touching history
          const cardIds = [...targetColEl.querySelectorAll('.board-card[data-card-id]')].map(el => el.dataset.cardId);
          try {
            await apiFetch('/api/cards/reorder', {
              method: 'POST',
              body: JSON.stringify({ column_id: targetColumnId, card_ids: cardIds }),
            });
          } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
          return;
        }

        await executeDrop(cardId, sourceColumnId, targetColEl);
      }
    });
  });

  // Card click to open
  document.querySelectorAll('.board-card').forEach(card => {
    card.addEventListener('click', () => openCard(card.dataset.cardId));
  });

  // Add card buttons
  document.querySelectorAll('.add-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showCreateCardModal(btn.dataset.columnId, btn.dataset.columnName);
    });
  });

  // Add divider buttons
  document.querySelectorAll('.add-divider-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = prompt('Überschrift:');
      if (!name || !name.trim()) return;
      try {
        await apiFetch('/api/cards', {
          method: 'POST',
          body: JSON.stringify({ title: name.trim(), column_id: parseInt(btn.dataset.columnId), card_type: 'divider' }),
        });
        fetchAndRenderBoard();
      } catch(e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });

  // Delete divider buttons
  document.querySelectorAll('.board-divider-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!await showConfirm('Überschrift löschen', 'Diese Überschrift löschen?')) return;
      try {
        await apiFetch(`/api/cards/${btn.dataset.cardId}`, { method: 'DELETE' });
        fetchAndRenderBoard();
      } catch(e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });
}


async function executeDrop(cardId, sourceColumnId, targetColEl) {
  const targetColumnId  = targetColEl.dataset.columnId;
  const targetGroupId   = targetColEl.dataset.groupId;
  const targetGroupOrder = parseInt(targetColEl.dataset.groupOrder);

  if (sourceColumnId === targetColumnId) {
    return; // handled in onEnd already
  }

  const sourceCol = document.querySelector(`[id="col-${sourceColumnId}"]`);
  if (sourceCol) {
    const sourceGroupOrder = parseInt(sourceCol.dataset.groupOrder);
    const sourceGroupId    = sourceCol.dataset.groupId;

    if (targetGroupId !== sourceGroupId && targetGroupOrder < sourceGroupOrder) {
      showToast('Karten können nicht rückwärts verschoben werden', 'error');
      return;
    }

    if (targetGroupId !== sourceGroupId) {
      try {
        const fields = await apiFetch(`/api/transitions/group/${sourceGroupId}`);
        if (fields && fields.length > 0) {
          showMoveModal(cardId, targetColumnId, targetGroupId, fields);
          return;
        }
      } catch (_) {}
    }
  }

  await moveCardToColumn(cardId, targetColumnId, targetGroupId, []);
}

async function moveCardToColumn(cardId, columnId, groupId, transitionValues) {
  try {
    await apiFetch(`/api/cards/${cardId}/move`, {
      method: 'POST',
      body: JSON.stringify({ column_id: columnId, transition_values: transitionValues }),
    });
    showToast('Karte verschoben', 'success');
    await fetchAndRenderBoard();
  } catch (e) {
    showToast('Fehler: ' + e.message, 'error');
  }
}

// ===== Move Modal =====
function showMoveModal(cardId, targetColumnId, targetGroupId, fields) {
  const modal = document.getElementById('move-modal');
  const body = document.getElementById('move-modal-body');

  // Source group name from the first field's from_group_name
  const sourceGroupName = fields[0]?.from_group_name || '';

  // Group fields by transition
  const byTransition = {};
  const transitionOrder = [];
  for (const f of fields) {
    const key = f.transition_id || 0;
    if (!byTransition[key]) {
      byTransition[key] = { name: f.transition_name || '', fields: [] };
      transitionOrder.push(key);
    }
    byTransition[key].fields.push(f);
  }
  const multipleTransitions = transitionOrder.length > 1;

  let fieldsHtml = `<div class="modal-body">`;

  if (sourceGroupName) {
    fieldsHtml += `
      <div class="transition-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;flex-shrink:0">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
        <span>Übergabe aus <strong>${escapeHtml(sourceGroupName)}</strong></span>
      </div>`;
  }

  if (fields.length > 0) {
    fieldsHtml += `<div class="transition-fields-list">`;
    for (const tid of transitionOrder) {
      const tg = byTransition[tid];
      if (multipleTransitions && tg.name) {
        fieldsHtml += `<div class="transition-subheader">${escapeHtml(tg.name)}</div>`;
      }
      for (const field of tg.fields) {
        const typeIcon = field.field_type === 'date' ? '📅' : field.field_type === 'select' ? '▾' : field.field_type === 'textarea' ? '¶' : '✏️';
        fieldsHtml += `<div class="transition-field">
          <label class="${field.required ? 'required' : ''}">
            <span class="tf-icon">${typeIcon}</span>${escapeHtml(field.field_name)}
          </label>`;

        if (field.field_type === 'select' && Array.isArray(field.field_options)) {
          fieldsHtml += `<select name="tf_${field.id}" ${field.required ? 'required' : ''}>
            <option value="">Bitte wählen...</option>
            ${field.field_options.map(opt => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join('')}
          </select>`;
        } else if (field.field_type === 'date') {
          fieldsHtml += `<input type="date" name="tf_${field.id}" ${field.required ? 'required' : ''}>`;
        } else if (field.field_type === 'textarea') {
          fieldsHtml += `<textarea name="tf_${field.id}" rows="3" ${field.required ? 'required' : ''}></textarea>`;
        } else {
          fieldsHtml += `<input type="text" name="tf_${field.id}" ${field.required ? 'required' : ''}>`;
        }
        fieldsHtml += '</div>';
      }
    }
    fieldsHtml += `</div>`;
  }

  fieldsHtml += '</div>';
  fieldsHtml += `<div class="modal-footer">
    <button class="btn btn-secondary" id="move-cancel-btn">Abbrechen</button>
    <button class="btn btn-primary" id="move-confirm-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      Verschieben
    </button>
  </div>`;

  body.innerHTML = fieldsHtml;
  modal.classList.remove('hidden');

  document.getElementById('move-modal-close').onclick = () => modal.classList.add('hidden');
  document.getElementById('move-modal-backdrop').onclick = () => modal.classList.add('hidden');
  document.getElementById('move-cancel-btn').onclick = () => modal.classList.add('hidden');

  document.getElementById('move-confirm-btn').onclick = async () => {
    const transitionValues = [];
    let valid = true;

    for (const field of fields) {
      const input = body.querySelector(`[name="tf_${field.id}"]`);
      if (!input) continue;
      const value = input.value.trim();
      if (field.required && !value) {
        input.style.borderColor = 'var(--danger)';
        valid = false;
        continue;
      }
      transitionValues.push({ field_id: field.id, value });
    }

    if (!valid) {
      showToast('Bitte alle Pflichtfelder ausfüllen', 'error');
      return;
    }

    modal.classList.add('hidden');
    await moveCardToColumn(cardId, targetColumnId, targetGroupId, transitionValues);
  };
}

// ===== Create Card Modal =====
window.showCreateCardModal = async function(columnId, columnName) {
  const modal = document.getElementById('create-card-modal');
  const body = document.getElementById('create-card-modal-body');

  try {
    const [customers, locations, labels] = await Promise.all([
      apiFetch('/api/customers'),
      apiFetch('/api/locations'),
      apiFetch('/api/labels'),
    ]);

    body.innerHTML = `
      <div class="modal-body">
        <p style="margin-bottom:14px;color:var(--secondary);font-size:13px">Spalte: <strong>${escapeHtml(columnName)}</strong></p>
        <form id="create-card-form">
          <div class="form-group">
            <label class="required">Titel</label>
            <input type="text" name="title" required placeholder="Kartentitel">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Auftragsnummer</label>
              <input type="text" name="order_number" placeholder="z.B. AU-2024-001">
            </div>
            <div class="form-group">
              <label>Fälligkeitsdatum</label>
              <input type="date" name="due_date">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Kunde</label>
              <div class="customer-autocomplete" style="position:relative">
                <input type="text" id="customer-ac-input" autocomplete="off" placeholder="Name tippen oder neu eingeben…" style="width:100%">
                <div id="customer-ac-list" style="display:none;position:absolute;top:100%;left:0;right:0;background:white;border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);z-index:200;max-height:180px;overflow-y:auto"></div>
                <input type="hidden" name="customer_id" id="customer-ac-id">
                <input type="hidden" name="customer_new_name" id="customer-ac-new">
              </div>
            </div>
            <div class="form-group">
              <label>Standort</label>
              <select name="location_id">
                <option value="">Kein Standort</option>
                ${locations.filter(l => l.active).map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Kunden-E-Mail</label>
            <input type="email" name="customer_email" placeholder="kunde@beispiel.de">
          </div>
          <div class="form-group">
            <label>Beschreibung</label>
            <textarea name="description" placeholder="Beschreibung..."></textarea>
          </div>
          <div class="form-group">
            <label>Labels</label>
            <div style="display:flex;flex-wrap:wrap;gap:6px" id="create-card-labels">
              ${labels.map(l => `
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
                  <input type="checkbox" name="labels" value="${l.id}">
                  <span class="card-label" style="background:${escapeHtml(l.color)}">${escapeHtml(l.name)}</span>
                </label>
              `).join('')}
            </div>
          </div>
          <div id="create-card-error" class="error-msg hidden"></div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="create-card-cancel">Abbrechen</button>
        <button class="btn btn-primary" id="create-card-submit">Erstellen</button>
      </div>
    `;

    modal.classList.remove('hidden');

    // Customer autocomplete
    setupCustomerAutocomplete(customers);

    document.getElementById('create-card-modal-close').onclick = () => modal.classList.add('hidden');
    document.getElementById('create-card-modal-backdrop').onclick = () => modal.classList.add('hidden');
    document.getElementById('create-card-cancel').onclick = () => modal.classList.add('hidden');

    document.getElementById('create-card-submit').addEventListener('click', async () => {
      const form = document.getElementById('create-card-form');
      const data = Object.fromEntries(new FormData(form));
      const selectedLabels = Array.from(form.querySelectorAll('[name="labels"]:checked')).map(cb => parseInt(cb.value));

      if (!data.title) {
        document.getElementById('create-card-error').textContent = 'Titel ist erforderlich';
        document.getElementById('create-card-error').classList.remove('hidden');
        return;
      }

      try {
        // Create new customer on-the-fly if a name was typed that doesn't match any existing customer
        let customerId = data.customer_id ? parseInt(data.customer_id) : null;
        if (!customerId && data.customer_new_name && data.customer_new_name.trim()) {
          const newCust = await apiFetch('/api/customers', {
            method: 'POST',
            body: JSON.stringify({ name: data.customer_new_name.trim() }),
          });
          customerId = newCust.id;
        }

        await apiFetch('/api/cards', {
          method: 'POST',
          body: JSON.stringify({
            title: data.title,
            order_number: data.order_number || null,
            description: data.description || null,
            column_id: parseInt(columnId),
            customer_id: customerId,
            customer_email: data.customer_email || null,
            due_date: data.due_date || null,
            location_id: data.location_id ? parseInt(data.location_id) : null,
            labels: selectedLabels,
          }),
        });
        modal.classList.add('hidden');
        showToast('Karte erstellt', 'success');
        await fetchAndRenderBoard();
      } catch (e) {
        document.getElementById('create-card-error').textContent = e.message;
        document.getElementById('create-card-error').classList.remove('hidden');
      }
    });
  } catch (e) {
    showToast('Fehler: ' + e.message, 'error');
  }
};

function setupCustomerAutocomplete(customers) {
  const input = document.getElementById('customer-ac-input');
  const list = document.getElementById('customer-ac-list');
  const hiddenId = document.getElementById('customer-ac-id');
  const hiddenNew = document.getElementById('customer-ac-new');

  if (!input) return;

  function showSuggestions(q) {
    const val = q.trim().toLowerCase();
    list.innerHTML = '';

    if (!val) {
      list.style.display = 'none';
      return;
    }

    const matches = customers.filter(c =>
      c.name.toLowerCase().includes(val) ||
      (c.company && c.company.toLowerCase().includes(val))
    ).slice(0, 8);

    // "Neu anlegen" option if typed text doesn't exactly match any existing name
    const exactMatch = customers.some(c => c.name.toLowerCase() === val);
    if (!exactMatch) {
      const newItem = document.createElement('div');
      newItem.className = 'ac-item ac-item-new';
      newItem.innerHTML = `${escapeHtml(q.trim())} <span style="font-size:11px;color:var(--primary)">(neu anlegen)</span>`;
      newItem.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = q.trim();
        hiddenId.value = '';
        hiddenNew.value = q.trim();
        list.style.display = 'none';
      });
      list.appendChild(newItem);
    }

    matches.forEach(c => {
      const item = document.createElement('div');
      item.className = 'ac-item';
      item.textContent = c.name + (c.company ? ' – ' + c.company : '');
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = c.name + (c.company ? ' – ' + c.company : '');
        hiddenId.value = c.id;
        hiddenNew.value = '';
        list.style.display = 'none';
      });
      list.appendChild(item);
    });

    list.style.display = matches.length > 0 || !exactMatch ? 'block' : 'none';
  }

  input.addEventListener('input', () => {
    hiddenId.value = '';
    hiddenNew.value = '';
    showSuggestions(input.value);
  });

  input.addEventListener('focus', () => {
    if (input.value) showSuggestions(input.value);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { list.style.display = 'none'; }, 150);
    // If nothing selected via click, treat typed value as new customer name
    if (!hiddenId.value && input.value.trim()) {
      hiddenNew.value = input.value.trim();
    }
  });
}
