// YoCapi App - Admin (API Log Viewer)
// Runs on /admin/index.html - requires Supabase auth

// ===== DOM =====
const $ = (s) => document.querySelector(s);

const channelInput = $('#channel-input');
const userInput = $('#user-input');
const daySelect = $('#day-select');
const monthSelect = $('#month-select');
const yearSelect = $('#year-select');
const btnLoad = $('#btn-load');
const emptyState = $('#empty-state');
const loadingState = $('#loading-state');
const errorState = $('#error-state');
const errorTitle = $('#error-title');
const errorDesc = $('#error-desc');
const messagesList = $('#messages-list');
const filterRow = $('#filter-row');
const filterInput = $('#filter-input');
const filterCount = $('#filter-count');
const statMessages = $('#stat-messages');
const statCount = $('#stat-count');
const navBar = $('#nav-bar');
const navPrev = $('#nav-prev');
const navNext = $('#nav-next');
const navPos = $('#nav-pos');
const navSort = $('#nav-sort');
const navDeleteDay = $('#nav-delete-day');
const btnHistory = $('#btn-history');
const dateSwitch = $('#date-mode-switch');
const toggleLabel = $('#toggle-label');
const dayCol = document.querySelector('.day-col');
const downloadModal = $('#download-modal');
const downloadClose = $('#download-close');

// ===== State =====
let allMessages = [];
let filteredMessages = [];
let navIndex = 0;
let sortAscending = true;
let _currentLoadedDateKey = null; // 'YYYY-MM-DD' of the last successfully loaded day

const RENDER_PAGE = 300;
let _renderEnd = 0;
let _renderObserver = null;

// Customizer state (reused from original)
let _custMsg = null;
let _custOriginalMsg = null;
let _custOriginalColor = null;
let _custEmotes = [];
let _custBadgeImages = [];
let _custSegments = [];
let _custTimer = null;
let _custAnimRaf = null;
let _custAnimStart = null;
let _custEventHubAvatar = null;
let _custSettings = { accentColor: '#9146ff', bgStyle: 'light', fontSize: 16, showBorder: false, borderWidth: 2 };
let _isRecording = false;

