'use strict';

// ===== Global State =====
window.currentUser = null;
window.appSettings = {};
let notificationPollInterval = null;
let searchDebounceTimer = null;

// ===== API Fetch Wrapper =====
window.apiFetch = async function(url, opts = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
    });
    if (res.status === 401) {
      showLogin();
      throw new Error('Not authenticated');
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        msg = data.error || msg;
      } catch (e) {}
      throw new Error(msg);
    }
    const ct = res.headers.get('content-type');
    if (ct && ct.includes('application/json')) return res.json();
    return res;
  } catch (e) {
    if (e.message !== 'Not authenticated') {
      console.error('API Error:', url, e.message);
    }
    throw e;
  }
};

// ===== Toast Notifications =====
window.showToast = function(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, duration);
};

// ===== Confirm Dialog =====
window.showConfirm = function(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    modal.classList.remove('hidden');

    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');

    const cleanup = (result) => {
      modal.classList.add('hidden');
      ok.replaceWith(ok.cloneNode(true));
      cancel.replaceWith(cancel.cloneNode(true));
      resolve(result);
    };

    document.getElementById('confirm-ok').addEventListener('click', () => cleanup(true));
    document.getElementById('confirm-cancel').addEventListener('click', () => cleanup(false));
  });
};

// ===== Apply Theme =====
window.applyTheme = function(settings) {
  if (!settings) return;
  const root = document.documentElement;
  if (settings.primary_color) root.style.setProperty('--primary', settings.primary_color);
  if (settings.secondary_color) root.style.setProperty('--secondary', settings.secondary_color);
  if (settings.bg_color) root.style.setProperty('--bg', settings.bg_color);
  if (settings.nav_color) root.style.setProperty('--nav-bg', settings.nav_color);

  // Update app name
  const appName = settings.app_name || 'Druckerei Tracker';
  document.title = appName;
  const navName = document.getElementById('nav-app-name');
  if (navName) navName.textContent = appName;
  const loginName = document.getElementById('login-app-name');
  if (loginName) loginName.textContent = appName;
};

// ===== Show/Hide Login =====
function showLogin() {
  document.getElementById('login-page').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  if (notificationPollInterval) clearInterval(notificationPollInterval);
}

function showApp(user, settings) {
  window.currentUser = user;
  window.appSettings = settings;
  applyTheme(settings);

  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

  // Update UI for user
  document.getElementById('nav-username').textContent = user.username;
  document.getElementById('user-info-nav').textContent = `${user.username} (${user.role})`;

  // Show/hide admin items
  document.querySelectorAll('.admin-only').forEach(el => {
    if (user.role === 'admin') {
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  });

  // Start notification polling
  loadNotifications();
  notificationPollInterval = setInterval(loadNotifications, 30000);

  // Navigate to current hash or dashboard
  handleRoute();
}

// ===== Router =====
function handleRoute() {
  const hash = window.location.hash.slice(1) || 'dashboard';
  const [page, ...rest] = hash.split('/');

  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.sidebar-item').forEach(item => item.classList.remove('active'));

  const pageEl = document.getElementById(`page-${page}`);
  if (!pageEl) {
    window.location.hash = '#dashboard';
    return;
  }
  pageEl.classList.remove('hidden');

  const sidebarItem = document.querySelector(`.sidebar-item[data-page="${page}"]`);
  if (sidebarItem) sidebarItem.classList.add('active');

  // Load page content
  switch (page) {
    case 'dashboard':
      if (typeof loadDashboard === 'function') loadDashboard();
      break;
    case 'board':
      if (typeof loadBoard === 'function') loadBoard();
      break;
    case 'archive':
      if (typeof loadArchive === 'function') loadArchive();
      break;
    case 'customers':
      if (typeof loadCustomers === 'function') loadCustomers();
      break;
    case 'admin':
      if (currentUser && currentUser.role === 'admin' && typeof loadAdmin === 'function') loadAdmin();
      break;
  }

  // Check for card ID in hash
  if (rest.length > 0 && page === 'board') {
    const cardId = rest[0];
    if (cardId && typeof openCard === 'function') openCard(cardId);
  }
}

window.addEventListener('hashchange', () => {
  if (window.currentUser) handleRoute();
});

// ===== Login Form =====
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Login fehlgeschlagen';
      errorEl.classList.remove('hidden');
      return;
    }
    // Fetch full user + settings
    const meRes = await fetch('/api/auth/me');
    const me = await meRes.json();
    showApp(me, me.settings || {});
  } catch (e) {
    errorEl.textContent = 'Verbindungsfehler';
    errorEl.classList.remove('hidden');
  }
});

