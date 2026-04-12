'use strict';

let currentCardId = null;
let allUsers = [];

window.openCard = async function(cardId) {
  currentCardId = cardId;
  const modal = document.getElementById('card-modal');
  const body = document.getElementById('card-modal-body');
  body.innerHTML = '<div class="loading" style="height:400px"><div class="spinner"></div></div>';
  modal.classList.remove('hidden');

  // Load users for mention autocomplete
  if (allUsers.length === 0) {
    try { allUsers = await apiFetch('/api/users'); } catch (e) {}
  }

  try {
    const card = await apiFetch(`/api/cards/${cardId}`);
    renderCardModal(card);
  } catch (e) {
    body.innerHTML = `<div class="empty-state">Fehler: ${escapeHtml(e.message)}</div>`;
  }
};

document.getElementById('card-modal-backdrop').addEventListener('click', closeCardModal);

function closeCardModal() {
  document.getElementById('card-modal').classList.add('hidden');
  currentCardId = null;
}

async function renderCardModal(card) {
  const body = document.getElementById('card-modal-body');
  const canEdit = currentUser && (currentUser.role === 'admin' || currentUser.role === 'employee');
  const isAdmin = currentUser && currentUser.role === 'admin';

  const checklistTotal = card.checklists ? card.checklists.reduce((sum, cl) => sum + (cl.items || []).length, 0) : 0;
  const checklistDone = card.checklists ? card.checklists.reduce((sum, cl) => sum + (cl.items || []).filter(i => i.completed).length, 0) : 0;

  const groupColor = card.group_color || '#4a90d9';

  body.innerHTML = `
    <div class="modal-header">
      <div style="flex:1">
        <span class="card-group-breadcrumb" style="background:${groupColor}">${escapeHtml(card.group_name)} / ${escapeHtml(card.column_name)}</span>
      </div>
      <div style="display:flex;gap:6px">
        ${canEdit ? `<button class="btn btn-sm btn-warning" id="card-archive-btn">${card.archived ? 'Wiederherstellen' : 'Archivieren'}</button>` : ''}
        <a href="/api/cards/${card.id}/pdf" class="btn btn-sm btn-secondary" target="_blank">PDF</a>
        <button class="modal-close" id="card-close-btn">&times;</button>
      </div>
    </div>
    ${canEdit && (isOverdue(card) || card.snoozed_until) ? (() => {
      const isSnoozed = card.snoozed_until && parseDbDate(card.snoozed_until) > new Date();
      if (isSnoozed) {
        const snoozeDate = parseDbDate(card.snoozed_until).toLocaleDateString('de-DE');
        return `
        <div class="snooze-banner snooze-active">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          <span>Schlummert bis: <strong>${snoozeDate}</strong></span>
          <div style="display:flex;align-items:center;gap:6px;margin-left:auto">
            <input type="date" id="snooze-date" style="font-size:12px;padding:2px 6px;border:1px solid rgba(255,255,255,.5);border-radius:4px;background:rgba(255,255,255,.15);color:inherit" min="${new Date().toISOString().slice(0,10)}">
            <button class="btn btn-sm" id="snooze-btn" style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);color:inherit;padding:3px 10px">Ändern</button>
            <button class="btn btn-sm" id="snooze-cancel-btn" style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);color:inherit;padding:3px 10px">Aufwecken</button>
          </div>
        </div>`;
      } else {
        return `
        <div class="snooze-banner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          <span>Erinnerung überfällig</span>
          <div style="display:flex;align-items:center;gap:6px;margin-left:auto">
            <span style="font-size:12px">Schlummern bis:</span>
            <input type="date" id="snooze-date" style="font-size:12px;padding:2px 6px;border:1px solid rgba(255,255,255,.5);border-radius:4px;background:rgba(255,255,255,.15);color:inherit" min="${new Date().toISOString().slice(0,10)}">
            <button class="btn btn-sm" id="snooze-btn" style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);color:inherit;padding:3px 10px">OK</button>
          </div>
        </div>`;
      }
    })() : ''}
    <div class="card-detail-layout">
      <div class="card-detail-main" id="card-detail-main">
        <!-- Title -->
        <div class="card-section">
          <textarea class="card-title-editable" id="card-title-input" ${canEdit ? '' : 'readonly'}>${escapeHtml(card.title)}</textarea>
        </div>

        <!-- Meta -->
        <div class="card-section">
          <div class="meta-grid">
            <span class="meta-label">Auftragsnr.</span>
            <span>${canEdit ? `<input class="inline-edit" id="card-order-num" value="${escapeHtml(card.order_number || '')}" placeholder="—">` : escapeHtml(card.order_number || '—')}</span>
            <span class="meta-label">Fälligkeitsdatum</span>
            <span>${canEdit ? `<input type="date" class="inline-edit" id="card-due-date" value="${escapeHtml(card.due_date || '')}">` : escapeHtml(card.due_date || '—')}</span>
            <span class="meta-label">Kunde</span>
            <span id="card-customer-display">${escapeHtml(card.customer_name || '—')}</span>
            <span class="meta-label">Kunden-E-Mail</span>
            <span>${canEdit ? `<input type="email" class="inline-edit" id="card-customer-email" value="${escapeHtml(card.customer_email || '')}" placeholder="—">` : escapeHtml(card.customer_email || '—')}</span>
            <span class="meta-label">Erstellt von</span>
            <span>${escapeHtml(card.created_by_name || '—')}</span>
            <span class="meta-label">Erstellt am</span>
            <span>${formatDate(card.created_at)}</span>
          </div>
        </div>

        <!-- Labels -->
        <div class="card-section">
          <div class="card-section-title">Labels</div>
          <div class="labels-list" id="card-labels-list">
            ${(card.labels || []).map(l => `
              <span class="label-chip" style="background:${escapeHtml(l.color)}" data-label-id="${l.id}">
                ${escapeHtml(l.name)}
                ${canEdit ? `<button class="remove-label" title="Entfernen">&times;</button>` : ''}
              </span>
            `).join('')}
            ${canEdit ? `<button class="btn btn-sm btn-secondary" id="add-label-btn">+ Label</button>` : ''}
          </div>
        </div>

        <!-- Description -->
        <div class="card-section">
          <div class="card-section-title">Beschreibung</div>
          ${canEdit ? `<textarea id="card-description" style="width:100%;border:1px solid var(--border);border-radius:var(--radius);padding:8px;font-size:13px;min-height:80px;resize:vertical" placeholder="Beschreibung...">${escapeHtml(card.description || '')}</textarea>
          <div style="display:flex;gap:8px;margin-top:6px">
            <button class="btn btn-sm btn-primary" id="save-description-btn">Speichern</button>
            <button class="btn btn-sm btn-secondary" id="cancel-card-btn">Abbrechen</button>
          </div>` :
          `<p>${escapeHtml(card.description || 'Keine Beschreibung')}</p>`}
        </div>

        <!-- Checklists -->
        <div class="card-section" id="checklists-section">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div class="card-section-title" style="margin-bottom:0">Checklisten ${checklistTotal > 0 ? `(${checklistDone}/${checklistTotal})` : ''}</div>
            ${canEdit ? `<button class="btn btn-sm btn-secondary" id="add-checklist-btn">+ Checkliste</button>` : ''}
          </div>
          <div id="checklists-container">
            ${renderChecklists(card.checklists || [], canEdit, card.id)}
          </div>
        </div>

        <!-- Comments -->
        <div class="card-section">
          <div class="card-section-title">Kommentare (${(card.comments || []).length})</div>
          <div id="comments-list">
            ${renderComments(card.comments || [])}
          </div>
          ${currentUser ? `
          <div class="comment-input-area" style="margin-top:12px;position:relative">
            <div style="flex:1">
              <textarea id="new-comment-input" placeholder="Kommentar hinzufügen... (@Benutzername für Erwähnungen)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:var(--radius);font-size:13px;resize:vertical;min-height:60px"></textarea>
              <div id="mention-autocomplete" class="mention-autocomplete hidden"></div>
            </div>
            <button class="btn btn-primary btn-sm" id="submit-comment-btn" style="align-self:flex-end">Senden</button>
          </div>` : ''}
        </div>

        <!-- Files -->
        <div class="card-section">
          <div class="card-section-title">Dateien (${(card.files || []).length})</div>
          <div class="file-list" id="files-list">
            ${renderFiles(card.files || [], card.id)}
          </div>
          ${canEdit ? `
          <div class="file-drop-zone" id="file-drop-zone">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;margin-bottom:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <div>Dateien hier ablegen oder <label for="file-input" style="color:var(--primary);cursor:pointer">auswählen</label></div>
            <input type="file" id="file-input" multiple accept=".pdf,.jpg,.jpeg,.png,.gif,.webp" style="display:none">
          </div>` : ''}
        </div>

        <!-- Transition Values -->
        ${card.transition_values && card.transition_values.length > 0 ? `
        <div class="card-section">
          <div class="card-section-title">Übergabewerte</div>
          ${(() => {
            // Group by from_group_name (the group the card left)
            const groups = {};
            for (const tv of card.transition_values) {
              const key = tv.from_group_name || '?';
              if (!groups[key]) groups[key] = [];
              groups[key].push(tv);
            }
            return Object.entries(groups).map(([grpName, values]) => `
              <div class="transition-value-group">
                <div class="transition-value-group-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  Übergabe aus ${escapeHtml(grpName)}
                </div>
                <div class="transition-value-rows">
                  ${values.map(tv => `
                    <div class="transition-value-row">
                      <span class="transition-value-label">${escapeHtml(tv.field_name)}</span>
                      <span class="transition-value-val">${escapeHtml(tv.value || '—')}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            `).join('');
          })()}
        </div>` : ''}

        <!-- History -->
        <div class="card-section">
          <div class="card-section-title">Verlauf</div>
          <div class="history-list" id="history-list">
            ${renderHistory(card.history || [])}
          </div>
        </div>
      </div>

      <!-- Sidebar -->
      <div class="card-detail-sidebar">
        ${canEdit ? `
        <div style="margin-bottom:16px">
          <div class="card-section-title">Aktionen</div>
          <button class="sidebar-action-btn" id="card-archive-sidebar-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
            ${card.archived ? 'Wiederherstellen' : 'Archivieren'}
          </button>
        </div>` : ''}

        <!-- Customer edit -->
        ${canEdit ? `
        <div style="margin-bottom:16px">
          <div class="card-section-title">Kunde ändern</div>
          <select id="card-customer-select" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:var(--radius);font-size:13px;margin-bottom:6px">
            <option value="">Kein Kunde</option>
          </select>
          <button class="btn btn-sm btn-primary" id="save-meta-btn" style="margin-top:6px;width:100%">Speichern</button>
        </div>` : ''}
      </div>
    </div>
  `;

  // Setup event listeners
  document.getElementById('card-close-btn').onclick = closeCardModal;

  // Title save on blur
  if (canEdit) {
    const titleInput = document.getElementById('card-title-input');
    autoResize(titleInput);
    titleInput.addEventListener('input', () => autoResize(titleInput));
    titleInput.addEventListener('blur', async () => {
      const newTitle = titleInput.value.trim();
      if (newTitle && newTitle !== card.title) {
        try {
          await apiFetch(`/api/cards/${card.id}`, {
            method: 'PUT',
            body: JSON.stringify({ title: newTitle }),
          });
          refreshBoard();
        } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
      }
    });

    // Cancel button
    document.getElementById('cancel-card-btn')?.addEventListener('click', closeCardModal);

    // Description save
    document.getElementById('save-description-btn').addEventListener('click', async () => {
      const desc = document.getElementById('card-description').value;
      try {
        await apiFetch(`/api/cards/${card.id}`, {
          method: 'PUT',
          body: JSON.stringify({ description: desc }),
        });
        closeCardModal();
        if (typeof refreshBoard === 'function') refreshBoard();
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });

    // Order number and due date
    ['card-order-num', 'card-due-date', 'card-customer-email'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('blur', async () => {
        const fieldMap = { 'card-order-num': 'order_number', 'card-due-date': 'due_date', 'card-customer-email': 'customer_email' };
        try {
          await apiFetch(`/api/cards/${card.id}`, {
            method: 'PUT',
            body: JSON.stringify({ [fieldMap[id]]: el.value || null }),
          });
        } catch (e) {}
      });
    });

    // Load customer and location selects
    loadMetaSelects(card);

    // Save meta
    document.getElementById('save-meta-btn').addEventListener('click', async () => {
      const custId = document.getElementById('card-customer-select').value;
      try {
        await apiFetch(`/api/cards/${card.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            customer_id: custId ? parseInt(custId) : null,
          }),
        });
        showToast('Gespeichert', 'success');
        const updatedCard = await apiFetch(`/api/cards/${card.id}`);
        document.getElementById('card-customer-display').textContent = updatedCard.customer_name || '—';
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });

    // Labels
    setupLabelHandlers(card.id, card.labels || []);

    // Snooze
    const snoozeBtn = document.getElementById('snooze-btn');
    if (snoozeBtn) {
      snoozeBtn.addEventListener('click', async () => {
        const dateInput = document.getElementById('snooze-date');
        const val = dateInput?.value;
        if (!val) { showToast('Bitte Datum wählen', 'error'); return; }
        try {
          await apiFetch(`/api/cards/${card.id}/snooze`, {
            method: 'POST',
            body: JSON.stringify({ until: val + 'T23:59:59' }),
          });
          showToast('Erinnerung verschoben', 'success');
          renderCardModal(await apiFetch(`/api/cards/${card.id}`));
          if (typeof fetchAndRenderBoard === 'function') fetchAndRenderBoard();
        } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
      });
    }

    // Snooze cancel (aufwecken)
    const snoozeCancelBtn = document.getElementById('snooze-cancel-btn');
    if (snoozeCancelBtn) {
      snoozeCancelBtn.addEventListener('click', async () => {
        try {
          await apiFetch(`/api/cards/${card.id}/snooze`, {
            method: 'POST',
            body: JSON.stringify({ until: null }),
          });
          showToast('Schlummer beendet', 'success');
          renderCardModal(await apiFetch(`/api/cards/${card.id}`));
          if (typeof fetchAndRenderBoard === 'function') fetchAndRenderBoard();
        } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
      });
    }

    // Archive
    document.getElementById('card-archive-btn').addEventListener('click', () => handleArchive(card));
    document.getElementById('card-archive-sidebar-btn').addEventListener('click', () => handleArchive(card));

    // Checklists
    setupChecklistHandlers(card.id, canEdit);

    // Add checklist
    document.getElementById('add-checklist-btn').addEventListener('click', async () => {
      const name = prompt('Name der Checkliste:');
      if (!name) return;
      try {
        await apiFetch(`/api/cards/${card.id}/checklists`, {
          method: 'POST',
          body: JSON.stringify({ title: name }),
        });
        const updated = await apiFetch(`/api/cards/${card.id}`);
        document.getElementById('checklists-container').innerHTML = renderChecklists(updated.checklists || [], canEdit, card.id);
        setupChecklistHandlers(card.id, canEdit);
        if (typeof refreshBoard === 'function') refreshBoard();
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });

    // Files
    setupFileHandlers(card.id);
  }

  // Comments
  if (currentUser) setupCommentHandlers(card.id);
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