// ===== Init =====
async function init() {
  const session = await checkAuth();
  if (!session) return;

  document.getElementById('logs-panel').style.display = 'flex';

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  for (let y = currentYear; y >= 2020; y--) {
    const opt = document.createElement('option');
    opt.value = y; opt.textContent = y;
    yearSelect.appendChild(opt);
  }

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  function updateMonthOptions() {
    const selectedYear = parseInt(yearSelect.value, 10);
    const maxMonth = (selectedYear === currentYear) ? currentMonth : 12;
    const currentSelectedMonth = monthSelect.value;
    monthSelect.innerHTML = '';
    for (let m = 1; m <= maxMonth; m++) {
      const opt = document.createElement('option');
      const val = String(m).padStart(2, '0');
      opt.value = val; opt.textContent = monthNames[m - 1];
      monthSelect.appendChild(opt);
    }
    if (currentSelectedMonth && parseInt(currentSelectedMonth, 10) <= maxMonth) {
      monthSelect.value = currentSelectedMonth;
    } else {
      monthSelect.value = String(maxMonth).padStart(2, '0');
    }
    updateDayOptions();
  }

  function updateDayOptions() {
    const selectedYear = parseInt(yearSelect.value, 10);
    const selectedMonth = parseInt(monthSelect.value, 10);
    const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
    const currentSelectedDay = daySelect.value;
    daySelect.innerHTML = '';
    for (let d = 1; d <= daysInMonth; d++) {
      const opt = document.createElement('option');
      const val = String(d).padStart(2, '0');
      opt.value = val; opt.textContent = val;
      daySelect.appendChild(opt);
    }
    if (currentSelectedDay && parseInt(currentSelectedDay, 10) <= daysInMonth) {
      daySelect.value = currentSelectedDay;
    } else {
      const today = new Date();
      if (selectedYear === today.getFullYear() && selectedMonth === (today.getMonth() + 1)) {
        daySelect.value = String(today.getDate()).padStart(2, '0');
      } else {
        daySelect.value = '01';
      }
    }
  }

  yearSelect.addEventListener('change', updateMonthOptions);
  monthSelect.addEventListener('change', updateDayOptions);
  updateMonthOptions();

  btnLoad.addEventListener('click', loadLogs);
  filterInput.addEventListener('input', debounce(applyFilter, 200));
  [channelInput, userInput, daySelect, yearSelect, monthSelect].forEach(inp =>
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') loadLogs(); })
  );

  navPrev.addEventListener('click', () => navigateTo(navIndex - 1));
  navNext.addEventListener('click', () => navigateTo(navIndex + 1));
  navSort.addEventListener('click', () => {
    sortAscending = !sortAscending;
    allMessages.reverse();
    applyFilter();
    navSort.style.color = sortAscending ? '' : 'var(--purple-lt)';
    navSort.style.borderColor = sortAscending ? '' : 'var(--purple)';
  });

  if (navDeleteDay) {
    navDeleteDay.addEventListener('click', async () => {
      const channel = channelInput.value.trim().toLowerCase();
      if (!channel || !_currentLoadedDateKey) return;
      const confirmed = confirm(`¿Eliminar el día ${_currentLoadedDateKey} de ${channel} de la base de datos?\n\nLa próxima vez que se cargue ese día, se descargará automáticamente de la API.`);
      if (!confirmed) return;
      navDeleteDay.disabled = true;
      navDeleteDay.textContent = 'Eliminando...';
      const res = typeof deleteLogDay === 'function' ? await deleteLogDay(channel, _currentLoadedDateKey) : { ok: false };
      navDeleteDay.disabled = false;
      navDeleteDay.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg> Eliminar día`;
      if (res.ok) {
        showToast ? showToast('Día eliminado de la BD', 'ok') : alert('Día eliminado correctamente.');
        _currentLoadedDateKey = null;
        navDeleteDay.style.display = 'none';
      } else {
        showToast ? showToast('Error al eliminar: ' + (res.error || ''), 'error') : alert('Error: ' + (res.error || 'desconocido'));
      }
    });
  }

  function applyDateMode() {
    const isDayMode = dateSwitch.checked;
    if (dayCol) dayCol.classList.toggle('hidden', !isDayMode);
    if (toggleLabel) {
      toggleLabel.textContent = isDayMode ? 'Por día' : 'Por mes';
      toggleLabel.classList.toggle('off', !isDayMode);
    }
  }
  applyDateMode();
  dateSwitch.addEventListener('change', applyDateMode);

  btnHistory.addEventListener('click', openHistoryModal);
  document.getElementById('history-close')?.addEventListener('click', closeHistoryModal);
  document.getElementById('history-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('history-modal')) closeHistoryModal();
  });

  if (downloadClose) downloadClose.addEventListener('click', closeDownloadModal);
  if (downloadModal) downloadModal.addEventListener('click', e => {
    if (e.target === downloadModal) closeDownloadModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && downloadModal && downloadModal.style.display !== 'none') closeDownloadModal();
  });

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); navigateTo(navIndex - 1); }
    if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); navigateTo(navIndex + 1); }
    if (e.key === 'Home') { e.preventDefault(); navigateTo(0); }
    if (e.key === 'End') { e.preventDefault(); navigateTo(filteredMessages.length - 1); }
  });

  // Logout
  document.getElementById('btn-logout')?.addEventListener('click', signOut);

  initCustomizer();
}

// ===== Log Loading =====
async function loadLogs() {
  const channel = channelInput.value.trim().toLowerCase();
  const user = userInput.value.trim();
  const isDayMode = dateSwitch ? dateSwitch.checked : true;
  const year = yearSelect.value;
  const month = monthSelect.value;
  const day = daySelect.value;
  const dateVal = isDayMode ? `${year}-${month}-${day}` : `${year}-${month}`;

  if (!channel) { showError('Canal requerido', 'Ingresa el nombre del canal'); channelInput.focus(); return; }
  if (!year || !month) { showError('Fecha requerida', 'Selecciona mes y año'); return; }
  if (isDayMode && !day) { showError('Fecha requerida', 'Selecciona un día'); daySelect.focus(); return; }

  showLoading();
  btnLoad.classList.add('loading');

  try {
    let data = null;

    // Helper fetch
    const fetchApi = async (url) => {
      const resp = await fetch(url);
      if (!resp.ok) {
        if (resp.status === 404 || resp.status === 400) return { messages: [] };
        throw new Error(`Error ${resp.status}: ${resp.statusText}`);
      }
      return await resp.json();
    };

    if (isDayMode && !user) {
      // --- Day mode (no user filter): Supabase + API merged ---
      const dateStr = `${year}-${month}-${day}`;
      const supabaseData = typeof getSavedLog === 'function' ? await getSavedLog(channel, dateStr) : null;
      const supabaseMsgs = (supabaseData && supabaseData.messages) ? supabaseData.messages : [];

      let lastSupabaseTs = 0;
      for (const m of supabaseMsgs) {
        const t = new Date(m.timestamp).getTime();
        if (t > lastSupabaseTs) lastSupabaseTs = t;
      }

      let apiMsgs = [];
      try {
        const localStart = new Date(year, parseInt(month) - 1, parseInt(day), 0, 0, 0);
        const localEnd   = new Date(year, parseInt(month) - 1, parseInt(day), 23, 59, 59, 999);
        const utcDay1 = { y: localStart.getUTCFullYear(), m: localStart.getUTCMonth() + 1, d: localStart.getUTCDate() };
        const utcDay2 = { y: localEnd.getUTCFullYear(),   m: localEnd.getUTCMonth() + 1,   d: localEnd.getUTCDate() };
        const urlsToFetch = [`${API_BASE}/channel/${channel}/${utcDay1.y}/${utcDay1.m}/${utcDay1.d}?json=1`];
        if (utcDay1.y !== utcDay2.y || utcDay1.m !== utcDay2.m || utcDay1.d !== utcDay2.d) {
          urlsToFetch.push(`${API_BASE}/channel/${channel}/${utcDay2.y}/${utcDay2.m}/${utcDay2.d}?json=1`);
        }
        const results = await Promise.all(urlsToFetch.map(url => fetchApi(url)));
        for (const res of results) {
          if (res && res.messages) apiMsgs = apiMsgs.concat(res.messages);
        }
        apiMsgs = apiMsgs.filter(msg => {
          const d2 = new Date(msg.timestamp);
          return d2.getFullYear() === parseInt(year, 10) &&
            d2.getMonth() === parseInt(month, 10) - 1 &&
            d2.getDate() === parseInt(day, 10);
        });
      } catch (apiErr) {
        console.warn('[Admin loadLogs] API fetch failed, using Supabase only:', apiErr.message);
      }

      const combined = [...supabaseMsgs, ...apiMsgs];
      const seenIds = new Set();
      const merged = combined.filter(msg => {
        const id = msg.tags?.id || msg.timestamp + msg.displayName + msg.text;
        if (seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
      });
      merged.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      const lastMergedTs = merged.length ? new Date(merged[merged.length - 1].timestamp).getTime() : 0;
      if ((merged.length > supabaseMsgs.length || lastMergedTs > lastSupabaseTs) && typeof saveLogsLocallySupabase === 'function') {
        saveLogsLocallySupabase(channel, dateStr, merged).catch(console.error);
      }

      data = { messages: merged };

    } else if (user) {
      // --- User search: always from Zonian API ---
      const apiUrl = `${API_BASE}/channel/${channel}/user/${user}/${year}/${parseInt(month)}?json=1`;
      data = await fetchApi(apiUrl);

    } else {
      // --- Month mode: from Zonian API ---
      const apiUrl = `${API_BASE}/channel/${channel}/${year}/${parseInt(month)}?json=1`;
      data = await fetchApi(apiUrl);
    }

    if (!data || !data.messages || data.messages.length === 0) {
      const userText = user ? `de ${user} ` : '';
      showError('Sin mensajes', `No hay mensajes ${userText}en #${channel} para ${dateVal}`);
      return;
    }

    const firstRoomId = data.messages[0]?.tags?.['room-id'];
    if (firstRoomId && (firstRoomId !== channelId || Object.keys(thirdPartyEmotes).length === 0)) {
      channelId = firstRoomId;
      await Promise.all([loadBadges(channelId), loadThirdPartyEmotes(channelId)]);
    } else if (!firstRoomId && Object.keys(thirdPartyEmotes).length === 0) {
      await ensureThirdPartyEmotesByName(channel);
    }

    let targetMessages = data.messages;
    if (user && isDayMode) {
      targetMessages = targetMessages.filter(msg => {
        const msgDate = new Date(msg.timestamp);
        return msgDate.getDate() === parseInt(day, 10);
      });
      if (targetMessages.length === 0) {
        showError('Sin mensajes', `No hay mensajes de ${user} en #${channel} para el ${dateVal}`);
        return;
      }
    }

    allMessages = targetMessages;
    if (!sortAscending) allMessages.reverse();
    filteredMessages = [...allMessages];
    renderMessages(filteredMessages);
    showMessages();
    updateStats(filteredMessages.length);

    // Show delete-day button if this is an exact day loaded from Supabase/API
    if (isDayMode && navDeleteDay) {
      _currentLoadedDateKey = dateVal; // 'YYYY-MM-DD'
      navDeleteDay.style.display = 'inline-flex';
    } else if (navDeleteDay) {
      navDeleteDay.style.display = 'none';
      _currentLoadedDateKey = null;
    }

    // Save user to search history via Supabase
    if (user && filteredMessages.length > 0) {
      const key = user.toLowerCase();
      const displayName = filteredMessages[0]?.displayName || user;
      if (typeof upsertSearchHistory === 'function') {
        await upsertSearchHistory(key, displayName);
      }
      if (typeof getSearchHistory === 'function') {
        userHistory = {};
        const history = await getSearchHistory();
        for (const entry of history) {
          userHistory[entry.username] = { displayName: entry.display_name, count: entry.search_count };
        }
      }
    }
  } catch (err) {
    console.error(err);
    showError('Error al cargar', err.message || 'No se pudieron cargar los mensajes.');
  } finally {
    btnLoad.classList.remove('loading');
  }
}

// ===== Rendering (same as public but using local utils) =====
function buildMessagesFrag(messages, from, to, lastDayRef) {
  const frag = document.createDocumentFragment();
  for (let i = from; i < to && i < messages.length; i++) {
    const msg = messages[i];
    const date = new Date(msg.timestamp);
    const dayKey = date.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    let isGrouped = false;
    if (dayKey !== lastDayRef.v) {
      lastDayRef.v = dayKey;
      frag.appendChild(createDaySeparator(dayKey));
    } else if (i > 0) {
      const prevMsg = messages[i - 1];
      if (prevMsg && prevMsg.displayName === msg.displayName) {
        if (date.getTime() - new Date(prevMsg.timestamp).getTime() < 60000) isGrouped = true;
      }
    }
    frag.appendChild(createMessageRow(msg, date, isGrouped));
  }
  return frag;
}

function renderMessages(messages) {
  if (_renderObserver) { _renderObserver.disconnect(); _renderObserver = null; }
  messagesList.innerHTML = '';
  _renderEnd = 0;
  if (messages.length === 0) return;
  const lastDay = { v: '' };
  const end = Math.min(RENDER_PAGE, messages.length);
  messagesList.appendChild(buildMessagesFrag(messages, 0, end, lastDay));
  _renderEnd = end;
  if (_renderEnd < messages.length) _attachSentinel(messages, lastDay);
}

function _attachSentinel(messages, lastDay) {
  const old = document.getElementById('render-sentinel');
  if (old) old.remove();
  const sentinel = document.createElement('div');
  sentinel.id = 'render-sentinel';
  sentinel.style.cssText = 'height:1px;width:100%;';
  messagesList.appendChild(sentinel);
  _renderObserver = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    const from = _renderEnd;
    const to = Math.min(_renderEnd + RENDER_PAGE, messages.length);
    sentinel.remove();
    messagesList.appendChild(buildMessagesFrag(messages, from, to, lastDay));
    _renderEnd = to;
    if (_renderEnd < messages.length) {
      messagesList.appendChild(sentinel);
    } else {
      _renderObserver.disconnect();
      _renderObserver = null;
    }
  }, { root: messagesList.closest('.messages-wrap') || null, rootMargin: '200px' });
  _renderObserver.observe(sentinel);
}

