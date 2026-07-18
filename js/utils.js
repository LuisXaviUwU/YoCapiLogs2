// YoCapi App - Shared Utilities

// ===== Config =====
const API_BASE = 'https://logs.zonian.dev'; // External Twitch log API
const BADGE_GLOBAL = 'https://api.ivr.fi/v2/twitch/badges/global';
const BADGE_CHANNEL = (channelId) => `https://api.ivr.fi/v2/twitch/badges/channel?id=${encodeURIComponent(channelId)}`;
const EMOTE_URL = (id, size = '1.0') => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/${size}`;

// Third-party emote API endpoints
const BTTV_GLOBAL_URL = 'https://api.betterttv.net/3/cached/emotes/global';
const BTTV_CHANNEL_URL = (id) => `https://api.betterttv.net/3/cached/users/twitch/${id}`;
const FFZ_CHANNEL_URL = (id) => `https://api.frankerfacez.com/v1/room/id/${id}`;
const SEVENTV_GLOBAL_URL = 'https://7tv.io/v3/emote-sets/global';
const SEVENTV_CHANNEL_URL = (id) => `https://7tv.io/v3/users/twitch/${id}`;

const BADGE_FALLBACK_EMOJI = {
  moderator: '🛡️', subscriber: '⭐', broadcaster: '📡', vip: '💎',
  partner: '✅', staff: '🔧', admin: '🔑', bits: '💎', turbo: '⚡',
  premium: '👑', 'hype-train': '🚂', 'sub-gifter': '🎁', 'sub-gift-leader': '🥇',
  'bits-leader': '🏆', founder: '🌟', glitchcon2020: '🎮',
};

// ===== Common State =====
let badgeCache = {};
let thirdPartyEmotes = {};
let channelId = null;
let userHistory = {};
const _imgCache = new Map();

// ===== Utility Functions =====

function escapeHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function sanitizeColor(c) {
  return /^#[0-9A-Fa-f]{6}$/.test(c) ? c : '#a970ff';
}

