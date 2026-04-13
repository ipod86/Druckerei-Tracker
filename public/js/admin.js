'use strict';

let adminSection = 'board';

window.loadAdmin = function() {
  if (!currentUser || currentUser.role !== 'admin') {
    document.getElementById('page-admin').innerHTML = '<div class="empty-state">Kein Zugriff</div>';
    return;
  }

  const container = document.getElementById('page-admin');
  container.innerHTML = `
    <div class="admin-layout">
      <div class="admin-sidebar">
        <div class="admin-sidebar-section">Board</div>
        <div class="admin-sidebar-item" data-section="board">Gruppen & Spalten</div>
        <div class="admin-sidebar-item" data-section="transitions">Übergänge</div>

        <div class="admin-sidebar-section">E-Mail</div>
        <div class="admin-sidebar-item" data-section="smtp">SMTP Einstellungen</div>
        <div class="admin-sidebar-item" data-section="email-templates">E-Mail Vorlagen</div>
        <div class="admin-sidebar-item" data-section="email-rules">E-Mail Regeln</div>

        <div class="admin-sidebar-section">Verwaltung</div>
        <div class="admin-sidebar-item" data-section="users">Benutzer</div>
        <div class="admin-sidebar-item" data-section="labels">Labels</div>

        <div class="admin-sidebar-section">System</div>
        <div class="admin-sidebar-item" data-section="branding">CI / Branding</div>
        <div class="admin-sidebar-item" data-section="backup">Backup</div>
        <div class="admin-sidebar-item" data-section="archive-settings">Archiv-Einstellungen</div>
        <div class="admin-sidebar-item" data-section="sysinfo">Systeminformationen</div>
      </div>
      <div class="admin-content" id="admin-content">
        <div class="loading"><div class="spinner"></div></div>
      </div>
    </div>
  `;

  container.querySelectorAll('.admin-sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      container.querySelectorAll('.admin-sidebar-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      adminSection = item.dataset.section;
      loadAdminSection(adminSection);
    });
  });

  // Load default
  const defaultItem = container.querySelector('[data-section="board"]');
  if (defaultItem) defaultItem.click();
};

async function loadAdminSection(section) {
  const content = document.getElementById('admin-content');
  content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    switch (section) {
      case 'board': await loadBoardConfig(content); break;
      case 'transitions': await loadTransitions(content); break;
      case 'smtp': await loadSmtp(content); break;
      case 'email-templates': await loadEmailTemplates(content); break;
      case 'email-rules': await loadEmailRules(content); break;
      case 'users': await loadUsers(content); break;
      case 'locations': await loadLocations(content); break;
      case 'labels': await loadLabels(content); break;
      case 'customers': await loadAdminCustomers(content); break;
      case 'checklist-templates': await loadChecklistTemplates(content); break;
      case 'branding': await loadBranding(content); break;
      case 'backup': await loadBackup(content); break;
      case 'archive-settings': await loadArchiveSettings(content); break;
      case 'sysinfo': await loadSysinfo(content); break;
      default: content.innerHTML = '<div class="empty-state">Unbekannter Bereich</div>';
    }
  } catch (e) {
    content.innerHTML = `<div class="empty-state">Fehler: ${escapeHtml(e.message)}</div>`;
  }
}

// ===== Board Config =====
async function loadBoardConfig(content) {
  const groups = await apiFetch('/api/groups');

  content.innerHTML = `
    <div class="admin-section">
      <div class="admin-section-title">Gruppen & Spalten</div>
      <button class="btn btn-primary btn-sm" id="add-group-btn">+ Neue Gruppe</button>
      <div class="group-list" id="group-list" style="margin-top:16px">
        ${renderGroupList(groups)}
      </div>
    </div>
  `;

  document.getElementById('add-group-btn').addEventListener('click', () => showGroupForm(null, groups));
  setupGroupListHandlers(groups);
}

function renderGroupList(groups) {
  return groups.map(g => `
    <div class="group-item" data-group-id="${g.id}">
      <div class="group-item-header">
        <div class="group-color-dot" style="background:${escapeHtml(g.color)}"></div>
        <span class="group-name">${escapeHtml(g.name)}</span>
        <span style="font-size:12px;color:var(--text-muted)">Reihenfolge: ${g.order_index}</span>
        <div style="display:flex;gap:4px;margin-left:auto">
          <button class="btn btn-sm btn-secondary edit-group-btn" data-group-id="${g.id}">Bearbeiten</button>
          <button class="btn btn-sm btn-danger delete-group-btn" data-group-id="${g.id}">Löschen</button>
        </div>
      </div>
      <div class="group-columns-list">
        <div style="padding:6px 10px">
          <button class="btn btn-sm btn-secondary add-column-btn" data-group-id="${g.id}" data-group-name="${escapeHtml(g.name)}">+ Spalte hinzufügen</button>
        </div>
        ${(g.columns || []).map(col => `
          <div class="column-item">
            <span class="column-item-name">${escapeHtml(col.name)}</span>
            ${col.time_limit_days ? `<span class="tag" style="background:#fef9c3;color:#854d0e">${col.time_limit_days}T ${col.escalation_time || '12:00'} Limit</span>` : (col.time_limit_hours ? `<span class="tag" style="background:#fef9c3;color:#854d0e">${col.time_limit_hours}h Limit</span>` : '')}
            <div style="display:flex;gap:4px;margin-left:auto">
              <button class="btn btn-sm btn-secondary edit-column-btn" data-column-id="${col.id}">Bearbeiten</button>
              <button class="btn btn-sm btn-danger delete-column-btn" data-column-id="${col.id}">Löschen</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function setupGroupListHandlers(groups) {
  document.querySelectorAll('.edit-group-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = groups.find(g => g.id === parseInt(btn.dataset.groupId));
      showGroupForm(g, groups);
    });
  });

  document.querySelectorAll('.delete-group-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showConfirm('Gruppe löschen', 'Gruppe löschen? (Nur möglich wenn keine Spalten vorhanden)')) return;
      try {
        await apiFetch(`/api/groups/${btn.dataset.groupId}`, { method: 'DELETE' });
        showToast('Gruppe gelöscht', 'success');
        loadAdminSection('board');
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });

  document.querySelectorAll('.add-column-btn').forEach(btn => {
    btn.addEventListener('click', () => showColumnForm(null, btn.dataset.groupId, btn.dataset.groupName));
  });

  document.querySelectorAll('.edit-column-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const columns = await apiFetch('/api/columns');
        const col = columns.find(c => c.id === parseInt(btn.dataset.columnId));
        if (col) showColumnForm(col, col.group_id, col.group_name);
      } catch (e) {}
    });
  });

  document.querySelectorAll('.delete-column-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showConfirm('Spalte löschen', 'Spalte löschen? (Nur möglich wenn keine aktiven Karten)')) return;
      try {
        await apiFetch(`/api/columns/${btn.dataset.columnId}`, { method: 'DELETE' });
        showToast('Spalte gelöscht', 'success');
        loadAdminSection('board');
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });
}

function showGroupForm(group, allGroups) {
  showFormModal('Gruppe ' + (group ? 'bearbeiten' : 'erstellen'), `
    <div class="form-group">
      <label class="required">Name</label>
      <input type="text" id="f-group-name" value="${escapeHtml(group?.name || '')}" required>
    </div>
    <div class="form-group">
      <label>Farbe</label>
      <div class="color-input-group">
        <input type="color" id="f-group-color-picker" value="${group?.color || '#4a90d9'}">
        <input type="text" id="f-group-color" value="${group?.color || '#4a90d9'}">
      </div>
    </div>
    <div class="form-group">
      <label>Reihenfolge</label>
      <input type="number" id="f-group-order" value="${group?.order_index || allGroups.length + 1}">
    </div>
    <div class="form-group">
      <label>Beschreibung</label>
      <textarea id="f-group-desc">${escapeHtml(group?.description || '')}</textarea>
    </div>
  `, async () => {
    const data = {
      name: document.getElementById('f-group-name').value,
      color: document.getElementById('f-group-color').value,
      order_index: parseInt(document.getElementById('f-group-order').value),
      description: document.getElementById('f-group-desc').value,
    };
    if (!data.name) { showToast('Name erforderlich', 'error'); return false; }

    if (group) {
      await apiFetch(`/api/groups/${group.id}`, { method: 'PUT', body: JSON.stringify(data) });
    } else {
      await apiFetch('/api/groups', { method: 'POST', body: JSON.stringify(data) });
    }
    loadAdminSection('board');
    return true;
  });

  // Sync color picker
  document.getElementById('f-group-color-picker').addEventListener('input', (e) => {
    document.getElementById('f-group-color').value = e.target.value;
  });
  document.getElementById('f-group-color').addEventListener('input', (e) => {
    document.getElementById('f-group-color-picker').value = e.target.value;
  });
}