// ===== Logout =====
document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.currentUser = null;
  window.location.hash = '';
  showLogin();
});

// ===== Sidebar Toggle =====
(function() {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebar-toggle');
  const isMobile = () => window.innerWidth <= 768;

  // Create overlay element
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  overlay.id = 'sidebar-overlay';
  document.body.appendChild(overlay);

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
  }

  function openSidebarMobile() {
    sidebar.classList.add('open');
    overlay.classList.add('visible');
  }

  // Restore desktop collapsed state from localStorage
  if (!isMobile() && localStorage.getItem('sidebarCollapsed') === '1') {
    sidebar.classList.add('collapsed');
  }

  toggle.addEventListener('click', () => {
    if (isMobile()) {
      if (sidebar.classList.contains('open')) {
        closeSidebar();
      } else {
        openSidebarMobile();
      }
    } else {
      // Desktop: toggle collapsed
      sidebar.classList.toggle('collapsed');
      localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed') ? '1' : '0');
    }
  });

  // Close mobile sidebar when clicking overlay
  overlay.addEventListener('click', closeSidebar);

  // Close mobile sidebar when navigating
  document.addEventListener('click', (e) => {
    if (isMobile() && e.target.closest('.sidebar-item')) {
      setTimeout(closeSidebar, 150);
    }
  });

  // On resize: fix state
  window.addEventListener('resize', () => {
    if (!isMobile()) {
      overlay.classList.remove('visible');
      // Restore desktop collapsed state
      if (localStorage.getItem('sidebarCollapsed') === '1') {
        sidebar.classList.add('collapsed');
      }
    } else {
      sidebar.classList.remove('collapsed');
    }
  });
})();

// ===== User Menu =====
document.getElementById('user-menu-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('user-dropdown').classList.toggle('hidden');
});
document.addEventListener('click', () => {
  document.getElementById('user-dropdown').classList.add('hidden');
  document.getElementById('notif-dropdown').classList.add('hidden');
});

// ===== Notifications =====
document.getElementById('notif-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const dropdown = document.getElementById('notif-dropdown');
  dropdown.classList.toggle('hidden');
  if (!dropdown.classList.contains('hidden')) {
    loadNotifications(true);
  }
});

document.getElementById('notif-read-all').addEventListener('click', async (e) => {
  e.stopPropagation();
  await apiFetch('/api/notifications/read-all', { method: 'PUT' });
  loadNotifications(true);
});

async function loadNotifications(show = false) {
  try {
    const notifications = await apiFetch('/api/notifications');
    const unread = notifications.filter(n => !n.read);
    const badge = document.getElementById('notif-badge');

    if (unread.length > 0) {
      badge.textContent = unread.length > 99 ? '99+' : unread.length;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    const list = document.getElementById('notif-list');
    if (notifications.length === 0) {
      list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted)">Keine Benachrichtigungen</div>';
    } else {
      list.innerHTML = notifications.slice(0, 20).map(n => `
        <div class="notif-item ${n.read ? '' : 'unread'}" data-notif-id="${n.id}" data-card-id="${n.card_id || ''}">
          <div class="notif-msg">${escapeHtml(n.message)}</div>
          <div class="notif-time">${formatDate(n.created_at)}</div>
        </div>
      `).join('');

      list.querySelectorAll('.notif-item').forEach(item => {
        item.addEventListener('click', async (e) => {
          const notifId = item.dataset.notifId;
          const cardId = item.dataset.cardId;
          await apiFetch(`/api/notifications/${notifId}/read`, { method: 'PUT' }).catch(() => {});
          if (cardId) openCard(cardId);
          document.getElementById('notif-dropdown').classList.add('hidden');
          loadNotifications();
        });
      });
    }
  } catch (e) { /* ignore */ }
}

