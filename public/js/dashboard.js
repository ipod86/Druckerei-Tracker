'use strict';

window.loadDashboard = async function() {
  const container = document.getElementById('page-dashboard');
  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Dashboard</h1>
      <button class="btn btn-secondary btn-sm" onclick="loadDashboard()">Aktualisieren</button>
    </div>
    <div class="loading"><div class="spinner"></div></div>
  `;

  try {
    const data = await apiFetch('/api/dashboard');
    renderDashboard(container, data);
  } catch (e) {
    container.innerHTML = `<div class="empty-state">Fehler beim Laden: ${escapeHtml(e.message)}</div>`;
  }
};

function renderDashboard(container, data) {
  const { cards_per_column, overdue_cards, my_recent, recently_moved, completed_this_week, open_checklists } = data;

  const maxCount = Math.max(...cards_per_column.map(c => c.count || 0), 1);

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Dashboard</h1>
      <button class="btn btn-secondary btn-sm" onclick="loadDashboard()">Aktualisieren</button>
    </div>
    <div class="dashboard-grid">

      <!-- Stat: Completed this week -->
      <div class="dashboard-card" style="display:flex;align-items:center;gap:20px">
        <div>
          <div class="stat-number">${completed_this_week}</div>
          <div class="stat-label">Abgeschlossen diese Woche</div>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" style="width:48px;height:48px;opacity:0.5;margin-left:auto">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>

      <!-- Stat: Overdue -->
      <div class="dashboard-card" style="display:flex;align-items:center;gap:20px">
        <div>
          <div class="stat-number" style="color:var(--danger)">${overdue_cards.length}</div>
          <div class="stat-label">Überfällige Karten</div>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2" style="width:48px;height:48px;opacity:0.5;margin-left:auto">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>

      <!-- Cards per column -->
      <div class="dashboard-card dashboard-card-wide">
        <div class="dashboard-card-title">Karten pro Spalte</div>
        <div class="column-chart">
          ${cards_per_column.map(col => `
            <div class="chart-row" style="cursor:pointer" onclick="window.location.hash='#board'; setTimeout(() => { if(typeof loadBoard==='function') loadBoard(); }, 100)">
              <div class="chart-label" title="${escapeHtml(col.column_name)}">${escapeHtml(col.column_name)}</div>
              <div class="chart-bar-container">
                <div class="chart-bar" style="width:${Math.max(((col.count || 0) / maxCount) * 100, col.count > 0 ? 4 : 0)}%;background:${escapeHtml(col.group_color || 'var(--primary)')}"></div>
              </div>
              <div class="chart-count">${col.count || 0}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Overdue cards -->
      <div class="dashboard-card">
        <div class="dashboard-card-title">Überfällige Karten</div>
        ${overdue_cards.length === 0 ?
          '<p style="color:var(--text-muted);font-size:13px">Keine überfälligen Karten</p>' :
          overdue_cards.slice(0, 8).map(card => `
            <div class="card-list-item" onclick="openCard(${card.id})">
              <div class="card-list-dot" style="background:${escapeHtml(card.group_color || '#ccc')}"></div>
              <div class="card-list-info">
                <div class="card-list-title">${escapeHtml(card.title)}</div>
                <div class="card-list-meta">
                  ${escapeHtml(card.group_name)} / ${escapeHtml(card.column_name)}
                  ${card.due_date ? ' — Fällig: ' + escapeHtml(formatDateShort(card.due_date)) : ''}
                  ${card.customer_name ? ' — ' + escapeHtml(card.customer_name) : ''}
                </div>
              </div>
            </div>
          `).join('')
        }
      </div>

      <!-- My recent activity -->
      <div class="dashboard-card">
        <div class="dashboard-card-title">Meine letzten Aktivitäten</div>
        ${my_recent.length === 0 ?
          '<p style="color:var(--text-muted);font-size:13px">Keine Aktivitäten</p>' :
          my_recent.map(card => `
            <div class="card-list-item" onclick="openCard(${card.id})">
              <div class="card-list-dot" style="background:${escapeHtml(card.group_color || '#ccc')}"></div>
              <div class="card-list-info">
                <div class="card-list-title">${escapeHtml(card.title)}</div>
                <div class="card-list-meta">${escapeHtml(card.group_name)} / ${escapeHtml(card.column_name)} — ${formatDate(card.last_activity)}</div>
              </div>
            </div>
          `).join('')
        }
      </div>

      <!-- Recently moved -->
      <div class="dashboard-card">
        <div class="dashboard-card-title">Zuletzt verschoben</div>
        ${recently_moved.length === 0 ?
          '<p style="color:var(--text-muted);font-size:13px">Keine Bewegungen</p>' :
          recently_moved.map(item => `
            <div class="card-list-item" onclick="openCard(${item.card_id})">
              <div class="card-list-dot" style="background:${escapeHtml(item.group_color || '#ccc')}"></div>
              <div class="card-list-info">
                <div class="card-list-title">${escapeHtml(item.title)}</div>
                <div class="card-list-meta">${escapeHtml(item.username || '—')} — ${formatDate(item.created_at)}</div>
              </div>
            </div>
          `).join('')
        }
      </div>

      <!-- Open checklists -->
      <div class="dashboard-card">
        <div class="dashboard-card-title">Offene Checklisten</div>
        ${open_checklists.length === 0 ?
          '<p style="color:var(--text-muted);font-size:13px">Alle Checklisten erledigt</p>' :
          open_checklists.map(item => `
            <div class="card-list-item" onclick="openCard(${item.card_id})">
              <div class="card-list-dot" style="background:${escapeHtml(item.group_color || '#ccc')}"></div>
              <div class="card-list-info">
                <div class="card-list-title">${escapeHtml(item.title)}</div>
                <div class="card-list-meta">${escapeHtml(item.group_name)} / ${escapeHtml(item.column_name)} — ${item.incomplete_count} offen</div>
              </div>
            </div>
          `).join('')
        }
      </div>

    </div>
  `;
}