function showColumnForm(col, groupId, groupName) {
  showFormModal('Spalte ' + (col ? 'bearbeiten' : 'erstellen'), `
    <p style="color:var(--secondary);font-size:13px;margin-bottom:12px">Gruppe: <strong>${escapeHtml(groupName || '')}</strong></p>
    <div class="form-group">
      <label class="required">Name</label>
      <input type="text" id="f-col-name" value="${escapeHtml(col?.name || '')}" required>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Zeitlimit (Tage)</label>
        <input type="number" id="f-col-limit-days" value="${col?.time_limit_days || ''}" placeholder="Kein Limit" min="1" step="1">
      </div>
      <div class="form-group">
        <label>Uhrzeit der Erinnerung</label>
        <input type="time" id="f-col-esc-time" value="${col?.escalation_time || '12:00'}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Erinnerungsintervall (Std.)</label>
        <input type="number" id="f-col-reminder" value="${col?.reminder_interval_hours || 24}">
      </div>
    </div>
    <div class="form-group">
      <label>Eskalations-E-Mails (kommagetrennt)</label>
      <input type="text" id="f-col-emails" value="${col?.escalation_emails ? JSON.parse(col.escalation_emails || '[]').join(', ') : ''}" placeholder="email@beispiel.de, ...">
    </div>
  `, async () => {
    const emailsRaw = document.getElementById('f-col-emails').value;
    const emails = emailsRaw ? emailsRaw.split(',').map(e => e.trim()).filter(Boolean) : [];
    const daysVal = document.getElementById('f-col-limit-days').value;
    const data = {
      name: document.getElementById('f-col-name').value,
      group_id: parseInt(groupId),
      time_limit_days: daysVal ? parseInt(daysVal) : null,
      escalation_time: document.getElementById('f-col-esc-time').value || '12:00',
      time_limit_hours: null,
      reminder_interval_hours: parseFloat(document.getElementById('f-col-reminder').value) || 24,
      escalation_emails: emails,
    };
    if (!data.name) { showToast('Name erforderlich', 'error'); return false; }

    if (col) {
      await apiFetch(`/api/columns/${col.id}`, { method: 'PUT', body: JSON.stringify(data) });
    } else {
      await apiFetch('/api/columns', { method: 'POST', body: JSON.stringify(data) });
    }
    loadAdminSection('board');
    return true;
  });
}

// ===== Transitions =====
async function loadTransitions(content) {
  const [groups, transitions] = await Promise.all([
    apiFetch('/api/groups'),
    apiFetch('/api/transitions'),
  ]);

  content.innerHTML = `
    <div class="admin-section">
      <div class="admin-section-title">Übergänge</div>
      <p style="font-size:13px;color:var(--secondary);margin-bottom:16px">
        Felder, die beim Verlassen einer Gruppe ausgefüllt werden müssen.
        Jeder Übergang hat einen Namen und eine optionale Quellgruppe (die verlassene Gruppe).
      </p>
      <button class="btn btn-primary btn-sm" id="add-transition-btn">+ Neuen Übergang</button>
      <div id="transitions-list" style="margin-top:16px">
        ${renderTransitionsList(transitions)}
      </div>
    </div>
  `;

  document.getElementById('add-transition-btn').addEventListener('click', () => showTransitionForm(null, groups));
  setupTransitionHandlers(transitions, groups);
}

function renderTransitionsList(transitions) {
  if (!transitions.length) {
    return '<p style="color:var(--text-muted);font-size:13px">Keine Übergänge definiert.</p>';
  }

  return transitions.map(t => `
    <div class="transition-container" data-id="${t.id}">
      <div class="transition-container-header">
        <div style="flex:1;min-width:0">
          <strong>${escapeHtml(t.name)}</strong>
          <span class="transition-container-route">
            Beim Verlassen von ${escapeHtml(t.from_group_name)}
          </span>
        </div>
        <button class="btn btn-sm btn-secondary edit-transition-btn" data-id="${t.id}">Bearbeiten</button>
        <button class="btn btn-sm btn-danger delete-transition-btn" data-id="${t.id}">Löschen</button>
      </div>
      <div class="transition-container-body">
        ${t.fields.length === 0
          ? '<p style="font-size:12px;color:var(--text-muted);margin:0">Keine Felder — bitte Felder hinzufügen.</p>'
          : `<table style="margin-bottom:10px"><thead><tr><th>Feldname</th><th>Typ</th><th>Pflicht</th><th>Aktionen</th></tr></thead><tbody>
            ${t.fields.map(f => `
              <tr>
                <td>${escapeHtml(f.field_name)}</td>
                <td>${escapeHtml(f.field_type)}</td>
                <td>${f.required ? '✓' : '—'}</td>
                <td>
                  <button class="btn btn-sm btn-secondary edit-field-btn" data-transition-id="${t.id}" data-field-id="${f.id}">Bearbeiten</button>
                  <button class="btn btn-sm btn-danger delete-field-btn" data-field-id="${f.id}" style="margin-left:4px">Löschen</button>
                </td>
              </tr>
            `).join('')}
          </tbody></table>`
        }
        <button class="btn btn-sm btn-secondary add-field-btn" data-transition-id="${t.id}">+ Feld hinzufügen</button>
      </div>
    </div>
  `).join('');
}

function setupTransitionHandlers(transitions, groups) {
  document.querySelectorAll('.edit-transition-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = transitions.find(x => x.id === parseInt(btn.dataset.id));
      if (t) showTransitionForm(t, groups);
    });
  });

  document.querySelectorAll('.delete-transition-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showConfirm('Übergang löschen', 'Übergang und alle zugehörigen Felder löschen?')) return;
      try {
        await apiFetch(`/api/transitions/${btn.dataset.id}`, { method: 'DELETE' });
        showToast('Übergang gelöscht', 'success');
        loadAdminSection('transitions');
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });

  document.querySelectorAll('.add-field-btn').forEach(btn => {
    btn.addEventListener('click', () => showFieldForm(null, parseInt(btn.dataset.transitionId)));
  });

  document.querySelectorAll('.edit-field-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = transitions.find(x => x.id === parseInt(btn.dataset.transitionId));
      const field = t?.fields.find(f => f.id === parseInt(btn.dataset.fieldId));
      if (field) showFieldForm(field, parseInt(btn.dataset.transitionId));
    });
  });

  document.querySelectorAll('.delete-field-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showConfirm('Feld löschen', 'Übergangsfeld löschen?')) return;
      try {
        await apiFetch(`/api/transitions/fields/${btn.dataset.fieldId}`, { method: 'DELETE' });
        showToast('Feld gelöscht', 'success');
        loadAdminSection('transitions');
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });
}

