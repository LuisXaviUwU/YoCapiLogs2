// YoCapi App - Web (Local Supabase + API + Blerp)
// Runs on /index.html - no auth required

// ===== DOM =====
const $ = (s) => document.querySelector(s);

// Local Logs DOM
const localChannelInput = $('#local-channel-input');
const localUserInput = $('#local-user-input');
const btnLocalLoad = $('#btn-local-load');
const localYearSelect = $('#local-year-select');
const localMonthSelect = $('#local-month-select');
const localDaySelect = $('#local-day-select');
const localDatesEmpty = $('#local-dates-empty');
const localDateRow = $('#local-date-row');
const btnLocalHistory = $('#btn-local-history');

// Messages DOM
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

// History Modal DOM
const historyModal = $('#history-modal');
const historyClose = $('#history-close');
const historyList = $('#history-list');

// Download Modal DOM
const downloadModal = $('#download-modal');
const downloadClose = $('#download-close');

// Blerp DOM
const blerpCanvas = $('#blerp-canvas');
const blerpStatus = $('#blerp-status');

// Current active source: 'local' | 'api' | 'blerp'
let _activeSource = localStorage.getItem('activeSource') || 'local';

// ===== State =====
let allMessages = [];
let filteredMessages = [];
let navIndex = 0;
let sortAscending = true;
let _localSavedTree = null;
let _localActiveDate = null;

// Windowed rendering
const RENDER_PAGE = 300;
let _renderEnd = 0;
let _renderObserver = null;

// Customizer state
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

// Blerp state
let _blerpAnimRaf = null;
let _blerpMsg = null;
let _blerpEvento = null;
let _blerpAvatar = null;
let _blerpSoundImage = null;
let _blerpRealMatch = null;
let _blerpRealMatches = [];
let _blerpIsRecording = false;
const BLERP_STYLE_DEFAULTS = { bg1: '#0f0a19', bg2: '#190f2d', border: '#9146ff', borderEnabled: true };
let _blerpStyle = { ...BLERP_STYLE_DEFAULTS };

// ===== Init =====
async function init() {
  // Sidebar collapsible toggle
  initSidebar();

  // Init source switcher (sub-items: Local, API, Blerp)
  initSources();

  // Load emote cache from Supabase
  if (typeof getEmoteCache === 'function') {
    try {
      const cached = await getEmoteCache();
      if (cached && Object.keys(cached).length > 0) {
        window.twitchEmoteIds = {};
        for (const [name, val] of Object.entries(cached)) {
          if (typeof val === 'object' && val.id) {
            window.twitchEmoteIds[name] = val.id;
          }
        }
      }
    } catch (e) { console.warn('[Emote cache]', e.message); }
  }

  // Load search history from Supabase
  if (typeof getSearchHistory === 'function') {
    try {
      const history = await getSearchHistory();
      for (const entry of (history || [])) {
        userHistory[entry.username] = { displayName: entry.display_name, count: entry.search_count };
      }
    } catch (e) { console.warn('[Search history]', e.message); }
  }

  // Init panels
  initLocalLogs();
  initCustomizer();
  initBlerpStyleControls();

  // History modal
  if (btnLocalHistory) btnLocalHistory.addEventListener('click', openHistoryModal);
  if (historyClose) historyClose.addEventListener('click', closeHistoryModal);
  if (historyModal) {
    historyModal.addEventListener('click', e => { if (e.target === historyModal) closeHistoryModal(); });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && historyModal && historyModal.style.display !== 'none') closeHistoryModal();
  });

  // Download modal
  if (downloadClose) downloadClose.addEventListener('click', closeDownloadModal);
  if (downloadModal) {
    downloadModal.addEventListener('click', e => { if (e.target === downloadModal) closeDownloadModal(); });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && downloadModal && downloadModal.style.display !== 'none') closeDownloadModal();
  });

  // Filter
  if (filterInput) filterInput.addEventListener('input', debounce(applyFilter, 200));

  // Navigation
  if (navPrev) navPrev.addEventListener('click', () => navigateTo(navIndex - 1));
  if (navNext) navNext.addEventListener('click', () => navigateTo(navIndex + 1));
  if (navSort) {
    navSort.addEventListener('click', () => {
      sortAscending = !sortAscending;
      allMessages.reverse();
      applyFilter();
      navSort.style.color = sortAscending ? '' : 'var(--purple-lt)';
      navSort.style.borderColor = sortAscending ? '' : 'var(--purple)';
    });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); navigateTo(navIndex - 1); }
    if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); navigateTo(navIndex + 1); }
    if (e.key === 'Home') { e.preventDefault(); navigateTo(0); }
    if (e.key === 'End') { e.preventDefault(); navigateTo(filteredMessages.length - 1); }
  });

  // Apply saved active source
  setSource(_activeSource);

  // Firebase connectivity indicator
  initFirebaseStatus();
}

// ===== Sidebar collapse toggle =====
function initSidebar() {
  const collapseEl = document.getElementById('sidebar-collapse-visor');
  const toggleBtn = document.getElementById('nav-visor');
  if (!collapseEl || !toggleBtn) return;
  toggleBtn.addEventListener('click', () => {
    collapseEl.classList.toggle('open');
  });
}

// ===== Source switcher (sidebar sub-items: local, api, blerp) =====
function initSources() {
  const subItems = document.querySelectorAll('.nav-sub-item');
  subItems.forEach(btn => {
    btn.addEventListener('click', () => {
      const src = btn.dataset.source;
      if (src) setSource(src);
    });
  });
}

function setSource(src) {
  _activeSource = src;
  localStorage.setItem('activeSource', src);

  // Update sub-item active states
  document.querySelectorAll('.nav-sub-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.source === src);
  });

  // Show/hide panels
  const panelMain = document.getElementById('panel-api-local');
  const panelBlerp = document.getElementById('panel-blerp');
  const localWrap = document.getElementById('local-omnibar-wrap');
  const topTitle = document.getElementById('top-title');

  if (src === 'blerp') {
    if (panelMain) panelMain.style.display = 'none';
    if (panelBlerp) panelBlerp.style.display = 'flex';
    if (topTitle) topTitle.innerHTML = 'Visor de Logs <span class="mode-badge blerp-badge">BLERP</span>';
  } else {
    // local
    if (panelBlerp) panelBlerp.style.display = 'none';
    if (panelMain) panelMain.style.display = 'flex';
    if (localWrap) localWrap.style.display = 'block';
    if (topTitle) topTitle.innerHTML = 'Visor de Logs <span class="mode-badge local-badge">LOCAL</span>';
    
    // Reset messages when switching sources
    showEmpty();
  }
}