async function loadMetaSelects(card) {
  try {
    const customers = await apiFetch('/api/customers');

    const custSel = document.getElementById('card-customer-select');
    if (custSel) {
      customers.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name + (c.company ? ' – ' + c.company : '');
        if (c.id === card.customer_id) opt.selected = true;
        custSel.appendChild(opt);
      });
    }
  } catch (e) {}
}

function renderChecklists(checklists, canEdit, cardId) {
  if (!checklists || checklists.length === 0) return '<p style="color:var(--text-muted);font-size:13px">Keine Checklisten</p>';

  return checklists.map(cl => {
    const total = (cl.items || []).length;
    const done = (cl.items || []).filter(i => i.completed).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    return `
      <div class="checklist" data-checklist-id="${cl.id}">
        <div class="checklist-header">
          <span class="checklist-title">${escapeHtml(cl.title)}</span>
          <div style="display:flex;gap:4px">
            ${canEdit ? `<button class="btn btn-sm btn-secondary delete-checklist-btn" data-checklist-id="${cl.id}">Löschen</button>` : ''}
          </div>
        </div>
        ${total > 0 ? `<div class="checklist-progress">
          <div class="checklist-progress-bar"><div class="checklist-progress-fill" style="width:${pct}%"></div></div>
          <div class="checklist-progress-text">${done}/${total} (${pct}%)</div>
        </div>` : ''}
        <div class="checklist-items-list" id="checklist-items-${cl.id}">
          ${(cl.items || []).map(item => `
            <div class="checklist-item ${item.completed ? 'completed' : ''}" data-item-id="${item.id}">
              <input type="checkbox" ${item.completed ? 'checked' : ''} id="item-${item.id}" ${canEdit ? '' : 'disabled'}>
              <label for="item-${item.id}">${escapeHtml(item.text)}</label>
              ${item.completed && item.completed_by_name ? `<span style="font-size:11px;color:var(--text-muted)">${escapeHtml(item.completed_by_name)}</span>` : ''}
              ${canEdit ? `<button class="btn-link delete-item-btn" data-item-id="${item.id}" data-checklist-id="${cl.id}" style="margin-left:auto;color:var(--text-muted)">&times;</button>` : ''}
            </div>
          `).join('')}
        </div>
        ${canEdit ? `
        <div class="add-item-input">
          <input type="text" class="add-item-text" data-checklist-id="${cl.id}" placeholder="Neuen Punkt hinzufügen...">
          <button class="btn btn-sm btn-primary add-item-btn" data-checklist-id="${cl.id}">+</button>
        </div>` : ''}
      </div>`;
  }).join('');
}