function showTransitionForm(transition, groups) {
  showFormModal('Übergang ' + (transition ? 'bearbeiten' : 'erstellen'), `
    <div class="form-group">
      <label class="required">Name des Übergangs</label>
      <input type="text" id="f-t-name" value="${escapeHtml(transition?.name || '')}" placeholder="z.B. Druckvorgabe">
    </div>
    <div class="form-group">
      <label class="required">Beim Verlassen von</label>
      <select id="f-t-fromgroup">
        <option value="">— Gruppe wählen —</option>
        ${groups.map(g => `<option value="${g.id}" ${transition?.from_group_id == g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
      </select>
    </div>
  `, async () => {
    const data = {
      name: document.getElementById('f-t-name').value.trim(),
      from_group_id: document.getElementById('f-t-fromgroup').value || null,
    };
    if (!data.name) { showToast('Name erforderlich', 'error'); return false; }
    if (!data.from_group_id) { showToast('Quellgruppe erforderlich', 'error'); return false; }

    if (transition) {
      await apiFetch(`/api/transitions/${transition.id}`, { method: 'PUT', body: JSON.stringify(data) });
    } else {
      await apiFetch('/api/transitions', { method: 'POST', body: JSON.stringify(data) });
    }
    loadAdminSection('transitions');
    return true;
  });
}

function showFieldForm(field, transitionId) {
  const optionsValue = Array.isArray(field?.field_options) ? field.field_options.join('\n') : '';
  showFormModal('Feld ' + (field ? 'bearbeiten' : 'hinzufügen'), `
    <div class="form-group">
      <label class="required">Feldname</label>
      <input type="text" id="f-tf-name" value="${escapeHtml(field?.field_name || '')}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Feldtyp</label>
        <select id="f-tf-type">
          <option value="text" ${field?.field_type === 'text' ? 'selected' : ''}>Text</option>
          <option value="textarea" ${field?.field_type === 'textarea' ? 'selected' : ''}>Textfeld</option>
          <option value="date" ${field?.field_type === 'date' ? 'selected' : ''}>Datum</option>
          <option value="select" ${field?.field_type === 'select' ? 'selected' : ''}>Auswahl</option>
        </select>
      </div>
      <div class="form-group">
        <label>Pflichtfeld</label>
        <select id="f-tf-required">
          <option value="0" ${!field?.required ? 'selected' : ''}>Nein</option>
          <option value="1" ${field?.required ? 'selected' : ''}>Ja</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Optionen <span style="font-weight:400;color:var(--secondary)">(eine pro Zeile, für Auswahl-Typ)</span></label>
      <textarea id="f-tf-options" placeholder="Option 1&#10;Option 2&#10;Option 3">${escapeHtml(optionsValue)}</textarea>
    </div>
  `, async () => {
    const optionsRaw = document.getElementById('f-tf-options').value;
    const options = optionsRaw.split('\n').map(o => o.trim()).filter(Boolean);
    const data = {
      field_name: document.getElementById('f-tf-name').value.trim(),
      field_type: document.getElementById('f-tf-type').value,
      required: parseInt(document.getElementById('f-tf-required').value),
      field_options: options,
    };
    if (!data.field_name) { showToast('Feldname erforderlich', 'error'); return false; }

    if (field) {
      await apiFetch(`/api/transitions/fields/${field.id}`, { method: 'PUT', body: JSON.stringify(data) });
    } else {
      await apiFetch(`/api/transitions/${transitionId}/fields`, { method: 'POST', body: JSON.stringify(data) });
    }
    loadAdminSection('transitions');
    return true;
  });
}

// ===== SMTP =====
async function loadSmtp(content) {
  const settings = await apiFetch('/api/admin/settings');
  content.innerHTML = `
    <div class="admin-section">
      <div class="admin-section-title">SMTP E-Mail Konfiguration</div>
      <div class="form-row">
        <div class="form-group">
          <label>SMTP Host</label>
          <input type="text" id="smtp-host" value="${escapeHtml(settings.smtp_host || '')}" placeholder="smtp.gmail.com">
        </div>
        <div class="form-group">
          <label>Port</label>
          <input type="number" id="smtp-port" value="${settings.smtp_port || '587'}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Benutzername</label>
          <input type="text" id="smtp-user" value="${escapeHtml(settings.smtp_user || '')}">
        </div>
        <div class="form-group">
          <label>Passwort</label>
          <input type="password" id="smtp-pass" value="${escapeHtml(settings.smtp_pass || '')}">
        </div>
      </div>
      <div class="form-group">
        <label>Absender (From)</label>
        <input type="email" id="smtp-from" value="${escapeHtml(settings.smtp_from || '')}" placeholder="noreply@druckerei.de">
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary" id="save-smtp-btn">Speichern</button>
        <button class="btn btn-secondary" id="test-smtp-btn">Test-E-Mail senden</button>
      </div>
      <div id="smtp-result" style="margin-top:12px"></div>
    </div>
  `;

  document.getElementById('save-smtp-btn').addEventListener('click', async () => {
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          smtp_host: document.getElementById('smtp-host').value,
          smtp_port: document.getElementById('smtp-port').value,
          smtp_user: document.getElementById('smtp-user').value,
          smtp_pass: document.getElementById('smtp-pass').value,
          smtp_from: document.getElementById('smtp-from').value,
        }),
      });
      showToast('SMTP Einstellungen gespeichert', 'success');
    } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
  });

  document.getElementById('test-smtp-btn').addEventListener('click', async () => {
    const to = prompt('Test-E-Mail senden an:');
    if (!to) return;
    const result = document.getElementById('smtp-result');
    result.textContent = 'Sende...';
    try {
      await apiFetch('/api/admin/email/test', { method: 'POST', body: JSON.stringify({ to }) });
      result.innerHTML = '<span style="color:var(--success)">Test-E-Mail erfolgreich gesendet!</span>';
    } catch (e) {
      result.innerHTML = `<span style="color:var(--danger)">Fehler: ${escapeHtml(e.message)}</span>`;
    }
  });
}

// ===== Email Templates =====
async function loadEmailTemplates(content) {
  const templates = await apiFetch('/api/email-rules/templates');
  content.innerHTML = `
    <div class="admin-section">
      <div class="admin-section-title">E-Mail Vorlagen</div>
      <button class="btn btn-primary btn-sm" id="add-email-tpl-btn">+ Neue Vorlage</button>
      <table style="margin-top:16px">
        <thead><tr><th>Name</th><th>Betreff</th><th>Erstellt</th><th>Aktionen</th></tr></thead>
        <tbody>
          ${templates.map(t => `
            <tr>
              <td>${escapeHtml(t.name)}</td>
              <td>${escapeHtml(t.subject)}</td>
              <td>${formatDate(t.created_at)}</td>
              <td>
                <button class="btn btn-sm btn-secondary edit-tpl-btn" data-tpl-id="${t.id}">Bearbeiten</button>
                <button class="btn btn-sm btn-danger delete-tpl-btn" data-tpl-id="${t.id}" style="margin-left:4px">Löschen</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="margin-top:12px;padding:10px;background:var(--bg);border-radius:var(--radius);font-size:12px;color:var(--text-muted)">
        <strong style="color:var(--text)">Verfügbare Platzhalter:</strong><br>
        <code>{{card_title}}</code> – Kartenname &nbsp;|&nbsp;
        <code>{{order_number}}</code> – Auftragsnummer &nbsp;|&nbsp;
        <code>{{column_name}}</code> – Spaltenname &nbsp;|&nbsp;
        <code>{{group_name}}</code> – Gruppenname &nbsp;|&nbsp;
        <code>{{customer_name}}</code> – Kundenname &nbsp;|&nbsp;
        <code>{{company_name}}</code> – Firmenname &nbsp;|&nbsp;
        <code>{{customer_email}}</code> – Kunden-E-Mail &nbsp;|&nbsp;
        <code>{{due_date}}</code> – Fälligkeitsdatum &nbsp;|&nbsp;
        <code>{{app_name}}</code> – Name der Anwendung
      </div>
    </div>
  `;

  document.getElementById('add-email-tpl-btn').addEventListener('click', () => showEmailTemplateForm(null));

  content.querySelectorAll('.edit-tpl-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const t = templates.find(t => t.id === parseInt(btn.dataset.tplId));
      showEmailTemplateForm(t);
    });
  });

  content.querySelectorAll('.delete-tpl-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showConfirm('Vorlage löschen', 'E-Mail Vorlage löschen?')) return;
      try {
        await apiFetch(`/api/email-rules/templates/${btn.dataset.tplId}`, { method: 'DELETE' });
        showToast('Vorlage gelöscht', 'success');
        loadAdminSection('email-templates');
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });
}

function showEmailTemplateForm(tpl) {
  showFormModal('E-Mail Vorlage ' + (tpl ? 'bearbeiten' : 'erstellen'), `
    <div class="form-group">
      <label class="required">Name</label>
      <input type="text" id="f-tpl-name" value="${escapeHtml(tpl?.name || '')}">
    </div>
    <div class="form-group">
      <label class="required">Betreff</label>
      <input type="text" id="f-tpl-subject" value="${escapeHtml(tpl?.subject || '')}">
    </div>
    <div class="form-group">
      <label class="required">HTML Inhalt</label>
      <textarea id="f-tpl-html" style="min-height:200px;font-family:monospace">${escapeHtml(tpl?.html_content || '<p>Hallo,</p>\n<p>die Karte <strong>{{card_title}}</strong> wurde aktualisiert.</p>')}</textarea>
    </div>
  `, async () => {
    const data = {
      name: document.getElementById('f-tpl-name').value,
      subject: document.getElementById('f-tpl-subject').value,
      html_content: document.getElementById('f-tpl-html').value,
    };
    if (!data.name || !data.subject || !data.html_content) { showToast('Alle Felder erforderlich', 'error'); return false; }

    if (tpl) {
      await apiFetch(`/api/email-rules/templates/${tpl.id}`, { method: 'PUT', body: JSON.stringify(data) });
    } else {
      await apiFetch('/api/email-rules/templates', { method: 'POST', body: JSON.stringify(data) });
    }
    loadAdminSection('email-templates');
    return true;
  });
}

// ===== Email Rules =====
async function loadEmailRules(content) {
  const [rules, groups, templates] = await Promise.all([
    apiFetch('/api/email-rules'),
    apiFetch('/api/groups'),
    apiFetch('/api/email-rules/templates'),
  ]);

  content.innerHTML = `
    <div class="admin-section">
      <div class="admin-section-title">E-Mail Regeln</div>
      <button class="btn btn-primary btn-sm" id="add-rule-btn">+ Neue Regel</button>
      <table style="margin-top:16px">
        <thead><tr><th>Name</th><th>Von Gruppe</th><th>Nach Gruppe</th><th>Empfänger</th><th>Aktiv</th><th>Aktionen</th></tr></thead>
        <tbody>
          ${rules.map(r => `
            <tr>
              <td>${escapeHtml(r.name)}</td>
              <td>${escapeHtml(r.from_group_name || 'Beliebig')}</td>
              <td>${escapeHtml(r.to_group_name || 'Beliebig')}</td>
              <td>${Array.isArray(r.recipients) ? r.recipients.slice(0,2).join(', ') + (r.recipients.length > 2 ? '...' : '') : '—'}</td>
              <td>${r.active ? '<span style="color:var(--success)">✓</span>' : '<span style="color:var(--danger)">✗</span>'}</td>
              <td>
                <button class="btn btn-sm btn-secondary edit-rule-btn" data-rule-id="${r.id}">Bearbeiten</button>
                <button class="btn btn-sm btn-danger delete-rule-btn" data-rule-id="${r.id}" style="margin-left:4px">Löschen</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('add-rule-btn').addEventListener('click', () => showEmailRuleForm(null, groups, templates));

  content.querySelectorAll('.edit-rule-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = rules.find(r => r.id === parseInt(btn.dataset.ruleId));
      showEmailRuleForm(r, groups, templates);
    });
  });

  content.querySelectorAll('.delete-rule-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showConfirm('Regel löschen', 'E-Mail Regel löschen?')) return;
      try {
        await apiFetch(`/api/email-rules/${btn.dataset.ruleId}`, { method: 'DELETE' });
        showToast('Regel gelöscht', 'success');
        loadAdminSection('email-rules');
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });
}