function showEmpty() {
  if (emptyState) emptyState.style.display = 'flex';
  if (loadingState) loadingState.style.display = 'none';
  if (errorState) errorState.style.display = 'none';
  if (messagesList) { messagesList.style.display = 'none'; messagesList.innerHTML = ''; }
  if (filterRow) filterRow.style.display = 'none';
  if (statMessages) statMessages.style.display = 'none';
  if (navBar) navBar.style.display = 'none';
  allMessages = []; filteredMessages = [];
}

// ===== Firebase connectivity status =====
async function initFirebaseStatus() {
  const dot = document.getElementById('server-dot');
  const label = document.getElementById('server-status-label');
  
  try {
    // Try a lightweight Firebase query
    if (typeof getSearchHistory === 'function') {
      await getSearchHistory(1);
    }
    if (dot) dot.classList.add('online');
    if (label) label.textContent = 'Firebase conectado';
  } catch (e) {
    console.error('Firebase connection error:', e);
    if (dot) dot.classList.add('offline');
    if (label) label.textContent = 'Firebase sin conexión';
  }
}

// ===== Local Logs =====
function initLocalLogs() {
  if (localYearSelect) localYearSelect.addEventListener('change', populateLocalMonthSelect);
  if (localMonthSelect) localMonthSelect.addEventListener('change', populateLocalDaySelect);

  if (btnLocalLoad) {
    btnLocalLoad.addEventListener('click', () => {
      const channel = localChannelInput ? localChannelInput.value.trim().toLowerCase() : '';
      if (!channel) {
        showError('Canal requerido', 'Ingresa el nombre del canal');
        if (localChannelInput) localChannelInput.focus();
        return;
      }
      if (localDaySelect && localDaySelect.value) {
        loadLocalLogs(channel, localDaySelect.value);
      } else {
        loadSavedLogsList(channel);
      }
    });
  }

  const handleLocalEnter = e => {
    if (e.key === 'Enter') {
      if (document.activeElement === localChannelInput) {
        loadSavedLogsList(localChannelInput.value.trim().toLowerCase());
      } else if (btnLocalLoad) {
        btnLocalLoad.click();
      }
    }
  };
  if (localChannelInput) localChannelInput.addEventListener('keydown', handleLocalEnter);
  if (localUserInput) localUserInput.addEventListener('keydown', handleLocalEnter);

  // Auto-cargar fechas para yocapi_pr al iniciar
  loadSavedLogsList('yocapi_pr');
}

async function loadSavedLogsList(channel) {
  if (!channel) return;
  if (!localDatesEmpty || !localDateRow) return;
  localDatesEmpty.style.display = 'block';
  localDateRow.style.display = 'none';
  localDatesEmpty.textContent = 'Buscando fechas...';

  try {
    const tree = typeof getSavedLogsList === 'function' ? await getSavedLogsList(channel) : {};
    if (Object.keys(tree).length === 0) {
      localDatesEmpty.innerHTML = `No hay logs guardados para <strong>#${channel}</strong>`;
      return;
    }
    localDatesEmpty.style.display = 'none';
    localDateRow.style.display = 'flex';
    _localSavedTree = tree;
    populateLocalYearSelect();
  } catch (err) {
    console.error(err);
    localDatesEmpty.innerHTML = `<span style="color:var(--text-hi)">Error: ${err.message}</span>`;
  }
}

function populateLocalYearSelect() {
  if (!_localSavedTree || !localYearSelect) return;
  const years = Object.keys(_localSavedTree).sort().reverse();
  localYearSelect.innerHTML = '';
  years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y; opt.textContent = y;
    localYearSelect.appendChild(opt);
  });
  if (years.length > 0) populateLocalMonthSelect();
}

function populateLocalMonthSelect() {
  if (!_localSavedTree || !localYearSelect || !localMonthSelect) return;
  const y = localYearSelect.value;
  if (!y || !_localSavedTree[y]) return;
  const months = Object.keys(_localSavedTree[y]).sort().reverse();
  localMonthSelect.innerHTML = '';
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  months.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = monthNames[parseInt(m, 10) - 1];
    localMonthSelect.appendChild(opt);
  });
  if (months.length > 0) populateLocalDaySelect();
}

function populateLocalDaySelect() {
  if (!_localSavedTree || !localYearSelect || !localMonthSelect || !localDaySelect) return;
  const y = localYearSelect.value;
  const m = localMonthSelect.value;
  if (!y || !m || !_localSavedTree[y] || !_localSavedTree[y][m]) return;
  const daysStr = _localSavedTree[y][m];
  localDaySelect.innerHTML = '';
  const optAll = document.createElement('option');
  optAll.value = `${y}-${m}`;
  optAll.textContent = 'All';
  localDaySelect.appendChild(optAll);
  daysStr.forEach(dStr => {
    const d = dStr.split('-')[2];
    const opt = document.createElement('option');
    opt.value = dStr; opt.textContent = parseInt(d, 10).toString();
    localDaySelect.appendChild(opt);
  });
}

