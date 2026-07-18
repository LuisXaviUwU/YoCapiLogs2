// YoCapi App - Supabase Client (REST API direct, no library needed)
const SUPABASE_URL = 'https://rvmkbowpcmkpevoizzgm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ2bWtib3dwY21rcGV2b2l6emdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzMjk4MjcsImV4cCI6MjA5OTkwNTgyN30.twdZmtLVurUUA7UjGNvZlm29ifaiTtRoBGSGTbzcJco';

function supabaseFetch(path, opts = {}) {
  const url = `${SUPABASE_URL}${path}`;
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    ...opts.headers,
  };
  if (opts.auth !== false) {
    const token = localStorage.getItem('supabase_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(url, { ...opts, headers }).then(r => {
    if (!r.ok) return r.json().then(e => { throw e; }).catch(() => { throw new Error(`HTTP ${r.status}`); });
    const ct = r.headers.get('content-type') || '';
    return ct.includes('application/json') ? r.json() : r.text();
  });
}

// --- Saved Logs (Public) ---

async function getSavedLogsList(channel) {
  try {
    const data = await supabaseFetch(`/rest/v1/saved_logs?select=date&channel=eq.${encodeURIComponent(channel.toLowerCase())}&order=date.desc`);
    const tree = {};
    for (const row of data || []) {
      const [year, month, day] = row.date.split('-');
      if (!year || !month) continue;
      if (!tree[year]) tree[year] = {};
      if (!tree[year][month]) tree[year][month] = [];
      if (day) tree[year][month].push(row.date);
    }
    return tree;
  } catch (e) {
    console.error('[Supabase] Error fetching saved logs list:', e.message);
    return {};
  }
}

async function getSavedLog(channel, date) {
  try {
    const rows = await supabaseFetch(`/rest/v1/saved_logs?select=messages&channel=eq.${encodeURIComponent(channel.toLowerCase())}&date=eq.${encodeURIComponent(date)}`);
    return rows && rows.length > 0 ? { messages: rows[0].messages } : null;
  } catch (e) {
    console.error('[Supabase] Error fetching saved log:', e.message);
    return null;
  }
}

async function saveLogsLocallySupabase(channel, date, messages) {
  try {
    const body = { channel: channel.toLowerCase(), date, messages };
    await supabaseFetch('/rest/v1/saved_logs?on_conflict=channel,date', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    });
    return { ok: true, saved: messages.length };
  } catch (e) {
    console.error('[Supabase] Error saving logs:', e.message);
    return { ok: false, error: e.message };
  }
}

async function deleteLogDay(channel, date) {
  try {
    await supabaseFetch(
      `/rest/v1/saved_logs?channel=eq.${encodeURIComponent(channel.toLowerCase())}&date=eq.${encodeURIComponent(date)}`,
      { method: 'DELETE' }
    );
    return { ok: true };
  } catch (e) {
    console.error('[Supabase] Error deleting log day:', e.message);
    return { ok: false, error: e.message };
  }
}

async function checkCompileStatus(channel, month) {
  try {
    const data = await supabaseFetch(`/rest/v1/saved_logs?select=id&channel=eq.${encodeURIComponent(channel.toLowerCase())}&date=like.${encodeURIComponent(month + '-%')}`);
    if (!data || data.length === 0) return false;
    const [y, m] = month.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    return data.length >= daysInMonth;
  } catch (e) {
    return false;
  }
}

// --- Search History (Public) ---

async function getSearchHistory(limit = 50) {
  try {
    return await supabaseFetch(`/rest/v1/rpc/get_search_history`, {
      method: 'POST',
      body: JSON.stringify({ limit_count: limit }),
    });
  } catch (e) {
    console.error('[Supabase] Error fetching search history:', e.message);
    return [];
  }
}

async function upsertSearchHistory(username, displayName) {
  try {
    await supabaseFetch(`/rest/v1/rpc/update_search_history`, {
      method: 'POST',
      body: JSON.stringify({ p_username: username.toLowerCase(), p_display_name: displayName }),
    });
  } catch (e) {
    console.error('[Supabase] Error updating search history:', e.message);
  }
}

// --- Emote Cache ---

async function getEmoteCache() {
  try {
    const data = await supabaseFetch('/rest/v1/emote_cache?select=name,url,emote_id');
    const map = {};
    for (const row of data || []) {
      map[row.name] = row.emote_id ? { url: row.url, id: row.emote_id } : row.url;
    }
    return map;
  } catch (e) {
    console.error('[Supabase] Error fetching emote cache:', e.message);
    return {};
  }
}

// --- Twitch Auth (Admin only) ---

async function getAdminTwitchConfig() {
  try {
    const user = await supabaseFetch('/auth/v1/user');
    if (!user || !user.id) return null;
    const data = await supabaseFetch(`/rest/v1/admin_profiles?select=twitch_client_id,twitch_client_secret&id=eq.${encodeURIComponent(user.id)}`);
    return data && data.length > 0 ? data[0] : null;
  } catch (e) {
    return null;
  }
}

async function saveAdminTwitchConfig(clientId, clientSecret) {
  try {
    const user = await supabaseFetch('/auth/v1/user');
    if (!user || !user.id) return { ok: false, error: 'Not authenticated' };
    await supabaseFetch('/rest/v1/admin_profiles', {
      method: 'POST',
      body: JSON.stringify({
        id: user.id,
        email: user.email,
        twitch_client_id: clientId,
        twitch_client_secret: clientSecret,
      }),
      headers: { 'Prefer': 'resolution=merge-duplicates' },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// --- Auth helpers ---

async function supabaseSignIn(email, password) {
  const data = await supabaseFetch('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    auth: false,
  });
  if (data.access_token) {
    localStorage.setItem('supabase_token', data.access_token);
  }
  return data;
}

async function supabaseSignUp(email, password) {
  return supabaseFetch('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    auth: false,
  });
}

async function supabaseSignOut() {
  localStorage.removeItem('supabase_token');
}

async function supabaseGetUser() {
  const token = localStorage.getItem('supabase_token');
  if (!token) return null;
  try {
    return await supabaseFetch('/auth/v1/user');
  } catch (e) {
    localStorage.removeItem('supabase_token');
    return null;
  }
}

// Expose globally
window.getSavedLogsList = getSavedLogsList;
window.getSavedLog = getSavedLog;
window.saveLogsLocallySupabase = saveLogsLocallySupabase;
window.deleteLogDay = deleteLogDay;
window.checkCompileStatus = checkCompileStatus;
window.getSearchHistory = getSearchHistory;
window.upsertSearchHistory = upsertSearchHistory;
window.getEmoteCache = getEmoteCache;
window.getAdminTwitchConfig = getAdminTwitchConfig;
window.saveAdminTwitchConfig = saveAdminTwitchConfig;
window.supabaseSignIn = supabaseSignIn;
window.supabaseSignUp = supabaseSignUp;
window.supabaseSignOut = supabaseSignOut;
window.supabaseGetUser = supabaseGetUser;