function showEmailRuleForm(rule, groups, templates) {
  const recipientsVal = Array.isArray(rule?.recipients) ? rule.recipients.join(', ') : '';
  showFormModal('E-Mail Regel ' + (rule ? 'bearbeiten' : 'erstellen'), `
    <div class="form-group">
      <label class="required">Name</label>
      <input type="text" id="f-rule-name" value="${escapeHtml(rule?.name || '')}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Von Gruppe (optional)</label>
        <select id="f-rule-fromgroup">
          <option value="">Beliebig</option>
          ${groups.map(g => `<option value="${g.id}" ${rule?.from_group_id == g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Nach Gruppe</label>
        <select id="f-rule-togroup">
          <option value="">Beliebig</option>
          ${groups.map(g => `<option value="${g.id}" ${rule?.to_group_id == g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="required">Empfänger (kommagetrennt)</label>
      <input type="text" id="f-rule-recipients" value="${escapeHtml(recipientsVal)}" placeholder="email@beispiel.de, ...">
    </div>
    <div class="form-group">
      <label>
        <input type="checkbox" id="f-rule-include-email" ${rule?.include_card_email ? 'checked' : ''}>
        Kunden-E-Mail einschließen
      </label>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Vorlage</label>
        <select id="f-rule-template">
          <option value="">Standard</option>
          ${templates.map(t => `<option value="${t.id}" ${rule?.template_id == t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Aktiv</label>
        <select id="f-rule-active">
          <option value="1" ${rule?.active !== 0 ? 'selected' : ''}>Ja</option>
          <option value="0" ${rule?.active === 0 ? 'selected' : ''}>Nein</option>
        </select>
      </div>
    </div>
  `, async () => {
    const recRaw = document.getElementById('f-rule-recipients').value;
    const recipients = recRaw.split(',').map(e => e.trim()).filter(Boolean);
    const data = {
      name: document.getElementById('f-rule-name').value,
      from_group_id: document.getElementById('f-rule-fromgroup').value || null,
      to_group_id: document.getElementById('f-rule-togroup').value || null,
      recipients,
      include_card_email: document.getElementById('f-rule-include-email').checked ? 1 : 0,
      template_id: document.getElementById('f-rule-template').value || null,
      active: parseInt(document.getElementById('f-rule-active').value),
    };
    if (!data.name || recipients.length === 0) { showToast('Name und Empfänger erforderlich', 'error'); return false; }

    if (rule) {
      await apiFetch(`/api/email-rules/${rule.id}`, { method: 'PUT', body: JSON.stringify(data) });
    } else {
      await apiFetch('/api/email-rules', { method: 'POST', body: JSON.stringify(data) });
    }
    loadAdminSection('email-rules');
    return true;
  });
}

// ===== Users =====
async function loadUsers(content) {
  const [users, locations] = await Promise.all([
    apiFetch('/api/users'),
    apiFetch('/api/locations'),
  ]);

  content.innerHTML = `
    <div class="admin-section">
      <div class="admin-section-title">Benutzerverwaltung</div>
      <button class="btn btn-primary btn-sm" id="add-user-btn">+ Neuer Benutzer</button>
      <table style="margin-top:16px">
        <thead><tr><th>Benutzername</th><th>E-Mail</th><th>Rolle</th><th>Standort</th><th>Aktiv</th><th>Letzter Login</th><th>Aktionen</th></tr></thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td><strong>${escapeHtml(u.username)}</strong></td>
              <td>${escapeHtml(u.email || '—')}</td>
              <td><span class="tag tag-${u.role}">${escapeHtml(u.role)}</span></td>
              <td>${escapeHtml(u.location_name || '—')}</td>
              <td>${u.active ? '<span style="color:var(--success)">✓</span>' : '<span style="color:var(--danger)">✗</span>'}</td>
              <td>${u.last_login ? formatDate(u.last_login) : '—'}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-sm btn-secondary edit-user-btn" data-user-id="${u.id}">Bearbeiten</button>
                ${u.id !== currentUser.id ? `<button class="btn btn-sm btn-danger deactivate-user-btn" data-user-id="${u.id}" style="margin-left:4px">${u.active ? 'Deaktivieren' : 'Aktivieren'}</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('add-user-btn').addEventListener('click', () => showUserForm(null, locations));

  content.querySelectorAll('.edit-user-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const user = users.find(u => u.id === parseInt(btn.dataset.userId));
      showUserForm(user, locations);
    });
  });

  content.querySelectorAll('.deactivate-user-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const user = users.find(u => u.id === parseInt(btn.dataset.userId));
      if (!await showConfirm('Benutzer deaktivieren', `Benutzer "${user.username}" wirklich deaktivieren?`)) return;
      try {
        await apiFetch(`/api/users/${btn.dataset.userId}`, { method: 'DELETE' });
        showToast('Benutzer deaktiviert', 'success');
        loadAdminSection('users');
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });
}

function showUserForm(user, locations) {
  showFormModal('Benutzer ' + (user ? 'bearbeiten' : 'erstellen'), `
    <div class="form-row">
      <div class="form-group">
        <label class="required">Benutzername</label>
        <input type="text" id="f-user-name" value="${escapeHtml(user?.username || '')}">
      </div>
      <div class="form-group">
        <label ${!user ? 'class="required"' : ''}>Passwort ${user ? '(leer = unverändert)' : ''}</label>
        <input type="password" id="f-user-pass" ${!user ? 'required' : ''}>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>E-Mail</label>
        <input type="email" id="f-user-email" value="${escapeHtml(user?.email || '')}">
      </div>
      <div class="form-group">
        <label>Rolle</label>
        <select id="f-user-role">
          <option value="employee" ${user?.role === 'employee' ? 'selected' : ''}>Mitarbeiter</option>
          <option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>Administrator</option>
          <option value="readonly" ${user?.role === 'readonly' ? 'selected' : ''}>Nur-Lesen</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Standort</label>
      <select id="f-user-location">
        <option value="">Kein Standort</option>
        ${locations.filter(l => l.active).map(l => `<option value="${l.id}" ${user?.location_id == l.id ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>
        <input type="checkbox" id="f-user-notify" ${user?.notify_email !== 0 ? 'checked' : ''}>
        E-Mail Benachrichtigungen
      </label>
    </div>
  `, async () => {
    const data = {
      username: document.getElementById('f-user-name').value,
      role: document.getElementById('f-user-role').value,
      email: document.getElementById('f-user-email').value || null,
      location_id: document.getElementById('f-user-location').value || null,
      notify_email: document.getElementById('f-user-notify').checked ? 1 : 0,
    };
    const pass = document.getElementById('f-user-pass').value;

    if (!data.username) { showToast('Benutzername erforderlich', 'error'); return false; }
    if (!user && !pass) { showToast('Passwort erforderlich für neuen Benutzer', 'error'); return false; }

    if (user) {
      await apiFetch(`/api/users/${user.id}`, { method: 'PUT', body: JSON.stringify(data) });
      if (pass) {
        await apiFetch(`/api/users/${user.id}/password`, { method: 'PUT', body: JSON.stringify({ password: pass }) });
      }
    } else {
      await apiFetch('/api/users', { method: 'POST', body: JSON.stringify({ ...data, password: pass }) });
    }
    loadAdminSection('users');
    return true;
  });
}

// ===== Locations =====
async function loadLocations(content) {
  const locations = await apiFetch('/api/locations');
  content.innerHTML = `
    <div class="admin-section">
      <div class="admin-section-title">Standorte</div>
      <button class="btn btn-primary btn-sm" id="add-loc-btn">+ Neuer Standort</button>
      <table style="margin-top:16px">
        <thead><tr><th>Name</th><th>Aktiv</th><th>Aktionen</th></tr></thead>
        <tbody>
          ${locations.map(l => `
            <tr>
              <td>${escapeHtml(l.name)}</td>
              <td>${l.active ? '✓' : '✗'}</td>
              <td>
                <button class="btn btn-sm btn-secondary edit-loc-btn" data-loc-id="${l.id}">Bearbeiten</button>
                <button class="btn btn-sm btn-danger delete-loc-btn" data-loc-id="${l.id}" style="margin-left:4px">Deaktivieren</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('add-loc-btn').addEventListener('click', () => showLocationForm(null));

  content.querySelectorAll('.edit-loc-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const loc = locations.find(l => l.id === parseInt(btn.dataset.locId));
      showLocationForm(loc);
    });
  });

  content.querySelectorAll('.delete-loc-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showConfirm('Standort deaktivieren', 'Standort deaktivieren?')) return;
      try {
        await apiFetch(`/api/locations/${btn.dataset.locId}`, { method: 'DELETE' });
        showToast('Standort deaktiviert', 'success');
        loadAdminSection('locations');
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });
}

function showLocationForm(loc) {
  showFormModal('Standort ' + (loc ? 'bearbeiten' : 'erstellen'), `
    <div class="form-group">
      <label class="required">Name</label>
      <input type="text" id="f-loc-name" value="${escapeHtml(loc?.name || '')}">
    </div>
  `, async () => {
    const name = document.getElementById('f-loc-name').value;
    if (!name) { showToast('Name erforderlich', 'error'); return false; }
    if (loc) {
      await apiFetch(`/api/locations/${loc.id}`, { method: 'PUT', body: JSON.stringify({ name }) });
    } else {
      await apiFetch('/api/locations', { method: 'POST', body: JSON.stringify({ name }) });
    }
    loadAdminSection('locations');
    return true;
  });
}

// ===== Labels =====
async function loadLabels(content) {
  const labels = await apiFetch('/api/labels');
  content.innerHTML = `
    <div class="admin-section">
      <div class="admin-section-title">Labels</div>
      <button class="btn btn-primary btn-sm" id="add-label-admin-btn">+ Neues Label</button>
      <table style="margin-top:16px">
        <thead><tr><th>Farbe</th><th>Name</th><th>Aktionen</th></tr></thead>
        <tbody>
          ${labels.map(l => `
            <tr>
              <td><span class="card-label" style="background:${escapeHtml(l.color)}">${escapeHtml(l.name)}</span></td>
              <td>${escapeHtml(l.name)}</td>
              <td>
                <button class="btn btn-sm btn-secondary edit-label-btn" data-label-id="${l.id}">Bearbeiten</button>
                <button class="btn btn-sm btn-danger delete-label-btn" data-label-id="${l.id}" style="margin-left:4px">Löschen</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('add-label-admin-btn').addEventListener('click', () => showLabelForm(null));

  content.querySelectorAll('.edit-label-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const label = labels.find(l => l.id === parseInt(btn.dataset.labelId));
      showLabelForm(label);
    });
  });

  content.querySelectorAll('.delete-label-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showConfirm('Label löschen', 'Label löschen?')) return;
      try {
        await apiFetch(`/api/labels/${btn.dataset.labelId}`, { method: 'DELETE' });
        showToast('Label gelöscht', 'success');
        loadAdminSection('labels');
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });
}

function showLabelForm(label) {
  showFormModal('Label ' + (label ? 'bearbeiten' : 'erstellen'), `
    <div class="form-group">
      <label class="required">Name</label>
      <input type="text" id="f-label-name" value="${escapeHtml(label?.name || '')}">
    </div>
    <div class="form-group">
      <label>Farbe</label>
      <div class="color-input-group">
        <input type="color" id="f-label-color-picker" value="${label?.color || '#4a90d9'}">
        <input type="text" id="f-label-color" value="${label?.color || '#4a90d9'}">
      </div>
    </div>
  `, async () => {
    const name = document.getElementById('f-label-name').value;
    const color = document.getElementById('f-label-color').value;
    if (!name) { showToast('Name erforderlich', 'error'); return false; }
    if (label) {
      await apiFetch(`/api/labels/${label.id}`, { method: 'PUT', body: JSON.stringify({ name, color }) });
    } else {
      await apiFetch('/api/labels', { method: 'POST', body: JSON.stringify({ name, color }) });
    }
    loadAdminSection('labels');
    return true;
  });

  document.getElementById('f-label-color-picker').addEventListener('input', (e) => {
    document.getElementById('f-label-color').value = e.target.value;
  });
  document.getElementById('f-label-color').addEventListener('input', (e) => {
    document.getElementById('f-label-color-picker').value = e.target.value;
  });
}

// ===== Admin Customers =====
async function loadAdminCustomers(content) {
  if (typeof loadCustomers === 'function') {
    // Reuse customer page but in admin content
    content.innerHTML = `
      <div class="admin-section">
        <div class="admin-section-title">Kundenverwaltung</div>
        <p style="color:var(--secondary);font-size:13px">Vollständige Kundenverwaltung im <a href="#customers" style="color:var(--primary)">Kunden-Bereich</a> verfügbar.</p>
      </div>
    `;
  }
}

// ===== Checklist Templates =====
async function loadChecklistTemplates(content) {
  const [templates, columns, groups] = await Promise.all([
    apiFetch('/api/admin/checklist-templates'),
    apiFetch('/api/columns'),
    apiFetch('/api/groups'),
  ]);

  content.innerHTML = `
    <div class="admin-section">
      <div class="admin-section-title">Checklisten-Vorlagen</div>
      <button class="btn btn-primary btn-sm" id="add-tpl-btn">+ Neue Vorlage</button>
      <div style="margin-top:16px" id="tpl-list">
        ${templates.map(t => `
          <div style="border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
              <strong>${escapeHtml(t.name)}</strong>
              ${t.trigger_column_id ? `<span class="tag">Spalte: ${escapeHtml(columns.find(c => c.id === t.trigger_column_id)?.name || String(t.trigger_column_id))}</span>` : ''}
              ${t.trigger_group_id ? `<span class="tag">Gruppe: ${escapeHtml(groups.find(g => g.id === t.trigger_group_id)?.name || String(t.trigger_group_id))}</span>` : ''}
              <div style="margin-left:auto;display:flex;gap:4px">
                <button class="btn btn-sm btn-secondary edit-tpl-btn" data-tpl-id="${t.id}">Bearbeiten</button>
                <button class="btn btn-sm btn-danger delete-tpl-btn" data-tpl-id="${t.id}">Löschen</button>
              </div>
            </div>
            <ul style="font-size:13px;color:var(--secondary);padding-left:16px">
              ${(t.items || []).map(i => `<li>${escapeHtml(i.text)}</li>`).join('')}
            </ul>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  document.getElementById('add-tpl-btn').addEventListener('click', () => showChecklistTemplateForm(null, columns, groups));

  content.querySelectorAll('.edit-tpl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = templates.find(t => t.id === parseInt(btn.dataset.tplId));
      showChecklistTemplateForm(t, columns, groups);
    });
  });

  content.querySelectorAll('.delete-tpl-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showConfirm('Vorlage löschen', 'Checklisten-Vorlage löschen?')) return;
      try {
        await apiFetch(`/api/admin/checklist-templates/${btn.dataset.tplId}`, { method: 'DELETE' });
        showToast('Vorlage gelöscht', 'success');
        loadAdminSection('checklist-templates');
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    });
  });
}