function setupChecklistHandlers(cardId, canEdit) {
  if (!canEdit) return;

  // Checkbox changes
  document.querySelectorAll('.checklist-item input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const item = cb.closest('.checklist-item');
      const itemId = item.dataset.itemId;
      const checklist = cb.closest('.checklist');
      const checklistId = checklist.dataset.checklistId;
      try {
        await apiFetch(`/api/cards/${cardId}/checklists/${checklistId}/items/${itemId}`, {
          method: 'PUT',
          body: JSON.stringify({ completed: cb.checked }),
        });
        item.classList.toggle('completed', cb.checked);
        refreshBoard();
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); cb.checked = !cb.checked; }
    });
  });

  // Delete items
  document.querySelectorAll('.delete-item-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const itemId = btn.dataset.itemId;
      const checklistId = btn.dataset.checklistId;
      try {
        await apiFetch(`/api/cards/${cardId}/checklists/${checklistId}/items/${itemId}`, { method: 'DELETE' });
        btn.closest('.checklist-item').remove();
        if (typeof refreshBoard === 'function') refreshBoard();
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });

  // Delete checklists
  document.querySelectorAll('.delete-checklist-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const checklistId = btn.dataset.checklistId;
      if (!await showConfirm('Checkliste löschen', 'Checkliste und alle Einträge löschen?')) return;
      try {
        await apiFetch(`/api/cards/${cardId}/checklists/${checklistId}`, { method: 'DELETE' });
        btn.closest('.checklist').remove();
        if (typeof refreshBoard === 'function') refreshBoard();
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });

  // Add items
  document.querySelectorAll('.add-item-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const checklistId = btn.dataset.checklistId;
      const input = document.querySelector(`.add-item-text[data-checklist-id="${checklistId}"]`);
      const text = input.value.trim();
      if (!text) return;
      try {
        const item = await apiFetch(`/api/cards/${cardId}/checklists/${checklistId}/items`, {
          method: 'POST',
          body: JSON.stringify({ text }),
        });
        const itemsContainer = document.getElementById(`checklist-items-${checklistId}`);
        const div = document.createElement('div');
        div.className = 'checklist-item';
        div.dataset.itemId = item.id;
        div.innerHTML = `
          <input type="checkbox" id="item-${item.id}">
          <label for="item-${item.id}">${escapeHtml(item.text)}</label>
          <button class="btn-link delete-item-btn" data-item-id="${item.id}" data-checklist-id="${checklistId}" style="margin-left:auto;color:var(--text-muted)">&times;</button>
        `;
        itemsContainer.appendChild(div);
        input.value = '';
        if (typeof refreshBoard === 'function') refreshBoard();

        // Add event listeners to new elements
        div.querySelector('input[type="checkbox"]').addEventListener('change', async (e) => {
          try {
            await apiFetch(`/api/cards/${cardId}/checklists/${checklistId}/items/${item.id}`, {
              method: 'PUT',
              body: JSON.stringify({ completed: e.target.checked }),
            });
            div.classList.toggle('completed', e.target.checked);
            if (typeof refreshBoard === 'function') refreshBoard();
          } catch (err) {}
        });
        div.querySelector('.delete-item-btn').addEventListener('click', async () => {
          try {
            await apiFetch(`/api/cards/${cardId}/checklists/${checklistId}/items/${item.id}`, { method: 'DELETE' });
            div.remove();
            if (typeof refreshBoard === 'function') refreshBoard();
          } catch (err) {}
        });
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });

  // Enter to add item
  document.querySelectorAll('.add-item-text').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const checklistId = input.dataset.checklistId;
        document.querySelector(`.add-item-btn[data-checklist-id="${checklistId}"]`).click();
      }
    });
  });
}