// (Compilar feature removed, saving is now automatic)
async function loadLocalLogs(channel, date) {
  showLoading();
  try {
    const parts = date.split('-');
    const year = parts[0];
    const month = parts[1];
    const day = parts[2]; // undefined when date is YYYY-MM (All mode)
    const isMonthMode = !day; // "All" selected

    let data = null;

    if (isMonthMode) {
      // --- "All" mode: aggregate all saved days for the month from Supabase ---
      let allMsgs = [];
      let loadedFromSupabase = false;

      if (typeof getSavedLogsList === 'function') {
        const tree = await getSavedLogsList(channel);
        const days = (tree[year] && tree[year][month]) ? tree[year][month] : [];
        if (days.length > 0) {
          loadedFromSupabase = true;
          const dayResults = await Promise.all(
            days.map(d => typeof getSavedLog === 'function' ? getSavedLog(channel, d) : null)
          );
          for (const res of dayResults) {
            if (res && res.messages) allMsgs = allMsgs.concat(res.messages);
          }
        }
      }

      if (allMsgs.length === 0) {
        // Fallback: fetch whole month from Zonian API
        const fetchApi = async (url) => {
          const resp = await fetch(url);
          if (!resp.ok) {
            if (resp.status === 404 || resp.status === 400) return { messages: [] };
            throw new Error(`Error ${resp.status}: ${resp.statusText}`);
          }
          return await resp.json();
        };
        const apiUrl = `${API_BASE}/channel/${channel}/${year}/${parseInt(month)}?json=1`;
        const res = await fetchApi(apiUrl);
        if (res && res.messages) allMsgs = res.messages;
        // Save each day automatically
        if (allMsgs.length > 0 && typeof saveLogsLocallySupabase === 'function') {
          const byDay = {};
          for (const msg of allMsgs) {
            const d = new Date(msg.timestamp);
            const dk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            if (!byDay[dk]) byDay[dk] = [];
            byDay[dk].push(msg);
          }
          for (const [dk, msgs] of Object.entries(byDay)) {
            saveLogsLocallySupabase(channel, dk, msgs).catch(console.error);
          }
        }
      }

      // Dedup & sort ascending by timestamp
      const seenIds = new Set();
      allMsgs = allMsgs.filter(msg => {
        const id = msg.tags?.id || msg.timestamp + msg.displayName + msg.text;
        if (seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
      });
      allMsgs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      data = { messages: allMsgs };

    } else {
      // --- Day mode: load from Supabase then ALWAYS merge with API for newer msgs ---
      const supabaseData = typeof getSavedLog === 'function' ? await getSavedLog(channel, date) : null;
      const supabaseMsgs = (supabaseData && supabaseData.messages) ? supabaseData.messages : [];
      
      // Find the latest timestamp in Supabase data (to know if API has newer messages)
      let lastSupabaseTs = 0;
      for (const m of supabaseMsgs) {
        const t = new Date(m.timestamp).getTime();
        if (t > lastSupabaseTs) lastSupabaseTs = t;
      }

      // Always also fetch from API to catch messages after the Supabase snapshot
      let apiMsgs = [];
      try {
        const fetchApi = async (url) => {
          const resp = await fetch(url);
          if (!resp.ok) {
            if (resp.status === 404 || resp.status === 400) return { messages: [] };
            throw new Error(`Error ${resp.status}: ${resp.statusText}`);
          }
          return await resp.json();
        };

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
        // Filter to correct local date
        apiMsgs = apiMsgs.filter(msg => {
          const d2 = new Date(msg.timestamp);
          return d2.getFullYear() === parseInt(year, 10) &&
            d2.getMonth() === parseInt(month, 10) - 1 &&
            d2.getDate() === parseInt(day, 10);
        });
      } catch (apiErr) {
        console.warn('[loadLocalLogs] API fetch failed, using Supabase only:', apiErr.message);
      }

      // Merge: combine Supabase + API, dedup, sort
      const combined = [...supabaseMsgs, ...apiMsgs];
      const seenIds = new Set();
      const merged = combined.filter(msg => {
        const id = msg.tags?.id || msg.timestamp + msg.displayName + msg.text;
        if (seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
      });
      merged.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      // Re-save if the API added newer messages
      const lastMergedTs = merged.length ? new Date(merged[merged.length - 1].timestamp).getTime() : 0;
      if (merged.length > supabaseMsgs.length || lastMergedTs > lastSupabaseTs) {
        if (typeof saveLogsLocallySupabase === 'function') {
          saveLogsLocallySupabase(channel, date, merged).catch(console.error);
        }
      }

      data = { messages: merged };
    } // end else (day mode)

    if (!data || !data.messages || data.messages.length === 0) {
      showError('Sin mensajes', 'No se encontraron mensajes para esta fecha. Prueba con otro día.');
      return;
    }
    let msgs = data.messages;
    const targetUser = localUserInput ? localUserInput.value.trim().toLowerCase().replace(/^@/, '') : '';
    if (targetUser) {
      msgs = msgs.filter(m => m.displayName && m.displayName.toLowerCase() === targetUser);
    }
    if (msgs.length === 0) {
      showError('Sin resultados', `No se encontraron mensajes para "${targetUser}" en este día.`);
      return;
    }
    const firstRoomId = msgs[0]?.tags?.['room-id'];
    if (firstRoomId && firstRoomId !== channelId) {
      channelId = firstRoomId;
      await Promise.all([loadBadges(channelId), loadThirdPartyEmotes(channelId)]);
    } else if (!firstRoomId && Object.keys(thirdPartyEmotes).length === 0) {
      await ensureThirdPartyEmotesByName(channel);
    }
    allMessages = msgs;
    if (!sortAscending) allMessages.reverse();
    filteredMessages = [...allMessages];
    renderMessages(filteredMessages);
    showMessages();
    updateStats(filteredMessages.length);
    if (targetUser && filteredMessages.length > 0) {
      const key = targetUser;
      if (!userHistory[key]) userHistory[key] = { displayName: targetUser, count: 0 };
      userHistory[key].count++;
      if (filteredMessages[0]?.displayName) userHistory[key].displayName = filteredMessages[0].displayName;
      if (typeof upsertSearchHistory === 'function') {
        await upsertSearchHistory(key, userHistory[key].displayName);
      }
    }
  } catch (err) {
    console.error(err);
    showError('Error local', err.message || 'No se pudo leer el archivo guardado.');
  }
}

// ===== Windowed Rendering =====

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
        const prevDate = new Date(prevMsg.timestamp);
        if (date.getTime() - prevDate.getTime() < 60000) isGrouped = true;
      }
    }
    frag.appendChild(createMessageRow(msg, date, isGrouped));
  }
  return frag;
}

function renderMessages(messages) {
  if (_renderObserver) { _renderObserver.disconnect(); _renderObserver = null; }
  if (messagesList) messagesList.innerHTML = '';
  _renderEnd = 0;
  if (messages.length === 0) return;
  const lastDay = { v: '' };
  const end = Math.min(RENDER_PAGE, messages.length);
  if (messagesList) messagesList.appendChild(buildMessagesFrag(messages, 0, end, lastDay));
  _renderEnd = end;
  if (_renderEnd < messages.length) _attachSentinel(messages, lastDay);
}

function _attachSentinel(messages, lastDay) {
  const old = document.getElementById('render-sentinel');
  if (old) old.remove();
  const sentinel = document.createElement('div');
  sentinel.id = 'render-sentinel';
  sentinel.style.cssText = 'height:1px;width:100%;';
  if (messagesList) messagesList.appendChild(sentinel);
  _renderObserver = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    const from = _renderEnd;
    const to = Math.min(_renderEnd + RENDER_PAGE, messages.length);
    sentinel.remove();
    if (messagesList) messagesList.appendChild(buildMessagesFrag(messages, from, to, lastDay));
    _renderEnd = to;
    if (_renderEnd < messages.length) {
      if (messagesList) messagesList.appendChild(sentinel);
    } else {
      _renderObserver.disconnect();
      _renderObserver = null;
    }
  }, { root: messagesList ? messagesList.closest('.messages-wrap') || null : null, rootMargin: '200px' });
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
  const filterVal = filterInput ? filterInput.value.trim() : '';
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
  dlBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
  dlBtn.onclick = () => downloadMessageCard(msg, color);
  const blerpBtn = document.createElement('button');
  blerpBtn.className = 'msg-download-btn msg-blerp-btn';
  blerpBtn.title = 'Ver como overlay Blerp';
  blerpBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
  blerpBtn.onclick = () => openBlerpCard(msg);
  metaEl.appendChild(badgesEl);
  metaEl.appendChild(userEl);
  metaEl.appendChild(colonEl);
  row.appendChild(timeEl);
  row.appendChild(metaEl);
  row.appendChild(bodyEl);
  row.appendChild(blerpBtn);
  row.appendChild(dlBtn);
  return row;
}