function createDaySeparator(text) {
  const d = document.createElement('div');
  d.className = 'day-separator';
  d.innerHTML = `<div class="day-sep-line"></div><span class="day-sep-text">${escapeHtml(text)}</span><div class="day-sep-line"></div>`;
  return d;
}

function createMessageRow(msg, date, isGrouped = false) {
  const row = document.createElement('div');
  row.className = 'msg-row';
  if (isGrouped) row.classList.add('is-grouped');
  const timeStr = date.toLocaleString('es-MX', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const badgesEl = buildBadgesEl(msg.tags);
  const color = sanitizeColor(msg.tags?.color);
  const filterVal = filterInput.value.trim();
  const bodyEl = buildMessageBody(msg, filterVal);
  const timeEl = document.createElement('span');
  timeEl.className = 'msg-time';
  timeEl.textContent = timeStr;
  const metaEl = document.createElement('span');
  metaEl.className = 'msg-meta';
  const userEl = document.createElement('span');
  userEl.className = 'msg-user';
  userEl.style.color = color;
  userEl.innerHTML = filterVal ? highlightText(escapeHtml(msg.displayName), filterVal) : escapeHtml(msg.displayName);
  const colonEl = document.createElement('span');
  colonEl.className = 'msg-colon';
  colonEl.textContent = ':';
  const dlBtn = document.createElement('button');
  dlBtn.className = 'msg-download-btn';
  dlBtn.title = 'Descargar mensaje como imagen';
  dlBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
  dlBtn.onclick = () => {
    if (typeof downloadMessageCard === 'function') downloadMessageCard(msg, color);
    else openDownloadModal(msg, color);
  };
  metaEl.appendChild(badgesEl);
  metaEl.appendChild(userEl);
  metaEl.appendChild(colonEl);
  row.appendChild(timeEl);
  row.appendChild(metaEl);
  row.appendChild(bodyEl);
  row.appendChild(dlBtn);
  return row;
}

// ===== Filter & Navigation =====
function applyFilter() {
  const query = normalizeStr(filterInput.value.trim());
  filteredMessages = query
    ? allMessages.filter(m =>
        normalizeStr(m.text).includes(query) || normalizeStr(m.displayName).includes(query)
      )
    : [...allMessages];
  filterCount.textContent = `${filteredMessages.length.toLocaleString()} / ${allMessages.length.toLocaleString()}`;
  renderMessages(filteredMessages);
  updateStats(filteredMessages.length);
  if (navBar.style.display !== 'none') resetNav();
}

function navigateTo(idx) {
  if (filteredMessages.length === 0) return;
  idx = Math.max(0, Math.min(filteredMessages.length - 1, idx));
  navIndex = idx;
  if (idx >= _renderEnd) {
    if (_renderObserver) { _renderObserver.disconnect(); _renderObserver = null; }
    const sentinel = document.getElementById('render-sentinel');
    if (sentinel) sentinel.remove();
    const lastDay = { v: _lastRenderedDay() };
    const to = Math.min(idx + 1, filteredMessages.length);
    messagesList.appendChild(buildMessagesFrag(filteredMessages, _renderEnd, to, lastDay));
    _renderEnd = to;
    if (_renderEnd < filteredMessages.length) _attachSentinel(filteredMessages, lastDay);
  }
  document.querySelectorAll('.msg-row.nav-highlight').forEach(el => el.classList.remove('nav-highlight'));
  const rows = messagesList.querySelectorAll('.msg-row');
  if (rows[idx]) { rows[idx].classList.add('nav-highlight'); rows[idx].scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  navPos.innerHTML = `<strong>${(idx + 1).toLocaleString()}</strong> / ${filteredMessages.length.toLocaleString()}`;
  navPrev.disabled = idx === 0; navPrev.style.opacity = idx === 0 ? '.4' : '1';
  navNext.disabled = idx === filteredMessages.length - 1; navNext.style.opacity = idx === filteredMessages.length - 1 ? '.4' : '1';
}

function _lastRenderedDay() {
  const seps = messagesList.querySelectorAll('.day-sep-text');
  return seps.length ? seps[seps.length - 1].textContent : '';
}

function resetNav() {
  navIndex = 0;
  navPos.innerHTML = `<strong>1</strong> / ${filteredMessages.length.toLocaleString()}`;
  navPrev.disabled = true;
  navPrev.style.opacity = '.4';
  navNext.disabled = filteredMessages.length <= 1;
  navNext.style.opacity = filteredMessages.length <= 1 ? '.4' : '1';
}

// ===== History Modal =====
function openHistoryModal() {
  renderHistoryList();
  document.getElementById('history-modal').style.display = 'flex';
}
function closeHistoryModal() {
  document.getElementById('history-modal').style.display = 'none';
}
function renderHistoryList() {
  const entries = Object.values(userHistory).sort((a, b) => b.count - a.count);
  const list = document.getElementById('history-list');
  if (entries.length === 0) {
    list.innerHTML = '<p class="history-empty">No hay usuarios en el historial aún.</p>';
    return;
  }
  list.innerHTML = '';
  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `<div class="history-username"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>${escapeHtml(entry.displayName)}</div><span class="history-count">${entry.count} ${entry.count === 1 ? 'búsqueda' : 'búsquedas'}</span>`;
    item.addEventListener('click', () => {
      userInput.value = entry.displayName;
      closeHistoryModal();
      userInput.focus();
    });
    list.appendChild(item);
  }
}

// ===== UI States =====
function showLoading() {
  emptyState.style.display = 'none'; errorState.style.display = 'none';
  messagesList.style.display = 'none'; filterRow.style.display = 'none';
  loadingState.style.display = 'flex'; statMessages.style.display = 'none'; navBar.style.display = 'none';
  if (navDeleteDay) navDeleteDay.style.display = 'none';
}
function showMessages() {
  emptyState.style.display = 'none'; errorState.style.display = 'none';
  loadingState.style.display = 'none'; messagesList.style.display = 'block';
  filterRow.style.display = 'block'; statMessages.style.display = 'flex'; navBar.style.display = 'flex';
  resetNav();
}
function showError(title, desc) {
  emptyState.style.display = 'none'; loadingState.style.display = 'none';
  messagesList.style.display = 'none'; filterRow.style.display = 'none';
  statMessages.style.display = 'none'; navBar.style.display = 'none';
  if (navDeleteDay) navDeleteDay.style.display = 'none';
  errorTitle.textContent = title; errorDesc.textContent = desc;
  errorState.style.display = 'flex';
}
function updateStats(n) { statCount.textContent = n.toLocaleString(); }

// ===== Toast =====
function showToast(msg, type = 'ok') {
  const existing = document.getElementById('toast-notification');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'toast-notification';
  t.className = `toast toast--${type}`;
  t.innerHTML = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast--show'));
  setTimeout(() => { t.classList.remove('toast--show'); setTimeout(() => t.remove(), 400); }, 3000);
}

// ===== Customizer (simplified for admin) =====
function initCustomizer() {
  const COLOR_PRESETS = [
    { hex: '#9146ff', label: 'Twitch' }, { hex: '#ff4dd2', label: 'Rosa' },
    { hex: '#4ade80', label: 'Verde' }, { hex: '#60a5fa', label: 'Azul' },
    { hex: '#fb923c', label: 'Naranja' }, { hex: '#facc15', label: 'Dorado' },
    { hex: '#f87171', label: 'Rojo' }, { hex: '#a78bfa', label: 'Lavanda' },
  ];
  const swatchesEl = document.getElementById('color-swatches');
  if (swatchesEl) {
    COLOR_PRESETS.forEach(({ hex, label }) => {
      const btn = document.createElement('button');
      btn.className = 'color-swatch'; btn.style.background = hex; btn.title = label; btn.dataset.hex = hex;
      btn.addEventListener('click', () => {
        _custSettings.accentColor = hex;
        document.getElementById('custom-color-picker').value = hex;
        setActiveSwatch(hex); scheduleRender();
      });
      swatchesEl.appendChild(btn);
    });
  }
  document.getElementById('custom-color-picker')?.addEventListener('input', e => {
    _custSettings.accentColor = e.target.value; setActiveSwatch(null); scheduleRender();
  });
  document.querySelectorAll('.bg-options .bg-opt:not(.tpl-opt)').forEach(btn => {
    btn.addEventListener('click', () => {
      _custSettings.bgStyle = btn.dataset.bg;
      document.querySelectorAll('.bg-options .bg-opt:not(.tpl-opt)').forEach(b => b.classList.toggle('active', b === btn));
      scheduleRender();
    });
  });
  document.getElementById('bg-opt-light')?.classList.add('active');
  const borderSwitch = document.getElementById('border-mode-switch');
  const borderContainer = document.getElementById('border-width-container');
  const borderVal = document.getElementById('border-width-val');
  if (borderSwitch) {
    borderSwitch.addEventListener('change', e => {
      _custSettings.showBorder = e.target.checked;
      if (borderContainer) borderContainer.style.display = e.target.checked ? 'flex' : 'none';
      if (borderVal) borderVal.style.display = e.target.checked ? 'inline' : 'none';
      scheduleRender();
    });
  }
  const borderSlider = document.getElementById('border-width-slider');
  if (borderSlider) {
    borderSlider.addEventListener('input', () => {
      _custSettings.borderWidth = parseInt(borderSlider.value);
      if (borderVal) borderVal.textContent = `· ${borderSlider.value}px`;
      scheduleRender();
    });
  }
  const slider = document.getElementById('font-size-slider');
  const sizeVal = document.getElementById('font-size-val');
  slider?.addEventListener('input', () => {
    _custSettings.fontSize = parseInt(slider.value);
    if (sizeVal) sizeVal.textContent = slider.value + 'px';
    scheduleRender();
  });
  document.getElementById('eh-hide-title')?.addEventListener('change', () => scheduleRender());
  document.getElementById('eh-strip-qs')?.addEventListener('change', () => {
    if (_custOriginalMsg) openDownloadModal(_custOriginalMsg, _custOriginalColor);
  });
  document.getElementById('btn-dl-final')?.addEventListener('click', () => {
    if (_isRecording) return;
    _isRecording = true;
    const canvas = document.getElementById('preview-canvas');
    if (!canvas) { _isRecording = false; return; }
    const a = document.createElement('a');
    a.download = _custMsg ? `twitch-${_custMsg.displayName}-${new Date(_custMsg.timestamp).getTime()}.png` : `twitch-image-${Date.now()}.png`;
    a.href = canvas.toDataURL('image/png');
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    _isRecording = false;
    closeDownloadModal();
  });
}

function setActiveSwatch(hex) {
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('active', hex !== null && s.dataset.hex === hex));
}