function showChecklistTemplateForm(tpl, columns, groups) {
  const itemsVal = tpl?.items ? tpl.items.map(i => i.text).join('\n') : '';
  showFormModal('Vorlage ' + (tpl ? 'bearbeiten' : 'erstellen'), `
    <div class="form-group">
      <label class="required">Name</label>
      <input type="text" id="f-ctpl-name" value="${escapeHtml(tpl?.name || '')}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Auslöser: Spalte</label>
        <select id="f-ctpl-col">
          <option value="">Keine</option>
          ${columns.map(c => `<option value="${c.id}" ${tpl?.trigger_column_id == c.id ? 'selected' : ''}>${escapeHtml(c.group_name)} / ${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Auslöser: Gruppe</label>
        <select id="f-ctpl-group">
          <option value="">Keine</option>
          ${groups.map(g => `<option value="${g.id}" ${tpl?.trigger_group_id == g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Einträge (einer pro Zeile)</label>
      <textarea id="f-ctpl-items" style="min-height:120px" placeholder="Schritt 1&#10;Schritt 2&#10;Schritt 3">${escapeHtml(itemsVal)}</textarea>
    </div>
  `, async () => {
    const itemsRaw = document.getElementById('f-ctpl-items').value;
    const items = itemsRaw.split('\n').map(t => t.trim()).filter(Boolean);
    const data = {
      name: document.getElementById('f-ctpl-name').value,
      trigger_column_id: document.getElementById('f-ctpl-col').value || null,
      trigger_group_id: document.getElementById('f-ctpl-group').value || null,
      items,
    };
    if (!data.name) { showToast('Name erforderlich', 'error'); return false; }

    if (tpl) {
      await apiFetch(`/api/admin/checklist-templates/${tpl.id}`, { method: 'PUT', body: JSON.stringify(data) });
    } else {
      await apiFetch('/api/admin/checklist-templates', { method: 'POST', body: JSON.stringify(data) });
    }
    loadAdminSection('checklist-templates');
    return true;
  });
}

// ===== Branding =====
async function loadBranding(content) {
  const settings = await apiFetch('/api/admin/settings');
  content.innerHTML = `
    <div class="admin-section">
      <div class="admin-section-title">CI / Branding</div>
      <div class="form-row">
        <div class="form-group">
          <label>App-Name</label>
          <input type="text" id="s-app-name" value="${escapeHtml(settings.app_name || 'Druckerei Tracker')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Primärfarbe</label>
          <div class="color-input-group">
            <input type="color" id="s-primary-picker" value="${settings.primary_color || '#2563eb'}">
            <input type="text" id="s-primary" value="${settings.primary_color || '#2563eb'}">
          </div>
        </div>
        <div class="form-group">
          <label>Sekundärfarbe</label>
          <div class="color-input-group">
            <input type="color" id="s-secondary-picker" value="${settings.secondary_color || '#64748b'}">
            <input type="text" id="s-secondary" value="${settings.secondary_color || '#64748b'}">
          </div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Hintergrundfarbe</label>
          <div class="color-input-group">
            <input type="color" id="s-bg-picker" value="${settings.bg_color || '#f1f5f9'}">
            <input type="text" id="s-bg" value="${settings.bg_color || '#f1f5f9'}">
          </div>
        </div>
        <div class="form-group">
          <label>Navigationsfarbe</label>
          <div class="color-input-group">
            <input type="color" id="s-nav-picker" value="${settings.nav_color || '#1e3a5f'}">
            <input type="text" id="s-nav" value="${settings.nav_color || '#1e3a5f'}">
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary" id="save-branding-btn">Speichern & Vorschau</button>
      </div>
      <div class="branding-preview" id="branding-preview" style="margin-top:16px">
        <div style="background:${settings.nav_color || '#1e3a5f'};padding:10px 16px;border-radius:var(--radius);color:white;font-weight:600">
          ${escapeHtml(settings.app_name || 'Druckerei Tracker')} — Navigation Preview
        </div>
        <div style="background:${settings.bg_color || '#f1f5f9'};padding:16px;border-radius:var(--radius);margin-top:8px">
          <button style="background:${settings.primary_color || '#2563eb'};color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer">Primärbutton</button>
          <span style="margin-left:12px;color:${settings.secondary_color || '#64748b'}">Sekundärtext</span>
        </div>
      </div>
    </div>
    <div class="admin-section">
      <div class="admin-section-title">Logo & Favicon</div>
      <div class="form-row">
        <div class="form-group">
          <label>Logo (PNG)</label>
          <input type="file" id="logo-upload" accept="image/png,image/jpeg">
          ${settings.logo_path ? `<img src="${escapeHtml(settings.logo_path)}?t=${Date.now()}" style="margin-top:8px;height:50px;object-fit:contain">` : '<p style="font-size:12px;color:var(--text-muted)">Kein Logo hochgeladen</p>'}
        </div>
        <div class="form-group">
          <label>Favicon (ICO/PNG)</label>
          <input type="file" id="favicon-upload" accept=".ico,image/png">
        </div>
      </div>
      <button class="btn btn-primary btn-sm" id="upload-branding-btn">Hochladen</button>
    </div>
  `;

  // Color sync
  [['s-primary-picker', 's-primary'], ['s-secondary-picker', 's-secondary'], ['s-bg-picker', 's-bg'], ['s-nav-picker', 's-nav']].forEach(([pickId, txtId]) => {
    document.getElementById(pickId).addEventListener('input', (e) => document.getElementById(txtId).value = e.target.value);
    document.getElementById(txtId).addEventListener('input', (e) => { try { document.getElementById(pickId).value = e.target.value; } catch (err) {} });
  });

  document.getElementById('save-branding-btn').addEventListener('click', async () => {
    const data = {
      app_name: document.getElementById('s-app-name').value,
      primary_color: document.getElementById('s-primary').value,
      secondary_color: document.getElementById('s-secondary').value,
      bg_color: document.getElementById('s-bg').value,
      nav_color: document.getElementById('s-nav').value,
    };
    try {
      await apiFetch('/api/admin/settings', { method: 'PUT', body: JSON.stringify(data) });
      applyTheme(data);
      showToast('Einstellungen gespeichert', 'success');
    } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
  });

  document.getElementById('upload-branding-btn').addEventListener('click', async () => {
    const logoFile = document.getElementById('logo-upload').files[0];
    const faviconFile = document.getElementById('favicon-upload').files[0];

    if (logoFile) {
      const fd = new FormData();
      fd.append('logo', logoFile);
      try {
        const res = await fetch('/api/admin/settings/logo', { method: 'POST', body: fd, headers: { 'X-CSRF-Token': getCsrfToken() } });
        if (!res.ok) throw new Error('Logo upload failed');
        showToast('Logo hochgeladen', 'success');
        document.getElementById('nav-logo').src = '/uploads/branding/logo.png?t=' + Date.now();
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    }

    if (faviconFile) {
      const fd = new FormData();
      fd.append('favicon', faviconFile);
      try {
        const res = await fetch('/api/admin/settings/favicon', { method: 'POST', body: fd, headers: { 'X-CSRF-Token': getCsrfToken() } });
        if (!res.ok) throw new Error('Favicon upload failed');
        showToast('Favicon hochgeladen', 'success');
      } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
    }
  });
}

// ===== Backup =====
async function loadBackup(content) {
  const [status, settings] = await Promise.all([
    apiFetch('/api/admin/backup/status').catch(() => null),
    apiFetch('/api/admin/settings'),
  ]);

  content.innerHTML = `
    <div class="admin-section">
      <div class="admin-section-title">Backup</div>
      <div style="margin-bottom:16px">
        <strong>Letztes Backup:</strong>
        ${status ? `
          <span style="color:${status.success ? 'var(--success)' : 'var(--danger)'}">
            ${status.success ? '✓ Erfolgreich' : '✗ Fehlgeschlagen'}
          </span>
          — ${formatDate(status.completed_at)}
          ${status.file_path ? `<br><span style="font-size:12px;color:var(--text-muted)">${escapeHtml(status.file_path)}</span>` : ''}
          ${status.error_message ? `<br><span style="color:var(--danger)">${escapeHtml(status.error_message)}</span>` : ''}
        ` : '<span style="color:var(--text-muted)">Kein Backup vorhanden</span>'}
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Backup-Intervall (Tage, 0=deaktiviert)</label>
          <input type="number" id="s-backup-interval" value="${settings.backup_interval_days || '1'}">
        </div>
        <div class="form-group">
          <label>Backups aufbewahren</label>
          <input type="number" id="s-backup-keep" value="${settings.backup_keep_count || '14'}">
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" id="save-backup-settings-btn">Einstellungen speichern</button>
        <button class="btn btn-secondary" id="run-backup-btn">Backup jetzt ausführen</button>
      </div>
      <div id="backup-result" style="margin-top:12px"></div>

      <div class="admin-section-title" style="margin-top:24px">Wiederherstellen</div>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:10px">Backup auswählen und wiederherstellen. Die App startet danach automatisch neu.</p>
      <div id="backup-list-container"><span style="font-size:13px;color:var(--text-muted)">Lade Backups…</span></div>
    </div>
  `;

  document.getElementById('save-backup-settings-btn').addEventListener('click', async () => {
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          backup_interval_days: document.getElementById('s-backup-interval').value,
          backup_keep_count: document.getElementById('s-backup-keep').value,
        }),
      });
      showToast('Einstellungen gespeichert', 'success');
    } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
  });

  document.getElementById('run-backup-btn').addEventListener('click', async () => {
    const result = document.getElementById('backup-result');
    result.textContent = 'Backup läuft...';
    try {
      const res = await apiFetch('/api/admin/backup/run', { method: 'POST' });
      result.innerHTML = `<span style="color:var(--success)">✓ Backup abgeschlossen: ${escapeHtml(res.path)}</span>`;
      loadBackupList();
    } catch (e) {
      result.innerHTML = `<span style="color:var(--danger)">✗ Fehler: ${escapeHtml(e.message)}</span>`;
    }
  });

  async function loadBackupList() {
    const container = document.getElementById('backup-list-container');
    if (!container) return;
    try {
      const backups = await apiFetch('/api/admin/backup/list');
      if (!backups.length) {
        container.innerHTML = '<span style="font-size:13px;color:var(--text-muted)">Keine Backups vorhanden.</span>';
        return;
      }
      container.innerHTML = `<table class="admin-table">
        <thead><tr><th>Backup</th><th>Erstellt</th><th></th></tr></thead>
        <tbody>
          ${backups.map(b => `
            <tr>
              <td><code style="font-size:12px">${escapeHtml(b.name)}</code></td>
              <td style="font-size:12px">${new Date(b.created_at).toLocaleString('de-DE')}</td>
              <td><button class="btn btn-sm btn-danger restore-btn" data-name="${escapeHtml(b.name)}">Wiederherstellen</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
      container.querySelectorAll('.restore-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const name = btn.dataset.name;
          if (!await showConfirm('Backup wiederherstellen', `"${name}" wiederherstellen? Aktuelle Daten werden überschrieben. Die App startet danach neu.`)) return;
          try {
            btn.disabled = true; btn.textContent = 'Wird wiederhergestellt…';
            await apiFetch('/api/admin/backup/restore', { method: 'POST', body: JSON.stringify({ backup_name: name }) });
            showToast('Restore läuft, App startet neu…', 'success');
          } catch(e) { showToast('Fehler: ' + e.message, 'error'); btn.disabled = false; btn.textContent = 'Wiederherstellen'; }
        });
      });
    } catch(e) {
      container.innerHTML = `<span style="font-size:13px;color:var(--danger)">Fehler: ${escapeHtml(e.message)}</span>`;
    }
  }

  loadBackupList();
}