function renderComments(comments) {
  if (!comments || comments.length === 0) return '<p style="color:var(--text-muted);font-size:13px">Keine Kommentare</p>';

  return comments.map(c => `
    <div class="comment" data-comment-id="${c.id}">
      <div class="comment-avatar">${(c.username || '?')[0].toUpperCase()}</div>
      <div class="comment-body">
        <div class="comment-header">
          <span class="comment-author">${escapeHtml(c.username || 'Unbekannt')}</span>
          <span class="comment-time">${formatDate(c.created_at)}</span>
          ${currentUser && (c.user_id === currentUser.id || currentUser.role === 'admin') ?
            `<button class="btn-link delete-comment-btn" data-comment-id="${c.id}" style="margin-left:auto;color:var(--text-muted)">Löschen</button>` : ''}
        </div>
        <div class="comment-text">${escapeHtml(c.content).replace(/\n/g, '<br>').replace(/@(\w+)/g, '<strong>@$1</strong>')}</div>
      </div>
    </div>
  `).join('');
}

function setupCommentHandlers(cardId) {
  const submitBtn = document.getElementById('submit-comment-btn');
  const input = document.getElementById('new-comment-input');
  if (!submitBtn || !input) return;

  // @mention autocomplete
  input.addEventListener('input', (e) => {
    const text = e.target.value;
    const match = text.match(/@(\w*)$/);
    const autocomplete = document.getElementById('mention-autocomplete');

    if (match) {
      const search = match[1].toLowerCase();
      const matches = allUsers.filter(u => u.username.toLowerCase().startsWith(search));
      if (matches.length > 0) {
        autocomplete.innerHTML = matches.slice(0, 5).map(u =>
          `<div class="mention-item" data-username="${escapeHtml(u.username)}">@${escapeHtml(u.username)}</div>`
        ).join('');
        autocomplete.classList.remove('hidden');
        autocomplete.querySelectorAll('.mention-item').forEach(item => {
          item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const username = item.dataset.username;
            const before = text.slice(0, text.lastIndexOf('@'));
            input.value = before + '@' + username + ' ';
            autocomplete.classList.add('hidden');
          });
        });
      } else {
        autocomplete.classList.add('hidden');
      }
    } else {
      autocomplete.classList.add('hidden');
    }
  });

  submitBtn.addEventListener('click', async () => {
    const content = input.value.trim();
    if (!content) return;
    try {
      const comment = await apiFetch(`/api/cards/${cardId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      input.value = '';
      const list = document.getElementById('comments-list');
      list.innerHTML += `
        <div class="comment" data-comment-id="${comment.id}">
          <div class="comment-avatar">${(comment.username || '?')[0].toUpperCase()}</div>
          <div class="comment-body">
            <div class="comment-header">
              <span class="comment-author">${escapeHtml(comment.username || 'Unbekannt')}</span>
              <span class="comment-time">${formatDate(comment.created_at)}</span>
              <button class="btn-link delete-comment-btn" data-comment-id="${comment.id}" style="margin-left:auto;color:var(--text-muted)">Löschen</button>
            </div>
            <div class="comment-text">${escapeHtml(comment.content).replace(/\n/g, '<br>').replace(/@(\w+)/g, '<strong>@$1</strong>')}</div>
          </div>
        </div>`;
    } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      submitBtn.click();
    }
  });

  // Delete comment handlers
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.delete-comment-btn');
    if (!btn) return;
    const commentId = btn.dataset.commentId;
    if (!commentId || !currentCardId) return;
    try {
      await apiFetch(`/api/cards/${currentCardId}/comments/${commentId}`, { method: 'DELETE' });
      btn.closest('.comment').remove();
    } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
  });
}

function renderFiles(files, cardId) {
  if (!files || files.length === 0) return '<p style="color:var(--text-muted);font-size:13px">Keine Dateien</p>';

  return files.map(f => {
    const isImage = f.mime_type && f.mime_type.startsWith('image/');
    const icon = isImage ? '🖼️' : '📄';
    return `
      <div class="file-item" data-file-id="${f.id}">
        <div class="file-icon">${icon}</div>
        <div class="file-info">
          <a href="/api/cards/${cardId}/files/${f.id}" target="_blank" class="file-name" title="${escapeHtml(f.original_name)}">${escapeHtml(f.original_name)}</a>
          <div class="file-size">${formatFileSize(f.size)} — ${formatDate(f.created_at)}</div>
        </div>
        ${currentUser && (currentUser.role === 'admin' || currentUser.role === 'employee') ?
          `<button class="btn btn-sm btn-danger delete-file-btn" data-file-id="${f.id}">×</button>` : ''}
      </div>`;
  }).join('');
}

function setupFileHandlers(cardId) {
  const dropZone = document.getElementById('file-drop-zone');
  const fileInput = document.getElementById('file-input');
  if (!dropZone || !fileInput) return;

  const uploadFiles = async (files) => {
    const formData = new FormData();
    for (const f of files) formData.append('files', f);
    try {
      const res = await fetch(`/api/cards/${cardId}/files`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }
      showToast('Dateien hochgeladen', 'success');
      const updatedCard = await apiFetch(`/api/cards/${cardId}`);
      document.getElementById('files-list').innerHTML = renderFiles(updatedCard.files || [], cardId);
      setupDeleteFileHandlers(cardId);
    } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
  };

  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    uploadFiles(Array.from(e.dataTransfer.files));
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) uploadFiles(Array.from(fileInput.files));
  });

  dropZone.addEventListener('click', (e) => {
    if (e.target.tagName !== 'LABEL') fileInput.click();
  });

  setupDeleteFileHandlers(cardId);
}

function setupDeleteFileHandlers(cardId) {
  document.querySelectorAll('.delete-file-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const fileId = btn.dataset.fileId;
      if (!await showConfirm('Datei löschen', 'Datei wirklich löschen?')) return;
      try {
        await apiFetch(`/api/cards/${cardId}/files/${fileId}`, { method: 'DELETE' });
        btn.closest('.file-item').remove();
        showToast('Datei gelöscht', 'success');
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });
}

function renderHistory(history) {
  if (!history || history.length === 0) return '<p style="color:var(--text-muted);font-size:13px">Kein Verlauf</p>';

  const actionLabels = {
    created: 'Erstellt',
    moved: 'Verschoben',
    field_updated: 'Felder aktualisiert',
    comment: 'Kommentar hinzugefügt',
    file_uploaded: 'Datei hochgeladen',
    checklist_checked: 'Checkliste aktualisiert',
    label_changed: 'Label geändert',
    archived: 'Archiviert',
    restored: 'Wiederhergestellt',
    escalation_sent: 'Eskalation gesendet',
    column_escalation_sent: 'Spalten-Eskalation gesendet',
  };

  return [...history].reverse().map(h => {
    let details = '';
    if (h.details) {
      try {
        const d = JSON.parse(h.details);
        if (h.action_type === 'moved' && d.from_column_id) {
          details = ` (von Spalte ${d.from_column_id} nach ${d.to_column_id})`;
        }
      } catch (e) {}
    }
    return `
      <div class="history-item">
        <div class="history-dot"></div>
        <div class="history-content">
          <span class="history-user">${escapeHtml(h.username || 'System')}</span>
          <span> ${actionLabels[h.action_type] || h.action_type}${details}</span>
          <div class="history-time">${formatDate(h.created_at)}</div>
        </div>
      </div>`;
  }).join('');
}

async function handleArchive(card) {
  if (card.archived) {
    if (!await showConfirm('Wiederherstellen', 'Karte aus dem Archiv wiederherstellen?')) return;
    try {
      await apiFetch(`/api/cards/${card.id}/restore`, { method: 'POST' });
      showToast('Karte wiederhergestellt', 'success');
      closeCardModal();
      refreshBoard();
    } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
  } else {
    if (!await showConfirm('Archivieren', 'Karte archivieren?')) return;
    try {
      await apiFetch(`/api/cards/${card.id}/archive`, { method: 'POST' });
      showToast('Karte archiviert', 'success');
      closeCardModal();
      refreshBoard();
    } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
  }
}

async function showMoveCardModal(card) {
  const groups = await apiFetch('/api/groups');
  const modal = document.getElementById('move-modal');
  const body = document.getElementById('move-modal-body');

  const currentGroupOrder = card.group_order;

  let colOptions = '';
  for (const g of groups) {
    if (g.order_index < currentGroupOrder) continue; // Skip past groups
    if (!g.columns || g.columns.length === 0) continue;

    for (const col of g.columns) {
      const selected = col.id === card.column_id ? 'selected' : '';
      colOptions += `<option value="${col.id}" data-group-id="${g.id}" data-group-order="${g.order_index}" ${selected}>${escapeHtml(g.name)} / ${escapeHtml(col.name)}</option>`;
    }
  }

  body.innerHTML = `
    <div class="modal-body">
      <div class="form-group">
        <label>Ziel-Spalte</label>
        <select id="move-target-column">${colOptions}</select>
      </div>
      <div id="transition-fields-container"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="move-cancel-btn2">Abbrechen</button>
      <button class="btn btn-primary" id="move-confirm-btn2">Verschieben</button>
    </div>
  `;

  modal.classList.remove('hidden');
  document.getElementById('move-modal-close').onclick = () => modal.classList.add('hidden');
  document.getElementById('move-modal-backdrop').onclick = () => modal.classList.add('hidden');
  document.getElementById('move-cancel-btn2').onclick = () => modal.classList.add('hidden');

  const colSelect = document.getElementById('move-target-column');

  async function updateTransitionFields() {
    const selectedOpt = colSelect.options[colSelect.selectedIndex];
    const targetGroupId = selectedOpt?.dataset.groupId;
    const container = document.getElementById('transition-fields-container');

    if (!targetGroupId || targetGroupId === String(card.group_id)) {
      container.innerHTML = '';
      return;
    }

    try {
      const fields = await apiFetch(`/api/transitions/group/${targetGroupId}`);
      if (fields && fields.length > 0) {
        container.innerHTML = fields.map(field => `
          <div class="transition-field">
            <label class="${field.required ? 'required' : ''}">${escapeHtml(field.field_name)}</label>
            ${renderTransitionInput(field)}
          </div>
        `).join('');
      } else {
        container.innerHTML = '';
      }
    } catch (e) { container.innerHTML = ''; }
  }

  colSelect.addEventListener('change', updateTransitionFields);
  await updateTransitionFields();

  document.getElementById('move-confirm-btn2').addEventListener('click', async () => {
    const selectedOpt = colSelect.options[colSelect.selectedIndex];
    const targetColumnId = colSelect.value;
    const targetGroupId = selectedOpt?.dataset.groupId;
    const targetGroupOrder = parseInt(selectedOpt?.dataset.groupOrder);

    if (targetGroupOrder < currentGroupOrder) {
      showToast('Karten können nicht rückwärts verschoben werden', 'error');
      return;
    }

    // Collect transition values
    const transitionValues = [];
    const fields = document.querySelectorAll('#transition-fields-container .transition-field');
    let valid = true;

    for (const fieldEl of fields) {
      const input = fieldEl.querySelector('input, select, textarea');
      if (!input) continue;
      const fieldId = input.dataset.fieldId;
      const value = input.value.trim();
      const isRequired = fieldEl.querySelector('label.required') !== null;
      if (isRequired && !value) {
        input.style.borderColor = 'var(--danger)';
        valid = false;
        continue;
      }
      transitionValues.push({ field_id: parseInt(fieldId), value });
    }

    if (!valid) {
      showToast('Bitte alle Pflichtfelder ausfüllen', 'error');
      return;
    }

    try {
      await apiFetch(`/api/cards/${card.id}/move`, {
        method: 'POST',
        body: JSON.stringify({ column_id: parseInt(targetColumnId), transition_values: transitionValues }),
      });
      modal.classList.add('hidden');
      showToast('Karte verschoben', 'success');
      const updated = await apiFetch(`/api/cards/${card.id}`);
      renderCardModal(updated);
      refreshBoard();
    } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
  });
}

function renderTransitionInput(field) {
  const attrs = `data-field-id="${field.id}" ${field.required ? 'required' : ''}`;

  if (field.field_type === 'select' && Array.isArray(field.field_options)) {
    return `<select ${attrs}>
      <option value="">Bitte wählen...</option>
      ${field.field_options.map(opt => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join('')}
    </select>`;
  } else if (field.field_type === 'date') {
    return `<input type="date" ${attrs}>`;
  } else if (field.field_type === 'textarea') {
    return `<textarea ${attrs}></textarea>`;
  } else {
    return `<input type="text" ${attrs}>`;
  }
}

async function setupLabelHandlers(cardId, currentLabels) {
  // Remove label
  document.querySelectorAll('.remove-label').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const chip = btn.closest('.label-chip');
      const labelId = chip.dataset.labelId;
      try {
        await apiFetch(`/api/cards/${cardId}/labels/${labelId}`, { method: 'DELETE' });
        chip.remove();
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });

  // Add label
  const addBtn = document.getElementById('add-label-btn');
  if (!addBtn) return;

  addBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const labels = await apiFetch('/api/labels');
      const existingIds = Array.from(document.querySelectorAll('.label-chip')).map(c => parseInt(c.dataset.labelId));
      const available = labels.filter(l => !existingIds.includes(l.id));

      if (available.length === 0) {
        showToast('Alle Labels bereits hinzugefügt', 'info');
        return;
      }

      const picker = document.createElement('div');
      picker.style.cssText = 'position:absolute;background:white;border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-lg);z-index:100;padding:8px;min-width:160px';
      picker.innerHTML = available.map(l =>
        `<div style="padding:6px 10px;cursor:pointer;display:flex;align-items:center;gap:8px" data-label-id="${l.id}">
          <span style="width:12px;height:12px;border-radius:50%;background:${escapeHtml(l.color)};flex-shrink:0"></span>
          ${escapeHtml(l.name)}
        </div>`
      ).join('');

      addBtn.style.position = 'relative';
      addBtn.appendChild(picker);

      picker.querySelectorAll('[data-label-id]').forEach(item => {
        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          const labelId = item.dataset.labelId;
          const label = available.find(l => l.id === parseInt(labelId));
          try {
            await apiFetch(`/api/cards/${cardId}/labels`, {
              method: 'POST',
              body: JSON.stringify({ label_id: parseInt(labelId) }),
            });
            const list = document.getElementById('card-labels-list');
            const chip = document.createElement('span');
            chip.className = 'label-chip';
            chip.style.background = label.color;
            chip.dataset.labelId = label.id;
            chip.innerHTML = `${escapeHtml(label.name)} <button class="remove-label">&times;</button>`;
            chip.querySelector('.remove-label').addEventListener('click', async (ev) => {
              ev.stopPropagation();
              await apiFetch(`/api/cards/${cardId}/labels/${labelId}`, { method: 'DELETE' });
              chip.remove();
            });
            list.insertBefore(chip, addBtn);
            picker.remove();
          } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
        });
      });

      const closeHandler = (e) => {
        if (!picker.contains(e.target) && e.target !== addBtn) {
          picker.remove();
          document.removeEventListener('click', closeHandler);
        }
      };
      document.addEventListener('click', closeHandler);
    } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
  });
}

function refreshBoard() {
  if (document.getElementById('page-board') && !document.getElementById('page-board').classList.contains('hidden')) {
    if (typeof fetchAndRenderBoard === 'function') {
      fetchAndRenderBoard().catch(() => {});
    }
  }
}