// ===== Filter =====
function applyFilter() {
  const query = normalizeStr(filterInput ? filterInput.value.trim() : '');
  filteredMessages = query
    ? allMessages.filter(m =>
        normalizeStr(m.text).includes(query) || normalizeStr(m.displayName).includes(query)
      )
    : [...allMessages];
  if (filterCount) filterCount.textContent = `${filteredMessages.length.toLocaleString()} / ${allMessages.length.toLocaleString()}`;
  renderMessages(filteredMessages);
  updateStats(filteredMessages.length);
  if (navBar && navBar.style.display !== 'none') resetNav();
}

// ===== Navigation =====
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
    if (messagesList) messagesList.appendChild(buildMessagesFrag(filteredMessages, _renderEnd, to, lastDay));
    _renderEnd = to;
    if (_renderEnd < filteredMessages.length) _attachSentinel(filteredMessages, lastDay);
  }
  document.querySelectorAll('.msg-row.nav-highlight').forEach(el => el.classList.remove('nav-highlight'));
  const rows = messagesList ? messagesList.querySelectorAll('.msg-row') : [];
  if (rows[idx]) {
    rows[idx].classList.add('nav-highlight');
    rows[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  if (navPos) navPos.innerHTML = `<strong>${(idx + 1).toLocaleString()}</strong> / ${filteredMessages.length.toLocaleString()}`;
  if (navPrev) { navPrev.disabled = idx === 0; navPrev.style.opacity = idx === 0 ? '.4' : '1'; }
  if (navNext) { navNext.disabled = idx === filteredMessages.length - 1; navNext.style.opacity = idx === filteredMessages.length - 1 ? '.4' : '1'; }
}

function _lastRenderedDay() {
  const seps = messagesList ? messagesList.querySelectorAll('.day-sep-text') : [];
  return seps.length ? seps[seps.length - 1].textContent : '';
}

function resetNav() {
  navIndex = 0;
  if (navPos) navPos.innerHTML = `<strong>1</strong> / ${filteredMessages.length.toLocaleString()}`;
  if (navPrev) { navPrev.disabled = true; navPrev.style.opacity = '.4'; }
  if (navNext) { navNext.disabled = filteredMessages.length <= 1; navNext.style.opacity = filteredMessages.length <= 1 ? '.4' : '1'; }
}

// ===== User History Modal =====
function openHistoryModal() {
  renderHistoryList();
  if (historyModal) historyModal.style.display = 'flex';
}
function closeHistoryModal() {
  if (historyModal) historyModal.style.display = 'none';
}
function renderHistoryList() {
  const entries = Object.values(userHistory).sort((a, b) => b.count - a.count);
  if (!historyList) return;
  if (entries.length === 0) {
    historyList.innerHTML = '<p class="history-empty">No hay usuarios en el historial aún.</p>';
    return;
  }
  historyList.innerHTML = '';
  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = 'history-item';
    const nameEl = document.createElement('div');
    nameEl.className = 'history-username';
    nameEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>${escapeHtml(entry.displayName)}`;
    const countEl = document.createElement('span');
    countEl.className = 'history-count';
    countEl.textContent = `${entry.count} ${entry.count === 1 ? 'búsqueda' : 'búsquedas'}`;
    item.appendChild(nameEl);
    item.appendChild(countEl);
    item.addEventListener('click', () => {
      if (localUserInput) { localUserInput.value = entry.displayName; closeHistoryModal(); localUserInput.focus(); }
    });
    historyList.appendChild(item);
  }
}

// ===== UI States =====
function showLoading() {
  if (emptyState) emptyState.style.display = 'none';
  if (errorState) errorState.style.display = 'none';
  if (messagesList) messagesList.style.display = 'none';
  if (filterRow) filterRow.style.display = 'none';
  if (loadingState) loadingState.style.display = 'flex';
  if (statMessages) statMessages.style.display = 'none';
  if (navBar) navBar.style.display = 'none';
}
function showMessages() {
  if (emptyState) emptyState.style.display = 'none';
  if (errorState) errorState.style.display = 'none';
  if (loadingState) loadingState.style.display = 'none';
  if (messagesList) messagesList.style.display = 'block';
  if (filterRow) filterRow.style.display = 'block';
  if (statMessages) statMessages.style.display = 'flex';
  if (navBar) navBar.style.display = 'flex';
  resetNav();
}
function showError(title, desc) {
  if (emptyState) emptyState.style.display = 'none';
  if (loadingState) loadingState.style.display = 'none';
  if (messagesList) messagesList.style.display = 'none';
  if (filterRow) filterRow.style.display = 'none';
  if (statMessages) statMessages.style.display = 'none';
  if (navBar) navBar.style.display = 'none';
  if (errorTitle) errorTitle.textContent = title;
  if (errorDesc) errorDesc.textContent = desc;
  if (errorState) errorState.style.display = 'flex';
}
function updateStats(n) { if (statCount) statCount.textContent = n.toLocaleString(); }

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
  setTimeout(() => {
    t.classList.remove('toast--show');
    setTimeout(() => t.remove(), 400);
  }, 3000);
}

// ===== CUSTOMIZER =====
const COLOR_PRESETS = [
  { hex: '#9146ff', label: 'Twitch' }, { hex: '#ff4dd2', label: 'Rosa' },
  { hex: '#4ade80', label: 'Verde' }, { hex: '#60a5fa', label: 'Azul' },
  { hex: '#fb923c', label: 'Naranja' }, { hex: '#facc15', label: 'Dorado' },
  { hex: '#f87171', label: 'Rojo' }, { hex: '#a78bfa', label: 'Lavanda' },
];

function initCustomizer() {
  const swatchesEl = document.getElementById('color-swatches');
  if (swatchesEl) {
    COLOR_PRESETS.forEach(({ hex, label }) => {
      const btn = document.createElement('button');
      btn.className = 'color-swatch';
      btn.style.background = hex;
      btn.title = label;
      btn.dataset.hex = hex;
      btn.addEventListener('click', () => {
        _custSettings.accentColor = hex;
        const picker = document.getElementById('custom-color-picker');
        if (picker) picker.value = hex;
        setActiveSwatch(hex); scheduleRender();
      });
      swatchesEl.appendChild(btn);
    });
  }
  document.getElementById('custom-color-picker')?.addEventListener('input', e => {
    _custSettings.accentColor = e.target.value;
    setActiveSwatch(null); scheduleRender();
  });
  document.querySelectorAll('.bg-options .bg-opt:not(.tpl-opt)').forEach(btn => {
    btn.addEventListener('click', () => {
      _custSettings.bgStyle = btn.dataset.bg;
      document.querySelectorAll('.bg-options .bg-opt:not(.tpl-opt)').forEach(b => b.classList.toggle('active', b === btn));
      scheduleRender();
    });
  });
  const bgLight = document.getElementById('bg-opt-light');
  if (bgLight) bgLight.classList.add('active');
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
    if (_custOriginalMsg) downloadMessageCard(_custOriginalMsg, _custOriginalColor);
  });
  const btnDl = document.getElementById('btn-dl-final');
  if (btnDl) {
    btnDl.onclick = function() {
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
    };
  }
  const btnGif = document.getElementById('btn-dl-video');
  if (btnGif) {
    btnGif.onclick = async function() {
      if (_isRecording) return;
      const canvas = document.getElementById('preview-canvas');
      if (!canvas) return;
      _isRecording = true;
      btnGif.disabled = true;
      btnGif.innerHTML = 'Capturando frames...';
      if (_custAnimRaf !== null) { cancelAnimationFrame(_custAnimRaf); _custAnimRaf = null; }
      let maxDuration = 3000;
      if (_custSegments) {
        let maxAnim = 0;
        for (const seg of _custSegments) {
          if (seg.animData && seg.animData.totalDuration > maxAnim) maxAnim = seg.animData.totalDuration;
        }
        if (maxAnim > 0) {
          maxDuration = Math.max(2000, maxAnim);
          if (maxDuration < 3000) maxDuration = Math.ceil(3000 / maxAnim) * maxAnim;
        }
      }
      const gif = new GIF({
        workers: 4, quality: 10, transparent: 'rgba(0,0,0,0)',
        workerScript: 'js/gif.worker.js', width: canvas.width, height: canvas.height
      });
      const fps = 30;
      const frameDelay = Math.round(1000 / fps);
      const totalFrames = Math.ceil(maxDuration / frameDelay);
      const ctx = canvas.getContext('2d');
      for (let i = 0; i < totalFrames; i++) {
        renderCustomizerCanvas(i * frameDelay, canvas);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        for (let j = 0; j < data.length; j += 4) {
          const a = data[j + 3];
          if (a === 0) continue;
          if (a < 128) { data[j] = 0; data[j+1] = 0; data[j+2] = 0; data[j+3] = 0; }
          else if (a < 255) { const f = 255/a; data[j] = Math.min(255, data[j]*f); data[j+1] = Math.min(255, data[j+1]*f); data[j+2] = Math.min(255, data[j+2]*f); data[j+3] = 255; }
        }
        ctx.putImageData(imgData, 0, 0);
        gif.addFrame(canvas, { delay: frameDelay, copy: true });
      }
      gif.on('finished', function(blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.download = _custMsg ? `twitch-${_custMsg.displayName}-${new Date(_custMsg.timestamp).getTime()}.gif` : `twitch-anim-${Date.now()}.gif`;
        a.href = url; document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        _isRecording = false; btnGif.disabled = false; btnGif.innerHTML = 'Descargar GIF';
        closeDownloadModal();
      });
      btnGif.innerHTML = 'Generando GIF...';
      setTimeout(() => gif.render(), 50);
    };
  }
  // TTS controls
  initTtsControls();
}

function initTtsControls() {
  const btnTtsPlay = document.getElementById('btn-tts-play');
  const btnTtsDownload = document.getElementById('btn-tts-download');
  const ttsVoiceSelect = document.getElementById('tts-voice-select');
  function populateTtsVoices() {
    if (!ttsVoiceSelect || !window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;
    const current = ttsVoiceSelect.value;
    ttsVoiceSelect.innerHTML = '';
    const sorted = [...voices].sort((a, b) => {
      const score = v => v.name.includes('Sabina') ? -1 : v.lang.startsWith('es') ? 0 : 1;
      return score(a) - score(b);
    });
    sorted.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      if (v.name === current) opt.selected = true;
      ttsVoiceSelect.appendChild(opt);
    });
    if (!current) {
      const sabina = sorted.find(v => v.name.includes('Sabina'));
      const firstEs = sorted.find(v => v.lang.startsWith('es'));
      if (sabina) ttsVoiceSelect.value = sabina.name;
      else if (firstEs) ttsVoiceSelect.value = firstEs.name;
    }
  }
  if (window.speechSynthesis) {
    populateTtsVoices();
    window.speechSynthesis.onvoiceschanged = populateTtsVoices;
  }
  function cleanTtsString(str) { return str.replace(/[_@,\.0-9]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function getTtsParts() {
    if (!_custMsg) return null;
    let ttsText = _custMsg.text || '';
    if (ttsText.toLowerCase().startsWith('!s ')) ttsText = ttsText.substring(3).trim();
    else if (ttsText.toLowerCase().startsWith('!s')) ttsText = ttsText.substring(2).trim();
    const rawName = (_custMsg.displayName || '').replace(/[0-9]/g, '');
    const name = cleanTtsString(rawName);
    const msg = cleanTtsString(ttsText);
    return { name, msg };
  }
  function makeTtsUtterance(text) {
    const selectedVoiceName = ttsVoiceSelect ? ttsVoiceSelect.value : '';
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(v => v.name === selectedVoiceName);
    const utter = new SpeechSynthesisUtterance(text);
    if (voice) utter.voice = voice;
    utter.rate = 1.0;
    utter.pitch = 1.0;
    return utter;
  }
  if (btnTtsPlay) {
    btnTtsPlay.addEventListener('click', () => {
      const parts = getTtsParts();
      if (!parts) return;
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      const fullText = `${parts.name}. ${parts.msg}`;
      const utter = makeTtsUtterance(fullText);
      window.speechSynthesis.speak(utter);
    });
  }
  if (btnTtsDownload) {
    btnTtsDownload.addEventListener('click', async () => {
      const parts = getTtsParts();
      if (!parts) return;
      const fullText = `${parts.name}. ${parts.msg}`;
      try {
        // Use Web Speech API to generate audio blob
        const blob = await new Promise((resolve) => {
          const utterance = makeTtsUtterance(fullText);
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const dest = audioCtx.createMediaStreamDestination();
          const source = audioCtx.createMediaStreamSource(dest.stream);
          // Fallback: use MediaRecorder
          const chunks = [];
          const mediaRecorder = new MediaRecorder(dest.stream);
          mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
          mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'audio/webm' });
            resolve(blob);
          };
          mediaRecorder.start();
          window.speechSynthesis.speak(utterance);
          utterance.onend = () => {
            setTimeout(() => mediaRecorder.stop(), 100);
          };
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tts-${(_custMsg ? _custMsg.displayName : 'audio').replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.webm`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) {
        console.error('TTS download error:', e);
        showToast('Error al descargar audio', 'error');
      }
    });
  }
}

