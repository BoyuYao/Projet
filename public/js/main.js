// ============================================================
//  main.js — Interface admin/projecteur CHROMATRACE
// ============================================================

// socket est défini par projector.js (chargé en premier)
const appSocket = (typeof socket !== 'undefined') ? socket : io();

// ── État local des paramètres ──────────────────────────────
let currentDuration = 180;
let itemsOn         = true;
let boostOn         = true;
let autoEndOn       = true;
let lastLobbySignature = '';
let lastTop5Signature = '';

window.openRulesPanel = function () {
    const overlay = document.getElementById('rules-overlay');
    if (!overlay) return;
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
};

window.closeRulesPanel = function () {
    const overlay = document.getElementById('rules-overlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
};

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        closeRulesPanel();
    }
});

document.addEventListener('click', (event) => {
    const overlay = document.getElementById('rules-overlay');
    if (!overlay || !overlay.classList.contains('visible')) return;
    if (event.target === overlay) {
        closeRulesPanel();
    }
});

// ── Contrôles paramètres ───────────────────────────────────
window.changeDuration = function (amount) {
    currentDuration = Math.max(60, Math.min(600, currentDuration + amount));
    const mins = Math.floor(currentDuration / 60);
    const secs = currentDuration % 60;
    document.getElementById('duration-display').innerText =
        `${mins}:${secs.toString().padStart(2, '0')}`;
    sendSettings();
};

window.toggleItems = function () {
    itemsOn = !itemsOn;
    syncToggleBtn('items-toggle', itemsOn);
    sendSettings();
};

window.toggleBoost = function () {
    boostOn = !boostOn;
    syncToggleBtn('boost-toggle', boostOn);
    sendSettings();
};

window.toggleAutoEnd = function () {
    autoEndOn = !autoEndOn;
    syncToggleBtn('autoend-toggle', autoEndOn);
    sendSettings();
};

/** Met à jour l'apparence d'un bouton toggle ON/OFF. */
function syncToggleBtn(id, isOn) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.innerText   = isOn ? 'ON' : 'OFF';
    btn.className   = isOn ? 'toggle-btn on' : 'toggle-btn';
}

function sendSettings() {
    appSocket.emit('adminUpdateSettings', {
        durationSec:    currentDuration,
        itemsEnabled:   itemsOn,
        boostEnabled:   boostOn,
        autoEndEnabled: autoEndOn,
    });
}

window.startGame = function () { appSocket.emit('adminStartGame'); };
window.resetGame = function () { appSocket.emit('adminResetGame'); };

