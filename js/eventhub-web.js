// ═══════════════════════════════════════════════════════════════
// ─── EVENTHUB WEB — Visor en vivo desde Firestore ───────────────
// ═══════════════════════════════════════════════════════════════
// Escucha la colección live_events/{channel}/events y renderiza
// los eventos (Speak, Bits, Rachas) en tiempo real en la web.

(function () {
    'use strict';

    const CHANNEL = 'yocapi_pr';

    // ── Estado ──────────────────────────────────────────────────
    let _unsubscribe = null;
    let _events = [];
    let _initialized = false;

    // ── Iconos SVG ───────────────────────────────────────────────
    const ICONS = {
        speak: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
        bits:  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
        streak:`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2c-4 6 2 10 0 14 0 0-6-4-2-10C6 10 4 14 4 18c0 3.31 3.58 6 8 6s8-2.69 8-6c0-6-8-10-8-16z"/></svg>`,
    };

    // ── Mapa de tipos ─────────────────────────────────────────────
    const TYPE_MAP = {
        'channel.cheer': {
            label: 'Bits',
            color: '#9146ff',
            badge: 'BITS',
            badgeColor: '#9146ff',
            summary: (d) => {
                const bits = d.bits || d.data_bits || '?';
                const user = d.is_anonymous ? 'Anónimo' : (d.user_name || d.data_user_name || 'Alguien');
                const rawMsg = d.message || d.data_message || '';
                const msg = rawMsg.replace(/\bCheer\d+\b\s*/gi, '').trim();
                return `<strong>${user}</strong> Ha enviado un Cheer de <strong>${bits} ${bits == 1 ? 'Bit' : 'Bits'}</strong>${msg ? '<br><span class="eh-web-msg">"' + parseEmoteText(msg) + '"</span>' : ''}`;
            }
        },
        'channel.channel_points_custom_reward_redemption.add': {
            label: 'Recompensa',
            color: '#00b5ad',
            badge: 'RECOMPENSA',
            badgeColor: '#00b5ad',
            summary: (d) => {
                const user  = d.user_name || d.data_user_name || 'Alguien';
                const input = d.user_input || d.data_user_input || '';
                const rewardTitle = (d.reward && d.reward.title) || (d.data_reward_title) || 'Recompensa';
                return `<strong>${escHtml(rewardTitle)}</strong> <strong>${user}</strong>${input ? '<br><span class="eh-web-msg">"' + parseEmoteText(input) + '"</span>' : ''}`;
            }
        },
        'stream.streak': {
            label: 'Racha',
            color: '#ff6b6b',
            badge: 'RACHA',
            badgeColor: '#ff6b6b',
            summary: (d) => {
                const user  = d.user_name || d.data_user_name || 'Alguien';
                const count = d.count || d.data_count || '?';
                let st  = d.streak_text || d.data_streak_text || '';
                st = st.replace(/\u00c2\u00b7/g, '\u00b7');
                let sep = st.indexOf('·');
                if (sep === -1) sep = st.indexOf('\u00b7');
                const extra = sep !== -1 ? st.slice(sep + 1).trim() : st;
                return `<strong>${user}</strong> Has logrado una racha de visualizaciones de <strong>${count}</strong> streams${extra ? '<br><span class="eh-web-msg">"' + parseEmoteText(extra) + '"</span>' : ''}`;
            }
        },
    };

    // ── Helpers ───────────────────────────────────────────────────
    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function timeAgo(iso) {
        try {
            const diff = Date.now() - new Date(iso).getTime();
            const s = Math.floor(diff / 1000);
            if (s < 60)  return 'hace ' + s + 's';
            const m = Math.floor(s / 60);
            if (m < 60)  return 'hace ' + m + 'm';
            const h = Math.floor(m / 60);
            return 'hace ' + h + 'h';
        } catch (_) { return ''; }
    }

    // ── Global map for downloading events ─────────────────────────
    const _eventMap = {};

    window.ehWebDownloadEvent = function(id) {
        const event = _eventMap[id];
        if (!event) return;
        const d = event.data || event;
        const meta = TYPE_MAP[event.type];
        if (!meta) return;

        let summaryLine = '';
        let msgBodyLine = '';

        if (event.type === 'channel.cheer') {
            summaryLine = `Ha enviado un Cheer de ${d.bits || d.data_bits || '?'} Bits`;
            const rawMsg = d.message || d.data_message || '';
            msgBodyLine = rawMsg.replace(/\bCheer\d+\b\s*/gi, '').trim();
        } else if (event.type === 'channel.channel_points_custom_reward_redemption.add') {
            const rewardTitle = (d.reward && d.reward.title) || d.data_reward_title || 'Recompensa';
            if (rewardTitle.toLowerCase() !== 'speak') summaryLine = rewardTitle;
            msgBodyLine = d.user_input || d.data_user_input || '';
        } else if (event.type === 'stream.streak') {
            summaryLine = `Has logrado una racha de visualizaciones de ${d.count || d.data_count || '?'} streams`;
            let st = d.streak_text || d.data_streak_text || '';
            st = st.replace(/\u00c2\u00b7/g, '\u00b7');
            let sep = st.indexOf('·');
            if (sep === -1) sep = st.indexOf('\u00b7');
            msgBodyLine = sep !== -1 ? st.slice(sep + 1).trim() : st;
        } else {
            summaryLine = meta.label || 'Evento';
        }

        const fullText = summaryLine ? (summaryLine + (msgBodyLine ? '\n' + msgBodyLine : '')) : msgBodyLine;
        const userName = d.user_name || d.data_user_name || d.from_broadcaster_user_name || 'Alguien';
        const userLogin = d.user_login || d.data_user_login || d.from_broadcaster_user_login || userName;
        
        let avatarUrl = d.profile_image_url || d.data_profile_image_url;
        const lowerLogin = String(userLogin).toLowerCase();
        if (!avatarUrl && _avatarCache[lowerLogin] && _avatarCache[lowerLogin] !== 'loading' && _avatarCache[lowerLogin] !== 'failed') {
            avatarUrl = _avatarCache[lowerLogin];
        }

        const fakeMsg = {
            displayName: userName,
            text: fullText,
            tags: {
                color: meta.color,
                badges: 'eventhub:1',
                emotes: ''
            },
            avatarUrl: avatarUrl || null
        };
        if (window.downloadMessageCard) window.downloadMessageCard(fakeMsg, meta.color);
    };

    // ── Emotes & Avatars ─────────────────────────────────────────
    const _avatarCache = {};
    function fetchAvatar(login, elementId, color, initial, userName) {
        if (!login) return;
        const lower = String(login).toLowerCase();
        
        const applyAvatar = (url) => {
            const el = document.getElementById(elementId);
            if (el) {
                el.outerHTML = `<img src="${escHtml(url)}" class="eh-web-avatar-img" alt="${escHtml(userName)}" loading="lazy" onerror="this.outerHTML='<div class=\\'eh-web-avatar-fallback\\' style=\\'background:${color}\\'>${initial}</div>'">`;
            }
        };

        if (_avatarCache[lower]) {
            if (_avatarCache[lower] !== 'loading' && _avatarCache[lower] !== 'failed') {
                setTimeout(() => applyAvatar(_avatarCache[lower]), 0);
            }
            return;
        }

        _avatarCache[lower] = 'loading';
        fetch('https://api.ivr.fi/v2/twitch/user?login=' + encodeURIComponent(lower))
            .then(r => r.json())
            .then(data => {
                const u = Array.isArray(data) ? data[0] : data;
                if (u && (u.logo || u.profile_image_url)) {
                    const url = u.logo || u.profile_image_url;
                    _avatarCache[lower] = url;
                    applyAvatar(url);
                } else {
                    _avatarCache[lower] = 'failed';
                }
            })
            .catch(() => { _avatarCache[lower] = 'failed'; });
    }

    function parseEmoteText(text) {
        if (!text) return '';
        const tp = typeof window.thirdPartyEmotes !== 'undefined' ? window.thirdPartyEmotes : {};
        const twitchIds = typeof window.twitchEmoteIds !== 'undefined' ? window.twitchEmoteIds : {};
        const tokens = text.split(/(\s+)/);
        let out = '';

        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            if (/^\s+$/.test(t) || t === '') { out += t; continue; }

            const mentionMatch = t.match(/^(@[\w_]+)$/);
            if (mentionMatch) {
                out += '<span style="color:var(--purple-lt, #9146ff);font-weight:600;">' + mentionMatch[1] + '</span>';
                continue;
            }

            let url = null;
            if (tp[t]) {
                url = typeof tp[t] === 'string' ? tp[t] : tp[t].url;
            } else if (twitchIds[t]) {
                url = 'https://static-cdn.jtvnw.net/emoticons/v2/' + twitchIds[t] + '/default/dark/2.0';
            }

            if (url) {
                out += '<img src="' + url.replace(/"/g, '&quot;') + '" alt="' + t.replace(/"/g, '&quot;') + '" title="' + t.replace(/"/g, '&quot;') + '" loading="lazy" width="22" height="22" style="vertical-align:middle; display:inline-block;">';
            } else {
                out += escHtml(t);
            }
        }
        return out;
    }

    function formatTime(iso) {
        try {
            return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        } catch (_) { return ''; }
    }

    // ── Render ────────────────────────────────────────────────────
    function renderEvent(ev) {
        const meta = TYPE_MAP[ev.type];
        if (!meta) return '';

        const d       = ev.data || ev;
        const summary = meta.summary(d);
        const time    = formatTime(ev.receivedAt);
        const ago     = timeAgo(ev.receivedAt);

        const userName = d.user_name || d.data_user_name || d.from_broadcaster_user_name || 'A';
        const userLogin = d.user_login || d.data_user_login || d.from_broadcaster_user_login || userName;
        const initial = userName ? userName[0].toUpperCase() : '?';
        const avatarUrl = d.profile_image_url || d.data_profile_image_url;

        let avatarHtml = '';
        if (avatarUrl) {
            avatarHtml = `<img src="${escHtml(avatarUrl)}" class="eh-web-avatar-img" alt="${escHtml(userName)}" loading="lazy" onerror="this.outerHTML='<div class=\\'eh-web-avatar-fallback\\' style=\\'background:${meta.color}\\'>${initial}</div>'">`;
        } else {
            const fbId = 'eh-av-' + Math.random().toString(36).substr(2, 9);
            avatarHtml = `<div id="${fbId}" class="eh-web-avatar-fallback" style="background:${meta.color}">${initial}</div>`;
            fetchAvatar(userLogin, fbId, meta.color, initial, userName);
        }

        _eventMap[ev.id] = ev;

        return `
        <div class="eh-web-card" data-type="${escHtml(ev.type)}" style="border-left: 2px solid ${meta.color};">
            <div class="eh-web-avatar-wrap">
                ${avatarHtml}
            </div>
            <div class="eh-web-card-body">
                <div class="eh-web-card-summary">${summary}</div>
                <div class="eh-web-card-footer">
                    <span class="eh-web-badge" style="background:${meta.badgeColor}22; color:${meta.badgeColor}; border: 1px solid ${meta.badgeColor}44;">${meta.badge}</span>
                    <span class="eh-web-time" title="${escHtml(ev.receivedAt || '')}">${time} · ${ago}</span>
                </div>
            </div>
            <div class="eh-web-card-actions">
                <button class="eh-web-btn-dl" onclick="ehWebDownloadEvent('${escHtml(ev.id)}')" title="Descargar como imagen">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                </button>
            </div>
        </div>`;
    }

    function renderAll(events) {
        const list = document.getElementById('eh-web-list');
        const empty = document.getElementById('eh-web-empty');
        const counter = document.getElementById('eh-web-counter');

        if (!list) return;

        if (!events || events.length === 0) {
            list.innerHTML = '';
            if (empty) empty.style.display = 'flex';
            if (counter) counter.textContent = '0 eventos';
            return;
        }

        if (empty) empty.style.display = 'none';
        if (counter) counter.textContent = events.length + ' evento' + (events.length !== 1 ? 's' : '');

        list.innerHTML = events.map(renderEvent).join('');
    }

    // ── Suscripción ───────────────────────────────────────────────
    function startListening() {
        if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }

        setStatus('connecting');

        if (typeof window.subscribeLiveEvents !== 'function') {
            console.error('[EventHub Web] subscribeLiveEvents no disponible.');
            setStatus('error');
            return;
        }

        _unsubscribe = window.subscribeLiveEvents(CHANNEL, function (events) {
            _events = events;
            renderAll(events);
            setStatus('live');
        });
    }

    function stopListening() {
        if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
        setStatus('offline');
    }

    // ── Indicador de estado ───────────────────────────────────────
    function setStatus(state) {
        const dot   = document.getElementById('eh-web-dot');
        const label = document.getElementById('eh-web-status-label');
        if (!dot || !label) return;

        dot.className = 'eh-web-dot';
        if (state === 'live') {
            dot.classList.add('eh-web-dot--live');
            label.textContent = 'En vivo · ' + CHANNEL;
        } else if (state === 'connecting') {
            dot.classList.add('eh-web-dot--connecting');
            label.textContent = 'Conectando...';
        } else if (state === 'error') {
            dot.classList.add('eh-web-dot--error');
            label.textContent = 'Error de conexión';
        } else {
            label.textContent = 'Desconectado';
        }
    }

    // ── Vista: activar / desactivar ───────────────────────────────
    function showView() {
        // Ocultar solo el panel principal de logs (no tocar otros)
        var logsView = document.getElementById('view-logs');
        if (logsView) logsView.style.display = 'none';

        var ehView = document.getElementById('view-eventhub-web');
        if (ehView) ehView.style.display = 'flex';

        if (!_initialized) {
            _initialized = true;
            startListening();
        }
    }

    function hideView() {
        var ehView = document.getElementById('view-eventhub-web');
        if (ehView) ehView.style.display = 'none';

        // Restaurar el panel principal de logs
        var logsView = document.getElementById('view-logs');
        if (logsView) logsView.style.display = 'flex';
    }

    // ── Inyectar CSS ──────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('eh-web-styles')) return;
        const style = document.createElement('style');
        style.id = 'eh-web-styles';
        style.textContent = `
/* ── EventHub Web Panel ────────────────────── */
#view-eventhub-web {
    display: none;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
    animation: eh-web-fadein .2s ease;
}
@keyframes eh-web-fadein { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }

.eh-web-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--border-color, #2a2a3a);
    flex-shrink: 0;
}
.eh-web-title {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-hi, #fff);
    margin: 0;
    flex: 1;
}
.eh-web-status {
    display: flex;
    align-items: center;
    gap: 6px;
}
.eh-web-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #555;
    flex-shrink: 0;
}
.eh-web-dot--live {
    background: #22c55e;
    box-shadow: 0 0 0 0 #22c55e88;
    animation: eh-web-pulse 1.8s infinite;
}
.eh-web-dot--connecting {
    background: #f59e0b;
    animation: eh-web-blink 1s infinite;
}
.eh-web-dot--error { background: #ef4444; }
@keyframes eh-web-pulse {
    0%  { box-shadow: 0 0 0 0 #22c55e88; }
    70% { box-shadow: 0 0 0 6px #22c55e00; }
    100%{ box-shadow: 0 0 0 0 #22c55e00; }
}
@keyframes eh-web-blink { 0%,100%{ opacity:1; } 50%{ opacity:.3; } }

.eh-web-status-label {
    font-size: .78rem;
    color: var(--text-lo, #888);
    white-space: nowrap;
}
.eh-web-counter {
    font-size: .75rem;
    color: var(--text-lo, #888);
    background: var(--bg-2, #1e1e2e);
    padding: 2px 8px;
    border-radius: 20px;
    border: 1px solid var(--border-color, #2a2a3a);
}

/* ── Lista ──────────────────────────────────── */
.eh-web-list-wrap {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.eh-web-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text-lo, #888);
    font-size: .9rem;
    padding: 40px;
}
.eh-web-empty svg { opacity: .3; }

/* ── Tarjeta ─────────────────────────────────── */
.eh-web-card {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    background: var(--bg-2, #1e1e2e);
    border: 1px solid var(--border-color, #2a2a3a);
    border-radius: 10px;
    padding: 12px 14px;
    transition: transform .15s, border-color .15s;
    animation: eh-web-fadein .25s ease;
}
.eh-web-card:hover {
    border-color: #3a3a5a;
}
.eh-web-avatar-wrap {
    width: 36px; height: 36px;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
}
.eh-web-avatar-img {
    width: 100%; height: 100%;
    object-fit: cover;
}
.eh-web-avatar-fallback {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    color: #fff;
    font-weight: 700;
    font-size: 1.1rem;
}
.eh-web-card-body { flex: 1; min-width: 0; }
.eh-web-card-summary {
    font-size: .9rem;
    color: var(--text-hi, #eee);
    line-height: 1.4;
    margin-bottom: 5px;
    word-break: break-word;
}
.eh-web-msg {
    font-size: 0.88rem;
    color: var(--text-lo, #888);
}
.eh-web-highlight {
    color: var(--purple-lt, #9146ff);
    font-weight: 600;
}
.eh-web-small { font-size: .8rem; color: var(--text-lo, #888); }
.eh-web-card-footer {
    display: flex; align-items: center; gap: 8px;
    margin-top: 8px;
}
.eh-web-badge {
    font-size: .65rem;
    font-weight: 700;
    letter-spacing: .5px;
    padding: 2px 7px;
    border-radius: 4px;
}
.eh-web-time {
    font-size: .75rem;
    color: var(--text-lo, #555);
}
.eh-web-card-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-left: auto;
    opacity: 0;
    transition: opacity .2s;
}
.eh-web-card:hover .eh-web-card-actions {
    opacity: 1;
}
.eh-web-btn-dl {
    background: transparent;
    border: none;
    color: var(--text-lo, #888);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    transition: color .2s, background .2s;
}
.eh-web-btn-dl:hover {
    color: #fff;
    background: rgba(255,255,255,0.1);
}
        `;
        document.head.appendChild(style);
    }

    // ── Crear la vista HTML ───────────────────────────────────────
    function buildView() {
        const mainContent = document.querySelector('.main-content');
        if (!mainContent || document.getElementById('view-eventhub-web')) return;

        const view = document.createElement('div');
        view.id = 'view-eventhub-web';
        view.innerHTML = `
            <div class="eh-web-header">
                <span class="eh-web-title">EventHub <span style="font-size:.75rem;font-weight:500;color:#9146ff;background:#9146ff18;padding:2px 8px;border-radius:20px;vertical-align:middle;">LIVE</span></span>
                <div class="eh-web-status">
                    <span class="eh-web-dot" id="eh-web-dot"></span>
                    <span class="eh-web-status-label" id="eh-web-status-label">Conectando...</span>
                </div>
                <span class="eh-web-counter" id="eh-web-counter">0 eventos</span>
            </div>
            <div class="eh-web-list-wrap">
                <div class="eh-web-empty" id="eh-web-empty">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>
                    <span>Sin eventos en vivo aún</span>
                    <span style="font-size:.78rem;opacity:.6;">Los eventos aparecerán aquí cuando el servidor esté activo</span>
                </div>
                <div id="eh-web-list"></div>
            </div>
        `;
        mainContent.appendChild(view);
    }

    // ── Agregar botón al sidebar ──────────────────────────────────
    function addSidebarButton() {
        if (document.getElementById('nav-eventhub-web')) return;

        // Buscar el nav del sidebar
        const nav = document.querySelector('.sidebar-nav');
        if (!nav) return;

        // Crear separador + botón
        const btn = document.createElement('button');
        btn.id = 'nav-eventhub-web';
        btn.className = 'nav-item';
        btn.style.cssText = 'margin-top:8px;';
        btn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="12" opacity=".2"/>
                <line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>
                <line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>
            </svg>
            <span>EventHub Live</span>
            <span id="eh-web-nav-dot" style="width:7px;height:7px;border-radius:50%;background:#22c55e;margin-left:auto;opacity:0;transition:opacity .3s;box-shadow:0 0 0 0 #22c55e88;animation:eh-web-pulse 1.8s infinite;"></span>
        `;

        btn.addEventListener('click', function () {
            // Desactivar otros nav-items
            document.querySelectorAll('.nav-item, .nav-sub-item').forEach(function(el) {
                el.classList.remove('active');
            });
            btn.classList.add('active');
            showView();
        });

        nav.appendChild(btn);
    }

    // ── Interceptar nav items existentes para ocultar esta vista ──
    function hookExistingNavItems() {
        document.querySelectorAll('.nav-item, .nav-sub-item').forEach(function(item) {
            if (item.id === 'nav-eventhub-web') return;
            item.addEventListener('click', function () {
                hideView();
                const dot = document.getElementById('eh-web-nav-dot');
                // No detenemos la escucha — solo ocultamos la vista
            });
        });
    }

    // ── Actualizar el dot del sidebar cuando llegan eventos ───────
    function updateNavDot(hasEvents) {
        const dot = document.getElementById('eh-web-nav-dot');
        if (dot) dot.style.opacity = hasEvents ? '1' : '0';
    }

    // ── Inicialización principal ──────────────────────────────────
    function init() {
        injectStyles();
        buildView();
        addSidebarButton();
        hookExistingNavItems();

        // Suscribir en background siempre (para el dot del sidebar)
        if (typeof window.subscribeLiveEvents === 'function') {
            window.subscribeLiveEvents(CHANNEL, function(events) {
                _events = events;
                updateNavDot(events && events.length > 0);

                // Si la vista está visible, también renderizar
                const view = document.getElementById('view-eventhub-web');
                if (view && view.style.display !== 'none') {
                    renderAll(events);
                    setStatus('live');
                }
            });
        }
    }

    // Esperar a que el DOM esté listo
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