function highlightText(html, q) {
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(new RegExp(`(${esc})`, 'gi'), '<mark class="hl">$1</mark>');
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function normalizeStr(str) {
  return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function hexToRgba(hex, alpha) {
  const clean = (hex || '').replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function usernameColor(name) {
  if (!name) return '#a970ff';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

// ===== Image Loading (GitHub Pages compatible — no proxy) =====

function loadImage(url) {
  if (_imgCache.has(url)) return Promise.resolve(_imgCache.get(url));
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { _imgCache.set(url, img); resolve(img); };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * loadEmoteWithFrames — versión sin proxy para GitHub Pages.
 * Las CDNs de Twitch, BTTV y 7TV permiten CORS directamente desde el browser.
 * Usa fetch() directo con mode:'cors'. Si falla, carga como <img> estática.
 */
async function loadEmoteWithFrames(url) {
  const cacheKey = 'anim:' + url;
  if (_imgCache.has(cacheKey)) return _imgCache.get(cacheKey);

  if (typeof ImageDecoder !== 'undefined') {
    try {
      const res = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        try {
          const buffer = await res.arrayBuffer();
          let contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
          // Detect format from magic bytes if content-type is ambiguous
          if (!contentType || contentType === 'application/octet-stream') {
            const bytes = new Uint8Array(buffer, 0, 12);
            if (bytes[0] === 0x47 && bytes[1] === 0x49) contentType = 'image/gif';
            else if (bytes[0] === 0x52 && bytes[1] === 0x49) contentType = 'image/webp';
            else if (bytes[0] === 0x89 && bytes[1] === 0x50) contentType = 'image/png';
            else if (bytes[0] === 0xFF && bytes[1] === 0xD8) contentType = 'image/jpeg';
            else contentType = url.includes('.webp') ? 'image/webp' : 'image/gif';
          }
          // Some servers return webp but say gif
          if (contentType === 'image/gif') {
            const bytes = new Uint8Array(buffer, 0, 4);
            if (bytes[0] === 0x52 && bytes[1] === 0x49) contentType = 'image/webp';
          }
          const decoder = new ImageDecoder({ data: buffer, type: contentType });
          await decoder.tracks.ready;
          const track = decoder.tracks.selectedTrack;
          if (!track || !track.frameCount) throw new Error('No tracks');
          const frames = [];
          let totalDuration = 0;
          for (let i = 0; i < track.frameCount; i++) {
            const result = await decoder.decode({ frameIndex: i });
            const dur = (result.image.duration / 1000) || 50;
            const bmp = await createImageBitmap(result.image);
            result.image.close();
            frames.push({ img: bmp, duration: dur, timeStart: totalDuration });
            totalDuration += dur;
          }
          if (frames.length > 1) {
            const obj = { type: 'animated', frames, img: frames[0].img, totalDuration };
            _imgCache.set(cacheKey, obj);
            return obj;
          } else if (frames.length === 1) {
            const obj = { type: 'static', img: frames[0].img };
            _imgCache.set(cacheKey, obj);
            return obj;
          }
        } catch (e) {
          // Fall through to static load
        }
      }
    } catch (e) { /* fall through */ }
  }

  // Fallback: load as static image
  const img = await loadImage(url);
  const obj = { type: 'static', img };
  _imgCache.set(cacheKey, obj);
  return obj;
}

// ===== Badge Loading =====

async function loadBadges(roomId) {
  badgeCache = {};
  const processIvrArray = (arr) => {
    if (!Array.isArray(arr)) return 0;
    let count = 0;
    for (const badgeSet of arr) {
      const setId = badgeSet.set_id;
      for (const v of (badgeSet.versions || [])) {
        const url = v.image_url_2x || v.image_url_4x || v.image_url_1x;
        if (url) {
          badgeCache[`${setId}/${v.id}`] = { url, title: v.title || setId };
          count++;
        }
      }
    }
    return count;
  };
  const tryFetch = async (url) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  const [globalRes, channelRes] = await Promise.allSettled([
    tryFetch(BADGE_GLOBAL),
    tryFetch(BADGE_CHANNEL(roomId)),
  ]);
  let loaded = 0;
  if (globalRes.status === 'fulfilled') loaded += processIvrArray(globalRes.value);
  if (channelRes.status === 'fulfilled') loaded += processIvrArray(channelRes.value);
  return loaded;
}

// ===== Third-Party Emote Loading =====

async function ensureThirdPartyEmotesByName(channelName) {
  try {
    const r = await fetch(`https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(channelName)}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const id = Array.isArray(data) ? data[0]?.id : data?.id;
    if (id) {
      channelId = id;
      await Promise.all([loadBadges(id), loadThirdPartyEmotes(id)]);
    }
  } catch (e) {
    console.warn('[3P Emotes] Error resolving room-id by name:', e.message);
  }
}

async function loadThirdPartyEmotes(roomId) {
  thirdPartyEmotes = {};
  let count = 0;
  const safe = async (url) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    } catch (e) { return null; }
  };
  const bttvGlobal = await safe(BTTV_GLOBAL_URL);
  if (Array.isArray(bttvGlobal)) {
    for (const e of bttvGlobal) {
      if (e.code && e.id) { thirdPartyEmotes[e.code] = `https://cdn.betterttv.net/emote/${e.id}/2x`; count++; }
    }
  }
  const bttvChannel = await safe(BTTV_CHANNEL_URL(roomId));
  if (bttvChannel) {
    const combined = [...(bttvChannel.channelEmotes || []), ...(bttvChannel.sharedEmotes || [])];
    for (const e of combined) {
      if (e.code && e.id) { thirdPartyEmotes[e.code] = `https://cdn.betterttv.net/emote/${e.id}/2x`; count++; }
    }
  }
  const ffz = await safe(FFZ_CHANNEL_URL(roomId));
  if (ffz?.sets) {
    for (const set of Object.values(ffz.sets)) {
      for (const e of (set.emoticons || [])) {
        if (e.name && e.urls) {
          const url = e.urls['2'] || e.urls['1'];
          if (url) { thirdPartyEmotes[e.name] = url.startsWith('http') ? url : 'https:' + url; count++; }
        }
      }
    }
  }
  const stv = await safe(SEVENTV_GLOBAL_URL);
  if (stv?.emotes) {
    for (const e of stv.emotes) {
      const name = e.name;
      const file = e.data?.host?.files?.find(f => f.name === '2x.gif' || f.name === '2x.avif' || f.name === '2x.webp' || f.name === '2x.png') || e.data?.host?.files?.[0];
      if (name && file && e.data?.host?.url) { thirdPartyEmotes[name] = `https:${e.data.host.url}/${file.name}`; count++; }
    }
  }
  const stvChannel = await safe(SEVENTV_CHANNEL_URL(roomId));
  const stvSet = stvChannel?.emote_set?.emotes;
  if (Array.isArray(stvSet)) {
    for (const e of stvSet) {
      const name = e.name;
      const file = e.data?.host?.files?.find(f => f.name === '2x.gif' || f.name === '2x.avif' || f.name === '2x.webp' || f.name === '2x.png') || e.data?.host?.files?.[0];
      if (name && file && e.data?.host?.url) { thirdPartyEmotes[name] = `https:${e.data.host.url}/${file.name}`; count++; }
    }
  }
  return count;
}

// ===== Badge/Emote Display Helpers =====

function buildBadgesEl(tags) {
  const wrap = document.createElement('span');
  wrap.className = 'msg-badges';
  if (!tags?.badges) return wrap;
  const pairs = tags.badges.split(',').filter(Boolean);
  for (const pair of pairs) {
    const cached = badgeCache[pair];
    const [setId, version] = pair.split('/');
    if (cached?.url) {
      const img = document.createElement('img');
      img.className = 'badge-img';
      img.alt = cached.title || badgeLabel(setId, version);
      img.title = cached.title || badgeLabel(setId, version);
      img.loading = 'lazy';
      img.width = 18; img.height = 18;
      img.src = cached.url;
      img.onerror = () => { const em = makeBadgeEmoji(setId, version); img.parentNode?.replaceChild(em, img); };
      wrap.appendChild(img);
    } else {
      wrap.appendChild(makeBadgeEmoji(setId, version));
    }
  }
  return wrap;
}

function makeBadgeEmoji(setId, version) {
  const emoji = BADGE_FALLBACK_EMOJI[setId] || null;
  if (!emoji) return document.createDocumentFragment();
  const span = document.createElement('span');
  span.className = 'badge-emoji';
  span.title = badgeLabel(setId, version);
  span.textContent = emoji;
  return span;
}

function badgeLabel(set, version) {
  const labels = {
    moderator: 'Moderador', subscriber: `Suscriptor (${version} meses)`,
    broadcaster: 'Streamer', vip: 'VIP', partner: 'Partner',
    staff: 'Staff', admin: 'Admin', bits: `Bits: ${version}`,
    'sub-gift-leader': 'Gifter líder', 'sub-gifter': `Gift subs: ${version}`,
    'hype-train': 'Hype Train', 'bits-leader': 'Bits líder',
    turbo: 'Turbo', premium: 'Prime Gaming',
  };
  return labels[set] || set;
}

function buildMessageBody(msg, filterVal) {
  const span = document.createElement('span');
  span.className = 'msg-text';
  const text = msg.text || '';
  const emotesTag = msg.tags?.emotes || '';
  const emoteMap = [];
  if (emotesTag) {
    for (const chunk of emotesTag.split('/')) {
      const [emoteId, positions] = chunk.split(':');
      if (!positions) continue;
      for (const pos of positions.split(',')) {
        const [s, e] = pos.split('-').map(Number);
        emoteMap.push({ start: s, end: e, id: emoteId });
      }
    }
    emoteMap.sort((a, b) => a.start - b.start);
  }

  function appendTextWithThirdParty(parent, rawText) {
    if (!rawText) return;
    const hasTp = Object.keys(thirdPartyEmotes).length > 0;
    const hasTwitchIds = window.twitchEmoteIds && Object.keys(window.twitchEmoteIds).length > 0;
    if (!hasTp && !hasTwitchIds) {
      const t = document.createElement('span');
      t.innerHTML = filterVal ? highlightText(escapeHtml(rawText), filterVal) : escapeHtml(rawText);
      parent.appendChild(t);
      return;
    }
    const tokens = rawText.split(/(\s+)/);
    for (const token of tokens) {
      if (/^\s+$/.test(token) || token === '') {
        parent.appendChild(document.createTextNode(token));
        continue;
      }
      const tpUrl = thirdPartyEmotes[token];
      if (tpUrl) {
        const img = document.createElement('img');
        img.className = 'emote-img emote-tp';
        img.src = tpUrl;
        img.alt = token;
        img.title = token + ' (emote)';
        img.loading = 'lazy';
        img.width = 28; img.height = 28;
        parent.appendChild(img);
      } else if (window.twitchEmoteIds && window.twitchEmoteIds[token]) {
        const img = document.createElement('img');
        img.className = 'emote-img emote-tp';
        img.src = EMOTE_URL(window.twitchEmoteIds[token], '2.0');
        img.alt = token;
        img.title = token + ' (emote)';
        img.loading = 'lazy';
        img.width = 28; img.height = 28;
        parent.appendChild(img);
      } else {
        const t = document.createElement('span');
        t.innerHTML = filterVal ? highlightText(escapeHtml(token), filterVal) : escapeHtml(token);
        parent.appendChild(t);
      }
    }
  }

  if (emoteMap.length === 0) {
    appendTextWithThirdParty(span, text);
    return span;
  }

  let cursor = 0;
  const characters = Array.from(text);
  for (const { start, end, id } of emoteMap) {
    if (start > cursor) {
      const slice = characters.slice(cursor, start).join('');
      appendTextWithThirdParty(span, slice);
    }
    const emoteName = characters.slice(start, end + 1).join('');
    const img = document.createElement('img');
    img.className = 'emote-img';
    img.src = EMOTE_URL(id);
    img.srcset = `${EMOTE_URL(id, '1.0')} 1x, ${EMOTE_URL(id, '2.0')} 2x, ${EMOTE_URL(id, '3.0')} 3x`;
    img.alt = emoteName;
    img.title = emoteName;
    img.loading = 'lazy';
    img.width = 28; img.height = 28;
    span.appendChild(img);
    cursor = end + 1;
  }
  if (cursor < characters.length) {
    const slice = characters.slice(cursor).join('');
    appendTextWithThirdParty(span, slice);
  }
  return span;
}

// Expose globally
window.escapeHtml = escapeHtml;
window.sanitizeColor = sanitizeColor;
window.highlightText = highlightText;
window.debounce = debounce;
window.normalizeStr = normalizeStr;
window.hexToRgba = hexToRgba;
window.usernameColor = usernameColor;
window.loadImage = loadImage;
window.loadEmoteWithFrames = loadEmoteWithFrames;
window.loadBadges = loadBadges;
window.loadThirdPartyEmotes = loadThirdPartyEmotes;
window.ensureThirdPartyEmotesByName = ensureThirdPartyEmotesByName;
window.buildBadgesEl = buildBadgesEl;
window.buildMessageBody = buildMessageBody;
window.badgeCache = badgeCache;
window.thirdPartyEmotes = thirdPartyEmotes;
window.channelId = channelId;
window.EMOTE_URL = EMOTE_URL;
window.API_BASE = API_BASE;