// ===== Search =====
document.getElementById('search-input').addEventListener('input', (e) => {
  clearTimeout(searchDebounceTimer);
  const q = e.target.value.trim();
  if (q.length < 2) {
    document.getElementById('search-results').classList.add('hidden');
    return;
  }
  searchDebounceTimer = setTimeout(() => performSearch(q), 300);
});

document.getElementById('search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('search-results').classList.add('hidden');
    e.target.value = '';
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-container')) {
    document.getElementById('search-results').classList.add('hidden');
  }
});

async function performSearch(q) {
  try {
    const results = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
    const dropdown = document.getElementById('search-results');

    if (results.length === 0) {
      dropdown.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-muted)">Keine Ergebnisse</div>';
    } else {
      dropdown.innerHTML = results.map(r => `
        <div class="search-result-item" data-card-id="${r.id}">
          <div style="width:10px;height:10px;border-radius:50%;background:${r.group_color || '#ccc'};flex-shrink:0"></div>
          <div>
            <div class="search-result-title">${escapeHtml(r.title)}${r.archived ? ' <span style="color:var(--text-muted)">[Archiv]</span>' : ''}</div>
            <div class="search-result-meta">${escapeHtml(r.group_name || '')} / ${escapeHtml(r.column_name || '')}${r.customer_name ? ' — ' + escapeHtml(r.customer_name) : ''}${r.order_number ? ' — #' + escapeHtml(r.order_number) : ''}</div>
          </div>
        </div>
      `).join('');
    }

    dropdown.classList.remove('hidden');
    dropdown.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        openCard(item.dataset.cardId);
        dropdown.classList.add('hidden');
        document.getElementById('search-input').value = '';
      });
    });
  } catch (e) { /* ignore */ }
}

// ===== Password Change =====
document.getElementById('change-password-btn').addEventListener('click', () => {
  document.getElementById('user-dropdown').classList.add('hidden');
  document.getElementById('password-modal').classList.remove('hidden');
});
document.getElementById('password-modal-close').addEventListener('click', () => {
  document.getElementById('password-modal').classList.add('hidden');
});
document.getElementById('password-modal-cancel').addEventListener('click', () => {
  document.getElementById('password-modal').classList.add('hidden');
});
document.getElementById('password-modal-backdrop').addEventListener('click', () => {
  document.getElementById('password-modal').classList.add('hidden');
});

document.getElementById('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPw = document.getElementById('current-password').value;
  const newPw = document.getElementById('new-password').value;
  const confirmPw = document.getElementById('confirm-password').value;
  const errorEl = document.getElementById('password-error');

  if (newPw !== confirmPw) {
    errorEl.textContent = 'Passwörter stimmen nicht überein';
    errorEl.classList.remove('hidden');
    return;
  }
  errorEl.classList.add('hidden');

  try {
    await apiFetch(`/api/users/${currentUser.id}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password: newPw, current_password: currentPw }),
    });
    showToast('Passwort erfolgreich geändert', 'success');
    document.getElementById('password-modal').classList.add('hidden');
    document.getElementById('password-form').reset();
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.classList.remove('hidden');
  }
});

// ===== Utility Functions =====
window.escapeHtml = function(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

window.formatDate = function(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

window.formatDateShort = function(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

window.isOverdue = function(card) {
  if (card.due_date) {
    const due = new Date(card.due_date);
    if (due < new Date()) return true;
  }
  return false;
};

window.formatFileSize = function(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

// ===== Init =====
async function init() {
  try {
    const me = await fetch('/api/auth/me');
    if (me.status === 401) {
      showLogin();
      return;
    }
    const data = await me.json();
    if (data.id) {
      showApp(data, data.settings || {});
    } else {
      showLogin();
    }
  } catch (e) {
    showLogin();
  }
}

// Apply theme from storage before full load
const savedPrimary = document.documentElement.style.getPropertyValue('--primary');

init();