// ── Synchronisation des paramètres depuis le serveur ──────
// (utile si plusieurs admins, ou après rechargement de page)
appSocket.on('settingsUpdated', (settings) => {
    if (typeof settings.durationSec === 'number') {
        currentDuration = settings.durationSec;
        const mins = Math.floor(currentDuration / 60);
        const secs = currentDuration % 60;
        const el = document.getElementById('duration-display');
        if (el) el.innerText = `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    if (typeof settings.itemsEnabled   === 'boolean') { itemsOn    = settings.itemsEnabled;   syncToggleBtn('items-toggle',   itemsOn);   }
    if (typeof settings.boostEnabled   === 'boolean') { boostOn    = settings.boostEnabled;   syncToggleBtn('boost-toggle',   boostOn);   }
    if (typeof settings.autoEndEnabled === 'boolean') { autoEndOn  = settings.autoEndEnabled; syncToggleBtn('autoend-toggle', autoEndOn); }
});

// ── Transitions d'état ────────────────────────────────────
appSocket.on('gameStateChanged', (payload) => {
    const phase = payload.state || payload;

    if (phase === 'LOBBY') {
        document.getElementById('end-screen').classList.remove('visible');
        document.getElementById('hud').classList.remove('visible');
        document.getElementById('game-canvas').classList.remove('visible');
        document.getElementById('lobby-screen').classList.remove('hidden');
    }
    else if (phase === 'PLAYING') {
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('hud').classList.add('visible');
        document.getElementById('game-canvas').classList.add('visible');
    }
    else if (phase === 'FINISHED') {
        document.getElementById('hud').classList.remove('visible');
        document.getElementById('game-canvas').classList.remove('visible');
        document.getElementById('end-screen').classList.add('visible');
        renderPodium(payload.podium);
        renderFinalRanking(payload.rankings);
    }
});

/** Construit le podium à partir du tableau podium (3 premiers). */
function renderPodium(podium) {
    const container = document.getElementById('podium');
    if (!container) return;
    container.innerHTML = '';

    if (!Array.isArray(podium) || podium.length === 0) return;

    // Classement reçu déjà trié : index 0 = 1er, index 1 = 2e, index 2 = 3e
    const layoutByRank = {
        1: { order: 2, height: 138 },
        2: { order: 1, height: 108 },
        3: { order: 3, height: 82 },
    };

    podium.slice(0, 3).forEach((player, index) => {
        const rank = index + 1;
        const layout = layoutByRank[rank] || { order: rank, height: 80 };

        const entry = document.createElement('div');
        entry.className = `podium-entry podium-rank-${rank}`;
        entry.style.setProperty('--podium-color', player.color);
        entry.style.order = String(layout.order);

        entry.innerHTML = `
            <div class="podium-cube" style="height:${layout.height}px">${rank}</div>
            <div class="podium-name">${escapeHtml(player.name)}</div>
            <div class="podium-territory">${Number(player.score) || 0} blocs</div>
        `;
        container.appendChild(entry);
    });
}

// ── Timer ─────────────────────────────────────────────────
appSocket.on('timeUpdate', (timeRemaining) => {
    const mins    = Math.floor(timeRemaining / 60);
    const secs    = timeRemaining % 60;
    const timerEl = document.getElementById('timer-display');
    if (!timerEl) return;
    timerEl.innerText = `${mins}:${secs.toString().padStart(2, '0')}`;
    timerEl.classList.toggle('urgent', timeRemaining <= 10);
});

// ── État du jeu broadcast ─────────────────────────────────
appSocket.on('state', (payload) => {
    updateServerUrl(payload.serverIp);

    if (!document.getElementById('lobby-screen').classList.contains('hidden')) {
        updateLobbyPlayerList(payload.players);
    }

    if (document.getElementById('hud').classList.contains('visible')) {
        updateLeaderboard(payload.top5);
    }
});

/** Affiche l'IP/URL du serveur et génère le QR si besoin. */
function updateServerUrl(serverIp) {
    if (!serverIp) return;
    const urlBox = document.getElementById('server-url');
    if (urlBox) urlBox.innerText = `${serverIp}:3000/controller.html`;
}

/**
 * Met à jour la liste des joueurs dans le lobby.
 * Filtre les joueurs déconnectés pour ne montrer que ceux
 * réellement présents dans la salle.
 */
function updateLobbyPlayerList(players) {
    // Seuls les joueurs connectés comptent
    const active = players.filter(p => !p.disconnected);

    const signature = active.map((p) => `${p.numId}:${p.name}:${p.color}`).join('|');
    if (signature === lastLobbySignature) return;
    lastLobbySignature = signature;

    const countEl = document.getElementById('player-count-num');
    if (countEl) countEl.innerText = active.length;

    const startBtn = document.getElementById('start-btn');
    if (startBtn) startBtn.disabled = active.length < 1;

    const list = document.getElementById('player-list');
    if (!list) return;

    list.innerHTML = '';
    active.forEach(p => {
        const entry = document.createElement('div');
        entry.className = 'player-entry';
        entry.style.setProperty('--player-color', p.color);
        entry.innerHTML = `
            <div class="player-dot"></div>
            <div class="player-name">${escapeHtml(p.name)}</div>
        `;
        list.appendChild(entry);
    });
}

/** Met à jour le leaderboard en jeu (top 5). */
function updateLeaderboard(top5) {
    const container = document.getElementById('lb-entries');
    if (!container) return;

    const rows = Array.isArray(top5) ? top5 : [];
    const signature = rows.map((p) => `${p?.numId}:${p?.score}`).join('|');
    if (signature === lastTop5Signature) return;
    lastTop5Signature = signature;

    container.innerHTML = '';
    rows.forEach((p, index) => {
        const entry = document.createElement('div');
        entry.className = 'lb-entry';
        entry.innerHTML = `
            <span class="lb-rank">#${index + 1}</span>
            <div class="lb-color-dot" style="background:${p.color};box-shadow:0 0 8px ${p.color}"></div>
            <span class="lb-pseudo" style="color:${p.color};font-weight:bold">${escapeHtml(p.name)}</span>
            <span class="lb-score">${p.score} blocs</span>
        `;
        container.appendChild(entry);
    });
}

function renderFinalRanking(rankings) {
    const container = document.getElementById('final-ranking');
    if (!container) return;

    const rows = Array.isArray(rankings) ? rankings : [];
    container.innerHTML = '';

    rows.slice(0, 10).forEach((p) => {
        const row = document.createElement('div');
        row.className = 'final-rank-row';
        row.innerHTML = `
            <span class="final-rank-pos">#${p.rank}</span>
            <span class="final-rank-name" style="color:${p.color}">${escapeHtml(p.name)}</span>
            <span class="final-rank-score">${Number(p.score) || 0} blocs</span>
        `;
        container.appendChild(row);
    });
}

/** Échappe les caractères HTML pour éviter l'injection XSS. */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