// ===== Archive Settings =====
async function loadArchiveSettings(content) {
  const settings = await apiFetch('/api/admin/settings');
  content.innerHTML = `
    <div class="admin-section">
      <div class="admin-section-title">Archiv-Einstellungen</div>
      <div class="form-group">
        <label>Auto-Archivierung nach X Tagen (0=deaktiviert)</label>
        <input type="number" id="s-auto-archive" value="${settings.auto_archive_days || '0'}" min="0">
        <p style="font-size:12px;color:var(--text-muted);margin-top:4px">Karten ohne Aktivität werden automatisch archiviert</p>
      </div>
      <div class="form-group">
        <label>Session-Timeout (Minuten)</label>
        <input type="number" id="s-session-timeout" value="${settings.session_timeout || '60'}">
      </div>
      <button class="btn btn-primary" id="save-archive-settings-btn">Speichern</button>
    </div>
  `;

  document.getElementById('save-archive-settings-btn').addEventListener('click', async () => {
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          auto_archive_days: document.getElementById('s-auto-archive').value,
          session_timeout: document.getElementById('s-session-timeout').value,
        }),
      });
      showToast('Einstellungen gespeichert', 'success');
    } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
  });
}

// ===== Generic Form Modal =====
function showFormModal(title, formHtml, onSave) {
  const modal = document.getElementById('create-card-modal');
  const body = document.getElementById('create-card-modal-body');
  document.querySelector('#create-card-modal .modal-header h2').textContent = title;

  body.innerHTML = `
    <div class="modal-body">${formHtml}</div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="generic-cancel-btn">Abbrechen</button>
      <button class="btn btn-primary" id="generic-save-btn">Speichern</button>
    </div>
  `;

  modal.classList.remove('hidden');

  const close = () => modal.classList.add('hidden');
  document.getElementById('create-card-modal-close').onclick = close;
  document.getElementById('create-card-modal-backdrop').onclick = close;
  document.getElementById('generic-cancel-btn').onclick = close;

  document.getElementById('generic-save-btn').addEventListener('click', async () => {
    try {
      const result = await onSave();
      if (result !== false) {
        close();
        showToast('Gespeichert', 'success');
      }
    } catch (e) {
      showToast('Fehler: ' + e.message, 'error');
    }
  });
}