function setActiveSwatch(hex) {
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('active', hex !== null && s.dataset.hex === hex));
}

function scheduleRender(ms = 30) {
  clearTimeout(_custTimer);
  _custTimer = setTimeout(renderCustomizerCanvas, ms);
}

async function downloadMessageCard(msg, color) {
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
  _custSettings.accentColor = userColor;
  _custSettings.bgStyle = 'light';
  _custSettings.fontSize = 16;
  _custSettings.showBorder = false;
  _custSettings.borderWidth = 2;
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
    else el.style.display = 'flex';
  });
  const btnDlVideo = document.getElementById('btn-dl-video');
  if (btnDlVideo) btnDlVideo.style.display = '';
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
        const img = await loadImage(cached.url);
        _custBadgeImages.push({ pair, img, title: cached.title || '' });
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
    const newSegs = [];
    let foundNl = false;
    for (let i = 0; i < renderSegs.length; i++) {
      const s = renderSegs[i];
      if (!foundNl) {
        if (s.type === 'text') {
          const nlPos = s.value.indexOf('\n');
          if (nlPos !== -1) {
            const after = s.value.slice(nlPos + 1);
            if (after) newSegs.push(Object.assign({}, s, { value: after }));
            foundNl = true;
          }
        }
      } else {
        newSegs.push(s);
      }
    }
    if (foundNl && newSegs.length > 0 && newSegs[0].type === 'text') {
      newSegs[0] = Object.assign({}, newSegs[0], { value: newSegs[0].value.replace(/^[ \t]+/, '') });
      if (newSegs[0].value.length > 0 && newSegs[0].value[0] >= 'a' && newSegs[0].value[0] <= 'z') {
        newSegs[0].value = newSegs[0].value[0].toUpperCase() + newSegs[0].value.slice(1);
      }
    }
    renderSegs = newSegs;
  }
  function wrapSegs(segs) {
    const lineH = Math.round(FONT_SIZE * LINE_HEIGHT);
    const lines = [];
    let line = [], lw = 0;
    function forceNewLine() { if (line.length) { lines.push(line); line = []; lw = 0; } }
    for (const seg of segs) {
      if (seg.type === 'emote') {
        if (seg.img) {
          const w = EMOTE_SIZE + EMOTE_GAP;
          if (lw + w > bodyContentW && line.length) { lines.push(line); line = []; lw = 0; }
          line.push({ type: 'emote', img: seg.img, animData: seg.animData || null, alt: seg.alt, w: EMOTE_SIZE });
          lw += w;
        } else if (seg.alt) {
          const ww = mc.measureText(seg.alt).width;
          if (lw + ww > bodyContentW && line.length) { lines.push(line); line = []; lw = 0; }
          line.push({ type: 'emote', img: null, animData: null, alt: seg.alt, w: ww });
          lw += ww;
        }
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
                const testStr = tempStr + char;
                const testW = mc.measureText(testStr).width;
                if (lw + testW > bodyContentW) {
                  if (tempStr) { line.push({ type: 'text', value: tempStr, w: mc.measureText(tempStr).width }); lines.push(line); line = []; lw = 0; }
                  tempStr = char;
                } else { tempStr = testStr; }
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
  if (totalW % 2 !== 0) totalW += 1;
  if (totalH % 2 !== 0) totalH += 1;
  if (canvas.width !== totalW) canvas.width = totalW;
  if (canvas.height !== totalH) canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, totalW, totalH);
  const bodyX = PADDING;
  const bodyY = PADDING + headerH - HEADER_OVERLAP;
  function roundRect(cx, x, y, w, h, r) {
    cx.beginPath();
    cx.moveTo(x + r, y); cx.lineTo(x + w - r, y); cx.quadraticCurveTo(x + w, y, x + w, y + r);
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
    let drawX = bodyX + BODY_PAD;
    const cy = drawY + lineH / 2;
    for (const item of ln) {
      if (item.type === 'text') { ctx.fillStyle = bodyText; ctx.fillText(item.value, drawX, cy); drawX += item.w; }
      else if (item.type === 'emote') {
        if (item.img) {
          let frameImg = item.img;
          if (item.animData && item.animData.type === 'animated' && item.animData.frames && item.animData.totalDuration > 0) {
            const anim = item.animData;
            const t = timeMs % anim.totalDuration;
            let frame = anim.frames[0];
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
  const headerX = bodyX + HEADER_LEFT_MG;
  const headerY = PADDING;
  ctx.save(); roundRect(ctx, headerX, headerY, headerW, headerH, HEADER_RADIUS); ctx.fillStyle = headerBg; ctx.fill(); ctx.restore();
  if (headerBorder) { ctx.save(); roundRect(ctx, headerX, headerY, headerW, headerH, HEADER_RADIUS); ctx.strokeStyle = headerBorder; ctx.lineWidth = borderWidth * DPR; ctx.stroke(); ctx.restore(); }
  let hx = headerX + HEADER_PAD_H;
  const hcy = headerY + headerH / 2;
  if (_custEventHubAvatar) {
    const avatarSize = BADGE_SIZE * 1.5;
    ctx.save(); ctx.beginPath(); ctx.arc(hx + avatarSize / 2, hcy, avatarSize / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    ctx.drawImage(_custEventHubAvatar, hx, hcy - avatarSize / 2, avatarSize, avatarSize); ctx.restore();
    hx += avatarSize + BADGE_GAP;
  }
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
  _custEventHubAvatar = null; _custBadgeImages = []; _custOriginalMsg = null; _custOriginalColor = null;
}

// ===== Blerp Functions =====
function extractBlerpSoundTitle(text) {
  if (!text) return null;
  const match = text.match(/to play\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function parseBlerpRedeemEvent(text) {
  if (!text) return null;
  const match = text.match(/^(.+?)\s+used\s+(\d+)\s*(?:bits?|be{1,2}ts?)\s+to\s+play\s+(.+)$/i);
  if (!match) return null;
  return { redeemer: match[1].trim(), bits: parseInt(match[2], 10), soundTitle: match[3].trim() };
}

async function buscarSonidoRealBlerp(term) {
  try {
    const CORS_PROXY = 'https://api.allorigins.win/raw?url=';
    const BLERP_GRAPHQL = 'https://api.blerp.com/graphql';
    const query = `fragment B on Bite{_id title image{filename original{url}}audio{filename mp3{url}}price owned bitPrice totalSaveCount ownerId isPremium audioDuration sourceUrl ownerObject{_id username}}query q($s:String){web{biteSearchResults:biteElasticSearch(query:$s,page:1,perPage:8){items{...B}}}}`;
    const r = await fetch(CORS_PROXY + encodeURIComponent(BLERP_GRAPHQL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationName: 'q', variables: { s: term }, query })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    const items = json?.data?.web?.biteSearchResults?.items || [];
    return items.slice(0, 8).map(item => ({
      id: item._id,
      title: item.title,
      mp3Url: item.audio?.mp3?.url || null,
      imageUrl: item.image?.original?.url || null,
      audioDuration: item.audioDuration || 0,
      isPremium: !!item.isPremium,
      totalSaveCount: item.totalSaveCount || 0,
      owner: item.ownerObject?.username || null,
    }));
  } catch (e) {
    console.warn('[Blerp] Search error:', e.message);
    return [];
  }
}

function mostrarBlerpOpciones(matches) {
  _blerpRealMatches = matches || [];
  const container = document.getElementById('blerp-real-options');
  if (!container) return;
  container.innerHTML = '';
  if (!_blerpRealMatches.length) { container.style.display = 'none'; mostrarBlerpSeleccion(null); return; }
  const label = document.createElement('div');
  label.className = 'blerp-real-options-label';
  label.textContent = _blerpRealMatches.length > 1 ? `Se encontraron ${_blerpRealMatches.length} sonidos` : 'Sonido encontrado en Blerp:';
  container.appendChild(label);
  const row = document.createElement('div');
  row.className = 'blerp-real-options-row';
  _blerpRealMatches.forEach((m, i) => {
    const btn = document.createElement('button');
    btn.className = 'blerp-real-option' + (i === 0 ? ' active' : '');
    btn.innerHTML = `<img src="${m.imageUrl || ''}" alt="" style="width:40px;height:40px;border-radius:6px;object-fit:cover;background:#222"> <span>${escapeHtml(m.title)}</span>`;
    btn.title = `Por ${m.owner || 'desconocido'} · ${m.totalSaveCount || 0} saves`;
    btn.onclick = () => {
      document.querySelectorAll('.blerp-real-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      mostrarBlerpSeleccion(m);
    };
    row.appendChild(btn);
  });
  container.appendChild(row);
  container.style.display = 'block';
  if (_blerpRealMatches[0]) mostrarBlerpSeleccion(_blerpRealMatches[0]);
}

function mostrarBlerpSeleccion(match) {
  _blerpRealMatch = match;
  const panel = document.getElementById('blerp-real-sound');
  const imgEl = document.getElementById('blerp-real-img');
  const titleEl = document.getElementById('blerp-real-title');
  const metaEl = document.getElementById('blerp-real-meta');
  const audioEl = document.getElementById('blerp-real-audio');
  const dlBtn = document.getElementById('btn-blerp-real-download');
  if (!panel) return;
  if (!match) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  if (imgEl) imgEl.src = match.imageUrl || '';
  if (titleEl) titleEl.textContent = match.title || 'Sin título';
  if (metaEl) metaEl.textContent = `Por ${match.owner || 'desconocido'} · ${(match.audioDuration / 1000).toFixed(1)}s · ${match.totalSaveCount || 0} saves`;
  if (audioEl) {
    if (match.mp3Url) { audioEl.src = match.mp3Url; audioEl.style.display = 'block'; }
    else { audioEl.style.display = 'none'; }
  }
  if (dlBtn) dlBtn.style.display = match.mp3Url ? 'inline-flex' : 'none';
}

function openBlerpCard(msg) {
  _blerpMsg = msg;
  _blerpEvento = parseBlerpRedeemEvent(msg.text);
  const soundTitle = _blerpEvento ? _blerpEvento.soundTitle : extractBlerpSoundTitle(msg.text) || msg.text;
  _blerpAvatar = null;
  _blerpSoundImage = null;

  // Load avatar
  if (msg.displayName) {
    const avatarUrl = `https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(msg.displayName)}`;
    fetch(avatarUrl).then(r => r.json()).then(data => {
      const u = Array.isArray(data) ? data[0] : data;
      if (u?.profile_image_url) loadImage(u.profile_image_url).then(img => { _blerpAvatar = img; renderBlerpOverlay(); });
    }).catch(() => {});
  }

  // Load sound image from Blerp
  buscarSonidoRealBlerp(soundTitle).then(matches => {
    mostrarBlerpOpciones(matches);
    if (matches.length > 0 && matches[0]?.imageUrl) {
      loadImage(matches[0].imageUrl).then(img => { _blerpSoundImage = img; renderBlerpOverlay(); });
    }
  });

  // Show Blerp tab
  setSource('blerp');

  renderBlerpOverlay();
}

function renderBlerpOverlay() {
  const canvas = document.getElementById('blerp-canvas');
  if (!canvas) return;
  const DPR = 2;
  const W = 600, H = 140;
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (_blerpAnimRaf) { cancelAnimationFrame(_blerpAnimRaf); _blerpAnimRaf = null; }
  const msg = _blerpMsg;
  const evento = _blerpEvento;
  if (!msg) return;
  const displayName = evento ? evento.redeemer : msg.displayName;
  const soundTitle = evento ? evento.soundTitle : extractBlerpSoundTitle(msg.text) || msg.text || 'Sonido';
  const bitsText = evento && evento.bits ? `${evento.bits} bits` : '';
  const startTime = performance.now();
  function drawFrame() {
    const elapsed = (performance.now() - startTime) / 1000;
    const progress = Math.min(elapsed / 0.5, 1); // 0.5s slide-in
    const eased = 1 - Math.pow(1 - progress, 3);
    const offsetX = (1 - eased) * W;
    ctx.clearRect(0, 0, W, H);
    // Background gradient
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, _blerpStyle.bg1);
    g.addColorStop(1, _blerpStyle.bg2);
    ctx.fillStyle = g;
    roundRectBlerp(ctx, offsetX, 0, W - offsetX, H, 16);
    ctx.fill();
    if (_blerpStyle.borderEnabled) {
      ctx.strokeStyle = _blerpStyle.border;
      ctx.lineWidth = 3;
      roundRectBlerp(ctx, offsetX, 0, W - offsetX, H, 16);
      ctx.stroke();
    }
    // Avatar
    const avSize = 90;
    const avX = offsetX + 25;
    const avY = (H - avSize) / 2;
    if (_blerpSoundImage) {
      ctx.save(); ctx.beginPath(); ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
      ctx.drawImage(_blerpSoundImage, avX, avY, avSize, avSize); ctx.restore();
    } else if (_blerpAvatar) {
      ctx.save(); ctx.beginPath(); ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
      ctx.drawImage(_blerpAvatar, avX, avY, avSize, avSize); ctx.restore();
    } else {
      ctx.fillStyle = '#9146ff'; ctx.beginPath(); ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 36px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((displayName || '?')[0].toUpperCase(), avX + avSize / 2, avY + avSize / 2);
    }
    // Text
    const textX = offsetX + 130;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 28px Inter, sans-serif';
    ctx.fillText(escapeHtml(displayName || ''), textX, 45);
    ctx.fillStyle = '#c0b0e0';
    ctx.font = '500 18px Inter, sans-serif';
    ctx.fillText(escapeHtml(soundTitle), textX, 80);
    if (bitsText) {
      ctx.fillStyle = '#ffbb00';
      ctx.font = '600 16px Inter, sans-serif';
      ctx.fillText(bitsText, textX, 110);
    }
    if (elapsed < 3) {
      _blerpAnimRaf = requestAnimationFrame(drawFrame);
    } else {
      // Loop
      _blerpAnimRaf = requestAnimationFrame(() => { startTime = performance.now(); drawFrame(); });
    }
  }
  drawFrame();
  const statusEl = document.getElementById('blerp-status');
  if (statusEl) statusEl.textContent = `Mostrando: ${escapeHtml(displayName)} → ${escapeHtml(soundTitle)}`;
}

function roundRectBlerp(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

function initBlerpStyleControls() {
  try {
    const saved = JSON.parse(localStorage.getItem('blerpStyle') || 'null');
    if (saved) _blerpStyle = { ...BLERP_STYLE_DEFAULTS, ...saved };
  } catch (e) {}
  const bg1 = document.getElementById('blerp-style-bg1');
  const bg2 = document.getElementById('blerp-style-bg2');
  const border = document.getElementById('blerp-style-border');
  const borderEnabled = document.getElementById('blerp-style-border-enabled');
  const resetBtn = document.getElementById('btn-blerp-style-reset');
  if (!bg1 || !bg2 || !border || !borderEnabled) return;
  function syncInputsFromState() { bg1.value = _blerpStyle.bg1; bg2.value = _blerpStyle.bg2; border.value = _blerpStyle.border; borderEnabled.checked = _blerpStyle.borderEnabled; }
  function persist() { try { localStorage.setItem('blerpStyle', JSON.stringify(_blerpStyle)); } catch (e) {} }
  syncInputsFromState();
  bg1.oninput = () => { _blerpStyle.bg1 = bg1.value; persist(); };
  bg2.oninput = () => { _blerpStyle.bg2 = bg2.value; persist(); };
  border.oninput = () => { _blerpStyle.border = border.value; persist(); };
  borderEnabled.onchange = () => { _blerpStyle.borderEnabled = borderEnabled.checked; persist(); };
  if (resetBtn) {
    resetBtn.onclick = () => { _blerpStyle = { ...BLERP_STYLE_DEFAULTS }; syncInputsFromState(); persist(); };
  }
}

async function downloadBlerpPng() {
  const canvas = document.getElementById('blerp-canvas');
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = `blerp-overlay-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

async function downloadBlerpGif() {
  const canvas = document.getElementById('blerp-canvas');
  if (!canvas) return;
  if (_blerpIsRecording) return;
  _blerpIsRecording = true;
  const btn = document.getElementById('btn-blerp-gif');
  if (btn) { btn.disabled = true; btn.textContent = 'Generando...'; }
  const gif = new GIF({
    workers: 4, quality: 10, transparent: 'rgba(0,0,0,0)',
    workerScript: 'js/gif.worker.js', width: canvas.width, height: canvas.height
  });
  const fps = 30;
  const frameDelay = Math.round(1000 / fps);
  const totalFrames = 90; // 3 seconds
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < totalFrames; i++) {
    renderBlerpFrameAt(i * frameDelay);
    gif.addFrame(canvas, { delay: frameDelay, copy: true });
  }
  gif.on('finished', blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = `blerp-overlay-${Date.now()}.gif`;
    a.href = url; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    _blerpIsRecording = false;
    if (btn) { btn.disabled = false; btn.textContent = 'GIF animado'; }
  });
  gif.render();
}

function renderBlerpFrameAt(timeMs) {
  const canvas = document.getElementById('blerp-canvas');
  if (!canvas) return;
  const DPR = 2;
  const W = 600, H = 140;
  const ctx = canvas.getContext('2d');
  const progress = Math.min(timeMs / 500, 1);
  const eased = 1 - Math.pow(1 - progress, 3);
  const offsetX = (1 - eased) * W;
  ctx.clearRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, _blerpStyle.bg1);
  g.addColorStop(1, _blerpStyle.bg2);
  ctx.fillStyle = g;
  roundRectBlerp(ctx, offsetX, 0, W - offsetX, H, 16);
  ctx.fill();
  if (_blerpStyle.borderEnabled) {
    ctx.strokeStyle = _blerpStyle.border;
    ctx.lineWidth = 3;
    roundRectBlerp(ctx, offsetX, 0, W - offsetX, H, 16);
    ctx.stroke();
  }
  const msg = _blerpMsg;
  const evento = _blerpEvento;
  if (!msg) return;
  const displayName = evento ? evento.redeemer : msg.displayName;
  const soundTitle = evento ? evento.soundTitle : extractBlerpSoundTitle(msg.text) || msg.text || 'Sonido';
  const bitsText = evento && evento.bits ? `${evento.bits} bits` : '';
  const avSize = 90;
  const avX = offsetX + 25;
  const avY = (H - avSize) / 2;
  if (_blerpSoundImage) {
    ctx.save(); ctx.beginPath(); ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    ctx.drawImage(_blerpSoundImage, avX, avY, avSize, avSize); ctx.restore();
  } else if (_blerpAvatar) {
    ctx.save(); ctx.beginPath(); ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    ctx.drawImage(_blerpAvatar, avX, avY, avSize, avSize); ctx.restore();
  } else {
    ctx.fillStyle = '#9146ff'; ctx.beginPath(); ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 36px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((displayName || '?')[0].toUpperCase(), avX + avSize / 2, avY + avSize / 2);
  }
  const textX = offsetX + 130;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 28px Inter, sans-serif';
  ctx.fillText(escapeHtml(displayName || ''), textX, 45);
  ctx.fillStyle = '#c0b0e0';
  ctx.font = '500 18px Inter, sans-serif';
  ctx.fillText(escapeHtml(soundTitle), textX, 80);
  if (bitsText) {
    ctx.fillStyle = '#ffbb00';
    ctx.font = '600 16px Inter, sans-serif';
    ctx.fillText(bitsText, textX, 110);
  }
}

async function downloadBlerpRealMp3() {
  if (!_blerpRealMatch || !_blerpRealMatch.mp3Url) return;
  const a = document.createElement('a');
  a.href = _blerpRealMatch.mp3Url;
  a.download = `blerp-${_blerpRealMatch.title?.replace(/[^a-zA-Z0-9]/g, '_') || 'sound'}-${Date.now()}.mp3`;
  a.click();
}

// Expose for HTML onclick
window.downloadBlerpPng = downloadBlerpPng;
window.downloadBlerpGif = downloadBlerpGif;
window.downloadBlerpRealMp3 = downloadBlerpRealMp3;
window.downloadMessageCard = downloadMessageCard;
window.openBlerpCard = openBlerpCard;

// Init on DOM ready
document.addEventListener('DOMContentLoaded', init);