function scheduleRender(ms = 30) {
  clearTimeout(_custTimer);
  _custTimer = setTimeout(renderCustomizerCanvas, ms);
}

async function openDownloadModal(msg, color) {
  _custOriginalMsg = msg;
  _custOriginalColor = color;
  const stripQs = document.getElementById('eh-strip-qs');
  if (stripQs && stripQs.checked && msg.text) {
    const t = msg.text;
    if (t.toLowerCase().startsWith('!s ')) msg = Object.assign({}, msg, { text: t.substring(3).trimStart() });
    else if (t.toLowerCase().startsWith('!s')) msg = Object.assign({}, msg, { text: t.substring(2).trimStart() });
  }
  _custMsg = msg;
  const userColor = sanitizeColor(color);
  if (downloadModal) {
    const box = downloadModal.querySelector('.customizer-box');
    if (box) box.classList.remove('is-follower-card');
  }
  _custSettings.accentColor = userColor; _custSettings.bgStyle = 'light'; _custSettings.fontSize = 16;
  _custSettings.showBorder = false; _custSettings.borderWidth = 2;
  const picker = document.getElementById('custom-color-picker');
  if (picker) picker.value = userColor;
  const slider = document.getElementById('font-size-slider');
  if (slider) slider.value = 16;
  const sizeVal = document.getElementById('font-size-val');
  if (sizeVal) sizeVal.textContent = '16px';
  const borderSwitch = document.getElementById('border-mode-switch');
  if (borderSwitch) borderSwitch.checked = false;
  const borderContainer = document.getElementById('border-width-container');
  if (borderContainer) borderContainer.style.display = 'none';
  const borderVal = document.getElementById('border-width-val');
  if (borderVal) { borderVal.style.display = 'none'; borderVal.textContent = '· 2px'; }
  const borderSlider = document.getElementById('border-width-slider');
  if (borderSlider) borderSlider.value = 2;
  document.querySelectorAll('.bg-options .bg-opt').forEach(b => b.classList.toggle('active', b.dataset.bg === 'light'));
  const preset = COLOR_PRESETS.find(p => p.hex.toLowerCase() === userColor.toLowerCase());
  setActiveSwatch(preset ? userColor : null);
  document.querySelectorAll('.customizer-controls .ctrl-section').forEach(el => {
    if (el.id === 'follower-template-section') el.style.display = 'none';
    else if (el.id === 'tts-controls-section') el.style.display = 'none';
    else el.style.display = 'flex';
  });
  const btnDlVideo = document.getElementById('btn-dl-video');
  if (btnDlVideo) btnDlVideo.style.display = 'none';
  const wrap = document.querySelector('.preview-canvas-wrap');
  if (wrap) wrap.innerHTML = '<div class="customizer-loading"><div class="loading-spinner"></div><span>Cargando...</span></div>';
  if (downloadModal) downloadModal.style.display = 'flex';
  if (msg.avatarUrl) _custEventHubAvatar = await loadImage(msg.avatarUrl);
  _custBadgeImages = [];
  if (msg.tags?.badges) {
    const pairs = msg.tags.badges.split(',').filter(Boolean);
    for (const pair of pairs) {
      const cached = badgeCache[pair];
      if (cached?.url) {
        _custBadgeImages.push({ pair, img: await loadImage(cached.url), title: cached.title || '' });
      } else {
        _custBadgeImages.push({ pair, img: null, title: '' });
      }
    }
  }
  const text = msg.text || '';
  const emotesTag = msg.tags?.emotes || '';
  const emoteMap = [];
  if (emotesTag) {
    for (const chunk of emotesTag.split('/')) {
      const [id, pos] = chunk.split(':');
      if (!pos) continue;
      for (const p of pos.split(',')) {
        const [s, e] = p.split('-').map(Number);
        emoteMap.push({ start: s, end: e, id });
      }
    }
    emoteMap.sort((a, b) => a.start - b.start);
  }
  _custEmotes = await Promise.all(emoteMap.map(em => loadEmoteWithFrames(EMOTE_URL(em.id, '2.0'))));
  _custSegments = [];
  let cursor = 0;
  const characters = Array.from(text);
  async function appendTextWithThirdPartySegments(rawText) {
    if (!rawText) return;
    const hasTp = Object.keys(thirdPartyEmotes).length > 0;
    const hasTwitchIds = window.twitchEmoteIds && Object.keys(window.twitchEmoteIds).length > 0;
    if (!hasTp && !hasTwitchIds) { _custSegments.push({ type: 'text', value: rawText }); return; }
    const tokens = rawText.split(/(\s+)/);
    for (const token of tokens) {
      if (/^\s+$/.test(token) || token === '') { _custSegments.push({ type: 'text', value: token }); continue; }
      const tpUrl = thirdPartyEmotes[token];
      if (tpUrl) {
        const obj = await loadEmoteWithFrames(tpUrl);
        _custSegments.push({ type: 'emote', img: obj.img, animData: obj, alt: token });
      } else if (window.twitchEmoteIds && window.twitchEmoteIds[token]) {
        const obj = await loadEmoteWithFrames(EMOTE_URL(window.twitchEmoteIds[token], '2.0'));
        _custSegments.push({ type: 'emote', img: obj.img, animData: obj, alt: token });
      } else {
        _custSegments.push({ type: 'text', value: token });
      }
    }
  }
  for (let i = 0; i < emoteMap.length; i++) {
    const em = emoteMap[i];
    if (em.start > cursor) await appendTextWithThirdPartySegments(characters.slice(cursor, em.start).join(''));
    const obj = _custEmotes[i];
    _custSegments.push({ type: 'emote', img: obj.img, animData: obj, alt: characters.slice(em.start, em.end + 1).join('') });
    cursor = em.end + 1;
  }
  if (cursor < characters.length) await appendTextWithThirdPartySegments(characters.slice(cursor).join(''));
  if (wrap) wrap.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.id = 'preview-canvas';
  if (wrap) wrap.appendChild(canvas);
  const hasAnimated = _custSegments.some(s => s.animData && s.animData.type === 'animated');
  if (_custAnimRaf !== null) { cancelAnimationFrame(_custAnimRaf); _custAnimRaf = null; }
  if (hasAnimated) {
    _custAnimStart = performance.now();
    function _previewLoop(now) {
      renderCustomizerCanvas(now - _custAnimStart);
      _custAnimRaf = requestAnimationFrame(_previewLoop);
    }
    _custAnimRaf = requestAnimationFrame(_previewLoop);
  } else {
    renderCustomizerCanvas();
  }
}