// ===== Sysinfo =====
async function loadSysinfo(content) {
  const info = await apiFetch('/api/admin/sysinfo');

  function formatUptime(secs) {
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return [d > 0 ? `${d}T` : '', h > 0 ? `${h}h` : '', `${m}min`].filter(Boolean).join(' ');
  }

  content.innerHTML = `
    <div class="admin-section">
      <div class="admin-section-title">Systeminformationen</div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:24px">
        ${[
          ['Version', `v${info.version}`],
          ['Node.js', info.node_version],
          ['Betriebssystem', info.os_info],
          ['Laufzeit', formatUptime(info.uptime_seconds)],
          ['Speicher', `${info.memory_mb} MB`],
          ['Datenbank', info.db_size],
          ['Uploads', info.upload_size],
          ['Aktive Karten', info.cards_active],
          ['Archivierte Karten', info.cards_archived],
          ['Benutzer', info.users_active],
          ['Kunden', info.customers],
        ].map(([label, val]) => `
          <div style="background:var(--bg);border-radius:var(--radius);padding:12px">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">${label}</div>
            <div style="font-size:14px;font-weight:700">${escapeHtml(String(val))}</div>
          </div>
        `).join('')}
      </div>

      <div class="admin-section-title" style="display:flex;align-items:center;justify-content:space-between">
        <span>npm-Module</span>
        <button class="btn btn-sm btn-secondary" id="check-npm-outdated-btn">Auf Updates prüfen</button>
      </div>
      <div id="npm-outdated-box" style="margin-bottom:8px"></div>
      <table class="admin-table" style="margin-bottom:24px">
        <thead><tr><th>Paket</th><th>Installiert</th><th>Benötigt</th></tr></thead>
        <tbody>
          ${(info.npm_modules || []).map(m => `
            <tr>
              <td><code>${escapeHtml(m.name)}</code></td>
              <td>${escapeHtml(m.version)}</td>
              <td style="color:var(--text-muted);font-size:12px">${escapeHtml(m.required)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      ${info.system_packages && info.system_packages.length > 0 ? `
      <div class="admin-section-title">Systempakete (dpkg)</div>
      <table class="admin-table" style="margin-bottom:24px">
        <thead><tr><th>Paket</th><th>Version</th></tr></thead>
        <tbody>
          ${info.system_packages.map(p => `
            <tr>
              <td><code>${escapeHtml(p.name)}</code></td>
              <td>${escapeHtml(p.version)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>` : ''}


      <div class="admin-section-title">Update</div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
        <div>
          <span style="font-size:13px">Installierte Version: <strong>v${escapeHtml(info.version)}</strong></span>
          <span id="latest-version-badge" style="margin-left:12px;font-size:12px;color:var(--text-muted)">Prüfe GitHub...</span>
        </div>
        <button class="btn btn-secondary btn-sm" id="check-update-btn">Auf Updates prüfen</button>
        <button class="btn btn-primary btn-sm" id="do-update-btn">Update installieren</button>
      </div>
      <pre id="update-log-box" style="background:#1a1a1a;color:#ddd;padding:12px;border-radius:var(--radius);font-size:11px;max-height:300px;overflow-y:auto;white-space:pre-wrap;display:none"></pre>
    </div>
  `;

  // Load latest version from GitHub
  async function checkVersion() {
    try {
      const vdata = await apiFetch('/api/admin/latest-version');
      const badge = document.getElementById('latest-version-badge');
      if (!badge) return;
      if (vdata.tag_name) {
        const current = 'v' + info.version;
        if (vdata.tag_name === current) {
          badge.textContent = `Aktuell (${vdata.tag_name})`;
          badge.style.color = 'var(--success)';
        } else {
          badge.textContent = `Neue Version verfügbar: ${vdata.tag_name}`;
          badge.style.color = 'var(--warning)';
        }
      } else {
        badge.textContent = vdata.error ? 'GitHub nicht erreichbar' : 'Keine Release-Info';
        badge.style.color = 'var(--text-muted)';
      }
    } catch(e) {
      const badge = document.getElementById('latest-version-badge');
      if (badge) { badge.textContent = 'GitHub nicht erreichbar'; badge.style.color = 'var(--text-muted)'; }
    }
  }

  checkVersion();

  document.getElementById('check-update-btn').addEventListener('click', () => {
    document.getElementById('latest-version-badge').textContent = 'Prüfe...';
    checkVersion();
  });

  document.getElementById('do-update-btn').addEventListener('click', async () => {
    if (!await showConfirm('Update installieren', 'Das Tool wird aktualisiert und kurz neu gestartet. Fortfahren?')) return;
    const btn = document.getElementById('do-update-btn');
    const logBox = document.getElementById('update-log-box');
    btn.disabled = true;
    btn.textContent = '⏳ Herunterladen...';
    logBox.style.display = '';
    logBox.textContent = '';
    try {
      await apiFetch('/api/admin/update', { method: 'POST' });
    } catch(e) { showToast('Fehler: ' + e.message, 'error'); btn.disabled = false; btn.textContent = 'Update installieren'; return; }

    // Phase 1: poll log while server is still running
    let lastLog = '';
    let serverGone = false;
    const steps = ['⏳ Herunterladen...', '📦 Entpacken...', '📁 Kopieren...', '🔧 Abhängigkeiten...', '🔄 Neustart...'];
    let stepIdx = 0;
    const stepInterval = setInterval(() => {
      stepIdx = Math.min(stepIdx + 1, steps.length - 1);
      btn.textContent = steps[stepIdx];
    }, 4000);

    const pollInterval = setInterval(async () => {
      try {
        const logData = await apiFetch('/api/admin/update-log');
        const newLog = logData.log || '';
        if (newLog !== lastLog) {
          lastLog = newLog;
          logBox.textContent = newLog;
          logBox.scrollTop = logBox.scrollHeight;
        }
        // Check if update finished successfully
        if (newLog.includes('=== Update erfolgreich ===') && !serverGone) {
          serverGone = true;
          clearInterval(pollInterval);
          clearInterval(stepInterval);
          btn.textContent = '🔄 Neustart läuft...';
          // Wait for server to go down then come back
          waitForRestart();
        }
      } catch(e) {
        // Server went down = restart in progress
        if (!serverGone) {
          serverGone = true;
          clearInterval(pollInterval);
          clearInterval(stepInterval);
          btn.textContent = '🔄 Neustart läuft...';
          waitForRestart();
        }
      }
    }, 2000);

    function waitForRestart() {
      logBox.textContent = (lastLog || '') + '\n▸ Warte auf Neustart...';
      logBox.scrollTop = logBox.scrollHeight;
      let tries = 0;
      const checkAlive = setInterval(async () => {
        tries++;
        try {
          await fetch(window.location.origin + '/api/labels', { credentials: 'same-origin' });
          // Server is back
          clearInterval(checkAlive);
          btn.textContent = '✓ Update abgeschlossen';
          logBox.textContent = (lastLog || '') + '\n✓ Server läuft wieder.';
          logBox.scrollTop = logBox.scrollHeight;
          showToast('Update erfolgreich – Seite wird neu geladen', 'success');
          setTimeout(() => window.location.reload(), 2000);
        } catch(_) {
          if (tries > 60) { clearInterval(checkAlive); btn.textContent = 'Update installieren'; btn.disabled = false; }
        }
      }, 2000);
    }
  });

  document.getElementById('check-npm-outdated-btn').addEventListener('click', async () => {
    const box = document.getElementById('npm-outdated-box');
    const btn = document.getElementById('check-npm-outdated-btn');
    btn.disabled = true;
    btn.textContent = 'Prüfe...';
    box.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">npm outdated wird ausgeführt…</span>';
    try {
      const data = await apiFetch('/api/admin/npm-outdated');
      btn.disabled = false;
      btn.textContent = 'Auf Updates prüfen';
      if (!data.packages || data.packages.length === 0) {
        box.innerHTML = '<div style="font-size:12px;color:var(--success);padding:6px 0">Alle npm-Pakete sind aktuell.</div>';
        return;
      }
      box.innerHTML = `
        <table class="admin-table" style="margin-bottom:8px">
          <thead><tr><th>Paket</th><th>Installiert</th><th>Gewünscht</th><th style="color:var(--warning)">Neueste</th></tr></thead>
          <tbody>
            ${data.packages.map(p => `
              <tr>
                <td><code>${escapeHtml(p.name)}</code></td>
                <td>${escapeHtml(p.current)}</td>
                <td>${escapeHtml(p.wanted)}</td>
                <td style="font-weight:600;color:var(--warning)">${escapeHtml(p.latest)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div style="font-size:12px;color:var(--text-muted)">Updates werden mit dem "Update installieren"-Button eingespielt (npm install).</div>
      `;
    } catch(e) {
      btn.disabled = false;
      btn.textContent = 'Auf Updates prüfen';
      box.innerHTML = `<span style="font-size:12px;color:var(--danger)">Fehler: ${escapeHtml(e.message)}</span>`;
    }
  });
}
