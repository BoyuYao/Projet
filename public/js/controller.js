// ============================================================
//  controller.js — Manette mobile CHROMATRACE
//  Bugs corrigés :
//   #8  - Guard contre double-clic sur "Rejoindre"
//   #9  - Recherche du rang par numId (unique) et non par name
// ============================================================

const COLORS = [
    "#06B6D4", "#D946EF", "#84CC16", "#EAB308",
    "#F97316", "#EF4444", "#8B5CF6", "#10B981",
    "#EC4899", "#3B82F6", "#F43F5E", "#14B8A6",
];

let selectedColor    = COLORS[0];
let myPseudo         = '';
let myNumId          = null;   // Bug 9 : stocke numId pour retrouver le rang
let myScore          = 0;
let socket           = null;
let joystick         = null;
let joined           = false;
let isEliminated     = false;
let currentGameState = 'LOBBY';

// ── Navigation entre écrans ────────────────────────────────
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
    if (id === 'screen-game') initJoystick();
}

// ── Grille de couleurs ─────────────────────────────────────
function initColorGrid() {
    const grid = document.getElementById('color-grid');
    COLORS.forEach((color, i) => {
        const btn = document.createElement('div');
        btn.className = 'color-option' + (i === 0 ? ' selected' : '');
        btn.style.background = color;
        btn.style.setProperty('--c', color);
        btn.onclick = () => {
            document.querySelectorAll('.color-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedColor = color;
        };
        grid.appendChild(btn);
    });
}

// ── Connexion Socket.io ────────────────────────────────────
function connectSocket() {
    socket = io();

    socket.on('gameStateChanged', (payload) => {
        currentGameState = payload.state;
        if (!joined) return;

        if (currentGameState === 'LOBBY') {
            isEliminated = false;
            showScreen('screen-lobby');
        } else if (currentGameState === 'PLAYING') {
            isEliminated = false;
            showScreen('screen-game');
        } else if (currentGameState === 'FINISHED') {
            showEndScreen(payload.rankings);
        }
    });

    socket.on('selfState', (payload) => {
        if (!joined) return;

        myScore = payload.score;
        document.getElementById('game-territory').textContent = payload.score;
        document.getElementById('indicator-boost').classList.toggle('active',  payload.boost);
        document.getElementById('indicator-shield').classList.toggle('active', payload.shield);

        if (!payload.alive && currentGameState === 'PLAYING' && !isEliminated) {
            isEliminated = true;
            showEliminatedScreen(payload.lastDeathReason, payload.score);
        }
    });
}

// ── Rejoindre la partie ────────────────────────────────────
function joinGame() {
    // Bug 8 : guard contre double-appel (double-clic, multi-submit)
    if (joined) return;

    const name    = document.getElementById('pseudo-input').value.trim();
    const errorEl = document.getElementById('error-msg');

    if (name.length < 2) {
        errorEl.textContent = 'Pseudo trop court (2 caractères min)';
        return;
    }

    errorEl.textContent = '';

    socket.emit('joinGame', { name, color: selectedColor }, (res) => {
        if (!res || !res.ok) {
            errorEl.textContent = 'Impossible de rejoindre la partie';
            return;
        }

        joined   = true;
        myPseudo = name;
        myNumId  = res.numId;   // Bug 9 : numId stocké

        document.getElementById('lobby-name').textContent  = name;
        document.getElementById('lobby-name').style.color  = selectedColor;
        document.getElementById('game-pseudo').textContent = name;
        document.getElementById('game-pseudo').style.color = selectedColor;
        document.getElementById('end-pseudo').textContent  = name;
        document.getElementById('end-pseudo').style.color  = selectedColor;

        if (res.currentState === 'PLAYING') showScreen('screen-game');
        else                                showScreen('screen-lobby');
    });
}

// ── Écran d'élimination ────────────────────────────────────
function showEliminatedScreen(reason, score) {
    navigator.vibrate?.([150, 60, 150]);   // Double impulsion (plus perceptible sur Android)
    document.getElementById('elim-reason').textContent = reason || 'Tu as été éliminé';
    document.getElementById('elim-score').textContent  = score  || 0;
    showScreen('screen-eliminated');
}

// ── Écran de fin de partie ─────────────────────────────────
function showEndScreen(rankings) {
    if (!rankings) { showScreen('screen-end'); return; }

    // Bug 9 fix : cherche par numId (unique) et non par name (peut être dupliqué)
    const myResult = rankings.find(r => r.numId === myNumId);

    if (myResult) {
        const medals  = ['🥇', '🥈', '🥉'];
        const rankStr = myResult.rank <= 3 ? medals[myResult.rank - 1] : `#${myResult.rank}`;
        document.getElementById('end-rank').textContent  = rankStr;
        document.getElementById('end-score').textContent = `${myResult.score} blocs capturés`;
    }

    showScreen('screen-end');
}

// ── Joystick NippleJS ──────────────────────────────────────
function initJoystick() {
    if (joystick) { joystick.destroy(); joystick = null; }

    setTimeout(() => {
        joystick = nipplejs.create({
            zone:     document.getElementById('joystick-area'),
            mode:     'static',
            position: { left: '50%', top: '50%' },
            color:    selectedColor,
            size:     160,
        });

        let lastSend = 0;
        joystick.on('move', (_evt, data) => {
            const now = Date.now();
            if (now - lastSend < 33) return;
            lastSend = now;
            // Y inversé : NippleJS remonte = positif, serveur attend dy positif = bas
            socket.emit('playerInput', { x: data.vector.x, y: -data.vector.y });
        });

        // Relâchement : envoie (0,0) — le serveur conserve la dernière direction
        joystick.on('end', () => {
            socket.emit('playerInput', { x: 0, y: 0 });
        });
    }, 100);
}

// ── Lancement ─────────────────────────────────────────────
initColorGrid();
connectSocket();