function renderCustomizerCanvas(timeMs = 0, targetCanvas = null) {
  const canvas = targetCanvas || document.getElementById('preview-canvas');
  if (!canvas || !_custMsg) return;
  const { accentColor, bgStyle, fontSize, showBorder, borderWidth } = _custSettings;
  let headerBg, headerText, bodyBg, bodyText, bodyBorder, headerBorder;
  if (bgStyle === 'light') { headerBg = accentColor; headerText = '#ffffff'; bodyBg = '#ffffff'; bodyText = '#111111'; }
  else { headerBg = accentColor; headerText = '#ffffff'; bodyBg = '#1e1e24'; bodyText = '#f2f2ff'; }
  if (showBorder) { bodyBorder = accentColor; headerBorder = accentColor; }
  const DPR = 2;
  const FONT_SIZE = fontSize * DPR;
  const HEADER_FONT = Math.round(14 * DPR);
  const PADDING = 30 * DPR;
  const HEADER_PAD_H = 16 * DPR;
  const HEADER_PAD_V = 8 * DPR;
  const BODY_PAD = 24 * DPR;
  const BODY_PAD_TOP = 30 * DPR;
  const BADGE_SIZE = 22 * DPR;
  const EMOTE_SIZE = Math.round(fontSize * 2 * DPR);
  const BADGE_GAP = 4 * DPR;
  const EMOTE_GAP = 8 * DPR;
  const MAX_BODY_W = 420 * DPR;
  const HEADER_RADIUS = 20 * DPR;
  const BODY_RADIUS = 24 * DPR;
  const HEADER_OVERLAP = 15 * DPR;
  const HEADER_LEFT_MG = 20 * DPR;
  const LINE_HEIGHT = 1.5;
  const mc = document.createElement('canvas').getContext('2d');
  mc.font = `800 ${HEADER_FONT}px Inter, sans-serif`;
  const badgesW = _custBadgeImages.reduce((sum, b) => b.img ? sum + BADGE_SIZE + BADGE_GAP : sum, 0);
  const headerContentW = badgesW + mc.measureText(_custMsg.displayName).width;
  const headerW = headerContentW + HEADER_PAD_H * 2;
  const headerH = Math.max(BADGE_SIZE, HEADER_FONT) + HEADER_PAD_V * 2;
  mc.font = `700 ${FONT_SIZE}px Inter, sans-serif`;
  const bodyContentW = MAX_BODY_W - BODY_PAD * 2;
  let renderSegs = _custSegments;
  const showTitle = document.getElementById('eh-hide-title')?.checked;
  if (!showTitle) {
    const newSegs = []; let foundNl = false;
    for (let i = 0; i < renderSegs.length; i++) {
      const s = renderSegs[i];
      if (!foundNl) {
        if (s.type === 'text') {
          const nlPos = s.value.indexOf('\n');
          if (nlPos !== -1) { const after = s.value.slice(nlPos + 1); if (after) newSegs.push(Object.assign({}, s, { value: after })); foundNl = true; }
        }
      } else { newSegs.push(s); }
    }
    if (foundNl && newSegs.length > 0 && newSegs[0].type === 'text') {
      newSegs[0] = Object.assign({}, newSegs[0], { value: newSegs[0].value.replace(/^[ \t]+/, '') });
      if (newSegs[0].value.length > 0 && newSegs[0].value[0] >= 'a' && newSegs[0].value[0] <= 'z') newSegs[0].value = newSegs[0].value[0].toUpperCase() + newSegs[0].value.slice(1);
    }
    renderSegs = newSegs;
  }
  function wrapSegs(segs) {
    const lineH = Math.round(FONT_SIZE * LINE_HEIGHT);
    const lines = []; let line = [], lw = 0;
    function forceNewLine() { if (line.length) { lines.push(line); line = []; lw = 0; } }
    for (const seg of segs) {
      if (seg.type === 'emote') {
        if (seg.img) { const w = EMOTE_SIZE + EMOTE_GAP; if (lw + w > bodyContentW && line.length) { lines.push(line); line = []; lw = 0; } line.push({ type: 'emote', img: seg.img, animData: seg.animData || null, alt: seg.alt, w: EMOTE_SIZE }); lw += w; }
        else if (seg.alt) { const ww = mc.measureText(seg.alt).width; if (lw + ww > bodyContentW && line.length) { lines.push(line); line = []; lw = 0; } line.push({ type: 'emote', img: null, animData: null, alt: seg.alt, w: ww }); lw += ww; }
      } else {
        let segVal = seg.value;
        const nlParts = segVal.split('\n');
        for (let p = 0; p < nlParts.length; p++) {
          if (p > 0) forceNewLine();
          const part = nlParts[p];
          for (const word of part.split(/( +)/)) {
            if (!word) continue;
            const ww = mc.measureText(word).width;
            if (!word.trim()) { if (line.length) { line.push({ type: 'text', value: word, w: ww }); lw += ww; } continue; }
            if (lw + ww > bodyContentW && line.length) { lines.push(line); line = []; lw = 0; }
            if (ww > bodyContentW) {
              let tempStr = '';
              for (const char of Array.from(word)) {
                const testStr = tempStr + char; const testW = mc.measureText(testStr).width;
                if (lw + testW > bodyContentW) { if (tempStr) { line.push({ type: 'text', value: tempStr, w: mc.measureText(tempStr).width }); lines.push(line); line = []; lw = 0; } tempStr = char; } else { tempStr = testStr; }
              }
              if (tempStr) { const finalW = mc.measureText(tempStr).width; line.push({ type: 'text', value: tempStr, w: finalW }); lw += finalW; }
            } else { line.push({ type: 'text', value: word, w: ww }); lw += ww; }
          }
        }
      }
    }
    if (line.length) lines.push(line);
    return { lines, lineH };
  }
  const { lines, lineH } = wrapSegs(renderSegs);
  const bodyInnerH = lines.length * lineH + BODY_PAD_TOP + BODY_PAD;
  const bodyW = MAX_BODY_W;
  let totalW = Math.ceil(Math.max(bodyW, HEADER_LEFT_MG + headerW) + PADDING * 2);
  let totalH = Math.ceil(PADDING + headerH - HEADER_OVERLAP + bodyInnerH + PADDING);
  if (totalW % 2 !== 0) totalW += 1; if (totalH % 2 !== 0) totalH += 1;
  if (canvas.width !== totalW) canvas.width = totalW; if (canvas.height !== totalH) canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, totalW, totalH);
  const bodyX = PADDING; const bodyY = PADDING + headerH - HEADER_OVERLAP;
  function roundRect(cx, x, y, w, h, r) {
    cx.beginPath(); cx.moveTo(x + r, y); cx.lineTo(x + w - r, y); cx.quadraticCurveTo(x + w, y, x + w, y + r);
    cx.lineTo(x + w, y + h - r); cx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    cx.lineTo(x + r, y + h); cx.quadraticCurveTo(x, y + h, x, y + h - r);
    cx.lineTo(x, y + r); cx.quadraticCurveTo(x, y, x + r, y); cx.closePath();
  }
  ctx.save(); roundRect(ctx, bodyX, bodyY, bodyW, bodyInnerH, BODY_RADIUS); ctx.fillStyle = bodyBg; ctx.fill(); ctx.restore();
  if (bodyBorder) { ctx.save(); roundRect(ctx, bodyX, bodyY, bodyW, bodyInnerH, BODY_RADIUS); ctx.strokeStyle = bodyBorder; ctx.lineWidth = borderWidth * DPR; ctx.stroke(); ctx.restore(); }
  ctx.font = `700 ${FONT_SIZE}px Inter, sans-serif`;
  ctx.fillStyle = bodyText; ctx.textBaseline = 'middle';
  let drawY = bodyY + BODY_PAD_TOP;
  for (const ln of lines) {
    let drawX = bodyX + BODY_PAD; const cy = drawY + lineH / 2;
    for (const item of ln) {
      if (item.type === 'text') { ctx.fillStyle = bodyText; ctx.fillText(item.value, drawX, cy); drawX += item.w; }
      else if (item.type === 'emote') {
        if (item.img) {
          let frameImg = item.img;
          if (item.animData && item.animData.type === 'animated' && item.animData.frames && item.animData.totalDuration > 0) {
            const anim = item.animData; const t = timeMs % anim.totalDuration; let frame = anim.frames[0];
            for (const f of anim.frames) { if (t >= f.timeStart && t < f.timeStart + f.duration) { frame = f; break; } }
            frameImg = frame.img;
          }
          try { ctx.drawImage(frameImg, drawX, cy - EMOTE_SIZE / 2, EMOTE_SIZE, EMOTE_SIZE); } catch (e) { ctx.fillStyle = bodyText; ctx.fillText(item.alt || '', drawX, cy); }
          drawX += EMOTE_SIZE + EMOTE_GAP;
        } else if (item.alt) { ctx.fillStyle = bodyText; ctx.fillText(item.alt, drawX, cy); drawX += mc.measureText(item.alt).width; }
        else { drawX += EMOTE_SIZE + EMOTE_GAP; }
      }
    }
    drawY += lineH;
  }
  const headerX = bodyX + HEADER_LEFT_MG; const headerY = PADDING;
  ctx.save(); roundRect(ctx, headerX, headerY, headerW, headerH, HEADER_RADIUS); ctx.fillStyle = headerBg; ctx.fill(); ctx.restore();
  if (headerBorder) { ctx.save(); roundRect(ctx, headerX, headerY, headerW, headerH, HEADER_RADIUS); ctx.strokeStyle = headerBorder; ctx.lineWidth = borderWidth * DPR; ctx.stroke(); ctx.restore(); }
  let hx = headerX + HEADER_PAD_H; const hcy = headerY + headerH / 2;
  for (const badge of _custBadgeImages) {
    if (badge.img) { try { ctx.drawImage(badge.img, hx, hcy - BADGE_SIZE / 2, BADGE_SIZE, BADGE_SIZE); } catch (e) {} hx += BADGE_SIZE + BADGE_GAP; }
  }
  ctx.font = `800 ${HEADER_FONT}px Inter, sans-serif`;
  ctx.fillStyle = headerText; ctx.textBaseline = 'middle';
  ctx.fillText(_custMsg.displayName, hx, hcy);
}

function closeDownloadModal() {
  if (downloadModal) downloadModal.style.display = 'none';
  if (_custAnimRaf !== null) { cancelAnimationFrame(_custAnimRaf); _custAnimRaf = null; _custAnimStart = null; }
  _custBadgeImages = []; _custOriginalMsg = null; _custOriginalColor = null;
}

window.openDownloadModal = openDownloadModal;

document.addEventListener('DOMContentLoaded', init);
