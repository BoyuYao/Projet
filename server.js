const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const os = require('os');
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const devName in interfaces) {
        const iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return '127.0.0.1';
}
const MY_REAL_IP = getLocalIp();

let currentGameState = 'LOBBY'; 
let gameSettings = {
    durationSec:    180,  // 3 minutes par défaut
    itemsEnabled:   true,
    boostEnabled:   true,
    autoEndEnabled: true, // Fin automatique quand plus aucun joueur vivant
};
let timeRemaining = 0;
let gameTimerInterval = null;
let gameStartTimeout = null;
let roundStartFreezeUntil = 0;

const PORT = process.env.PORT || 3000;
const COLS = 80;
const ROWS = 45;
const CELL_SIZE = 16;
const TICK_MS = 100;
const STATE_MS = 100;
const ROUND_START_FREEZE_MS = 3000;
const DISCONNECT_GRACE_MS = 3000;
const RESPAWN_MS = 2000;
const ITEM_MIN_MS = 6000;
const ITEM_MAX_MS = 12000;
const BOOST_MS = 5000;
const SHIELD_MS = 5000;
const BASE_RADIUS = 2;   // Territoire de départ plus grand (5x5 cellules)

const COLORS = [
    '#06b6d4', '#d946ef', '#84cc16', '#eab308',
    '#f97316', '#fb7185', '#60a5fa', '#14b8a6'
];

// Marge par rapport aux bords de la map
const SPAWN_MARGIN  = 5;
// Distance minimale entre deux spawns (en cellules)
const SPAWN_MIN_GAP = 8;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const state = {
    grid: createGrid(),
    players: new Map(),
    socketToPlayer: new Map(),
    nextPlayerNumId: 1,
    items: [],
    nextItemId: 1,
    nextItemAt: Date.now() + randomInt(ITEM_MIN_MS, ITEM_MAX_MS),
    startedAt: Date.now()
};

function createGrid() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function chooseDirection(inputX, inputY, fallbackX, fallbackY) {
    const deadZone = 0.2;
    if (Math.abs(inputX) < deadZone && Math.abs(inputY) < deadZone) {
        return { dx: fallbackX, dy: fallbackY };
    }

    let newDx = 0;
    let newDy = 0;

    if (Math.abs(inputX) >= Math.abs(inputY)) {
        newDx = inputX >= 0 ? 1 : -1;
    } else {
        newDy = inputY >= 0 ? 1 : -1;
    }

    if (newDx === -fallbackX && fallbackX !== 0) return { dx: fallbackX, dy: fallbackY };
    if (newDy === -fallbackY && fallbackY !== 0) return { dx: fallbackX, dy: fallbackY };

    return { dx: newDx, dy: newDy };
}

function findPlayerByNumId(numId) {
    for (const player of state.players.values()) {
        if (player.numId === numId) {
            return player;
        }
    }
    return null;
}

function getUsedColors() {
    const used = new Set();
    for (const player of state.players.values()) {
        used.add(player.color.toLowerCase());
    }
    return used;
}

function chooseColor(preferredColor) {
    const used = getUsedColors();
    if (preferredColor && !used.has(preferredColor.toLowerCase())) {
        return preferredColor;
    }
    const freeColor = COLORS.find((color) => !used.has(color.toLowerCase()));
    return freeColor || COLORS[randomInt(0, COLORS.length - 1)];
}

function cellKey(x, y) {
    return `${x}:${y}`;
}

// Génère une grille de spawns qui couvre toute la map
// pour accueillir jusqu'à MAX_PLAYERS joueurs sans collision
function buildSpawnGrid() {
    const points = [];

    // Zone jouable (on évite les bords)
    const xMin = SPAWN_MARGIN;
    const xMax = COLS - SPAWN_MARGIN;
    const yMin = SPAWN_MARGIN;
    const yMax = ROWS - SPAWN_MARGIN;

    // Calcule combien de colonnes et lignes on peut placer
    // en respectant la distance minimale entre spawns
    const cols = Math.floor((xMax - xMin) / SPAWN_MIN_GAP);
    const rows = Math.floor((yMax - yMin) / SPAWN_MIN_GAP);

    // Espace réel entre chaque spawn (distribué uniformément)
    const xStep = Math.floor((xMax - xMin) / cols);
    const yStep = Math.floor((yMax - yMin) / rows);

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            points.push({
                x: xMin + c * xStep + Math.floor(xStep / 2),
                y: yMin + r * yStep + Math.floor(yStep / 2)
            });
        }
    }

    return points;
}

// Grille précalculée au démarrage
const SPAWN_GRID = buildSpawnGrid();

// Retourne un point de spawn libre pour le joueur
// Priorité : un point non occupé par un autre joueur
function getSpawnPoint(player) {
    // Liste des positions actuellement occupées
    const occupied = new Set(
        [...state.players.values()]
            .filter(p => p.alive && p.id !== player.id)
            .map(p => p.x + ':' + p.y)
    );

    // Cherche le point de la grille le plus éloigné des autres joueurs
    let bestPoint = null;
    let bestDist  = -1;

    for (const point of SPAWN_GRID) {
        // Ignore si une position trop proche est déjà prise
        let minDist = Infinity;
        for (const [id, other] of state.players.entries()) {
            if (!other.alive || other.id === player.id) continue;
            const dx   = point.x - other.x;
            const dy   = point.y - other.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDist) minDist = dist;
        }

        if (minDist > bestDist) {
            bestDist  = minDist;
            bestPoint = point;
        }
    }

    // Fallback : premier point de la grille si aucun trouvé
    return bestPoint || SPAWN_GRID[0];
}

function clearPlayerTerritory(player) {
    for (let y = 0; y < ROWS; y += 1) {
        for (let x = 0; x < COLS; x += 1) {
            if (state.grid[y][x] === player.numId) {
                state.grid[y][x] = 0;
            }
        }
    }
}

function paintBase(player, centerX, centerY) {
    for (let y = centerY - BASE_RADIUS; y <= centerY + BASE_RADIUS; y += 1) {
        for (let x = centerX - BASE_RADIUS; x <= centerX + BASE_RADIUS; x += 1) {
            if (x >= 0 && x < COLS && y >= 0 && y < ROWS) {
                state.grid[y][x] = player.numId;
            }
        }
    }
}

function resetTrail(player) {
    player.trail = [];
    player.trailSet.clear();
    player.outside = false;
}

function respawnPlayer(player) {
    clearPlayerTerritory(player);
    resetTrail(player);

    const spawn = getSpawnPoint(player);
    player.x = clamp(spawn.x, 1, COLS - 2);
    player.y = clamp(spawn.y, 1, ROWS - 2);
    player.dirX = 1;
    player.dirY = 0;
    player.inputX = 1;
    player.inputY = 0;
    player.alive = true;
    player.respawnAt = 0;
    player.lastDeathReason = '';
    player.boostUntil = 0;
    player.shieldUntil = 0;
    paintBase(player, player.x, player.y);
}

function killPlayer(player, reason) {
    player.alive = false;
    player.lastDeathReason = reason;
    // Pas de respawn automatique — le joueur attend la fin de la partie
    player.respawnAt = 0;
    clearPlayerTerritory(player);
    resetTrail(player);
    player.boostUntil = 0;
    player.shieldUntil = 0;
}

function addTrailCell(player, x, y) {
    const last = player.trail[player.trail.length - 1];
    if (last && last.x === x && last.y === y) {
        return;
    }
    const key = cellKey(x, y);
    player.trail.push({ x, y });
    player.trailSet.add(key);
}

function rebuildScores() {
    const counts = new Map();
    for (let y = 0; y < ROWS; y += 1) {
        for (let x = 0; x < COLS; x += 1) {
            const owner = state.grid[y][x];
            if (owner !== 0) {
                counts.set(owner, (counts.get(owner) || 0) + 1);
            }
        }
    }

    for (const player of state.players.values()) {
        player.score = counts.get(player.numId) || 0;
    }
}

function captureArea(player) {
    const blocked = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    const visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    const queue = [];

    for (let y = 0; y < ROWS; y += 1) {
        for (let x = 0; x < COLS; x += 1) {
            if (state.grid[y][x] === player.numId) {
                blocked[y][x] = true;
            }
        }
    }

    for (const cell of player.trail) {
        if (cell.x >= 0 && cell.x < COLS && cell.y >= 0 && cell.y < ROWS) {
            blocked[cell.y][cell.x] = true;
        }
    }

    function enqueueIfFree(x, y) {
        if (x < 0 || x >= COLS || y < 0 || y >= ROWS) { return; }
        if (blocked[y][x] || visited[y][x]) { return; }
        visited[y][x] = true;
        queue.push({ x, y });
    }

    for (let x = 0; x < COLS; x += 1) {
        enqueueIfFree(x, 0);
        enqueueIfFree(x, ROWS - 1);
    }
    for (let y = 0; y < ROWS; y += 1) {
        enqueueIfFree(0, y);
        enqueueIfFree(COLS - 1, y);
    }

    let head = 0;
    while (head < queue.length) {
        const current = queue[head++];
        enqueueIfFree(current.x + 1, current.y);
        enqueueIfFree(current.x - 1, current.y);
        enqueueIfFree(current.x, current.y + 1);
        enqueueIfFree(current.x, current.y - 1);
    }

    // Bug 3 : tuer les joueurs dont la traîne active est encerclée dans la zone capturée
    for (const other of state.players.values()) {
        if (!other.alive || other.numId === player.numId) continue;
        const isEnclosed = other.trail.some(
            c => c.x >= 0 && c.x < COLS && c.y >= 0 && c.y < ROWS
              && !blocked[c.y][c.x] && !visited[c.y][c.x]
        );
        if (isEnclosed) killPlayer(other, `${player.name} t'a encerclé.`);
    }

    for (const cell of player.trail) {
        state.grid[cell.y][cell.x] = player.numId;
    }

    for (let y = 0; y < ROWS; y += 1) {
        for (let x = 0; x < COLS; x += 1) {
            if (!blocked[y][x] && !visited[y][x]) {
                state.grid[y][x] = player.numId;
            }
        }
    }

    resetTrail(player);
    // Bug 12 : rebuildScores supprimé ici — buildPublicState le calcule à chaque broadcast
}

function pickupItem(player) {
    const index = state.items.findIndex((item) => item.x === player.x && item.y === player.y);
    if (index === -1) { return; }

    const item = state.items[index];
    state.items.splice(index, 1);

    if (item.type === 'boost') {
        player.boostUntil = Date.now() + BOOST_MS;
    }
    if (item.type === 'shield') {
        player.shieldUntil = Date.now() + SHIELD_MS;
    }
}

function spawnItemIfNeeded(now) {
    if (now < state.nextItemAt || state.items.length >= 4) { return; }

    for (let attempt = 0; attempt < 50; attempt += 1) {
        const x = randomInt(2, COLS - 3);
        const y = randomInt(2, ROWS - 3);
        const occupiedByPlayer = Array.from(state.players.values()).some((player) => player.alive && player.x === x && player.y === y);
        const occupiedByTrail = Array.from(state.players.values()).some((player) => player.trailSet.has(cellKey(x, y)));
        const occupiedByTerritory = state.grid[y][x] !== 0;
        const occupiedByItem = state.items.some((item) => item.x === x && item.y === y);

        if (!occupiedByPlayer && !occupiedByTrail && !occupiedByTerritory && !occupiedByItem) {
            const type = (gameSettings.boostEnabled && Math.random() < 0.5) ? 'boost' : 'shield';
            state.items.push({ id: state.nextItemId, type, x, y });
            state.nextItemId += 1;
            break;
        }
    }
    state.nextItemAt = now + randomInt(ITEM_MIN_MS, ITEM_MAX_MS);
}

function handleTrailCollisions(currentPlayer, now) {
    for (const target of state.players.values()) {
        if (!target.alive) continue;
        if (target.shieldUntil > now) continue;
        if (!target.trailSet.has(cellKey(currentPlayer.x, currentPlayer.y))) continue;

        if (target.numId === currentPlayer.numId) {
            killPlayer(currentPlayer, 'Tu as coupé ta propre trace.');
            return true;
        }
        killPlayer(target, `${currentPlayer.name} a coupé ta trace.`);
        return false;
    }
    return false;
}

function movePlayer(player, now) {
    if (!player.alive) return;

    const baseSteps = player.boostUntil > now ? 2 : 1;

    for (let step = 0; step < baseSteps; step += 1) {
        const chosen = chooseDirection(player.inputX, player.inputY, player.dirX, player.dirY);
        player.dirX = chosen.dx;
        player.dirY = chosen.dy;

        player.x += player.dirX;
        player.y += player.dirY;

        if (player.x <= 0 || player.x >= COLS - 1 || player.y <= 0 || player.y >= ROWS - 1) {
            killPlayer(player, 'Tu as touché le bord de la carte.');
            return;
        }

        const selfDied = handleTrailCollisions(player, now);
        if (selfDied || !player.alive) return;

        const owner = state.grid[player.y][player.x];

        if (owner === player.numId) {
            if (player.outside && player.trail.length > 0) {
                captureArea(player);
            } else {
                resetTrail(player);
            }
        } else {
            player.outside = true;
            addTrailCell(player, player.x, player.y);
        }

        pickupItem(player);
    }
}

function removeExpiredPlayers(now) {
    for (const [id, player] of state.players.entries()) {
        if (player.disconnectedAt && now - player.disconnectedAt > DISCONNECT_GRACE_MS) {
            clearPlayerTerritory(player);
            state.players.delete(id);
        }
    }
}

function respawnWaitingPlayers(now) {
    for (const player of state.players.values()) {
        if (!player.alive && player.respawnAt > 0 && now >= player.respawnAt) {
            respawnPlayer(player);
        }
    }
}

function buildPublicState() {
    rebuildScores();
    const players = Array.from(state.players.values())
        .map((player) => ({
            id: player.id,
            numId: player.numId,
            name: player.name,
            color: player.color,
            x: player.x,
            y: player.y,
            alive: player.alive,
            score: player.score,
            trail: player.trail,
            boost: player.boostUntil > Date.now(),
            shield: player.shieldUntil > Date.now(),
            disconnected: Boolean(player.disconnectedAt),
            lastDeathReason: player.lastDeathReason
        }))
        .sort((a, b) => b.score - a.score);

    const activePlayers = players.filter((p) => !p.disconnected);

    // Seuls les joueurs actifs (non déconnectés) comptent dans le lobby
    const connectedCount = activePlayers.length;

    return {
        cols: COLS,
        rows: ROWS,
        cellSize: CELL_SIZE,
        grid: state.grid,
        players,
        items: state.items,
        connectedPlayers: connectedCount,
        top5: activePlayers.slice(0, 5),
        controllerUrl: '/controller.html',
        elapsedMs: Date.now() - state.startedAt,
        serverIp: MY_REAL_IP,
        // Phase et timer inclus dans chaque broadcast pour que les clients
        // puissent toujours se resynchroniser s'ils se reconnectent
        gamePhase: currentGameState,
        timeRemaining: timeRemaining,
        freezeRemainingMs: Math.max(0, roundStartFreezeUntil - Date.now())
    };
}

function emitState() {
    const publicState = buildPublicState();
    io.emit('state', publicState);

    for (const player of state.players.values()) {
        if (!player.socketId) continue;
        io.to(player.socketId).emit('selfState', {
            name: player.name,
            color: player.color,
            alive: player.alive,
            score: player.score,
            boost: player.boostUntil > Date.now(),
            shield: player.shieldUntil > Date.now(),
            lastDeathReason: player.lastDeathReason,
            disconnected: Boolean(player.disconnectedAt)
        });
    }
}

// ==========================================
// SOCKET.IO LOGIC
// ==========================================
io.on('connection', (socket) => {
    // Envoie la config + la phase actuelle dès la connexion
    // Utile pour les reconnexions ou les retardataires
    socket.emit('welcome', {
        cols: COLS,
        rows: ROWS,
        cellSize: CELL_SIZE,
        colors: COLORS,
        controllerUrl: '/controller.html',
        currentState: currentGameState
    });

    socket.on('joinGame', (payload, callback) => {
        const rawName = typeof payload?.name === 'string' ? payload.name.trim() : '';
        const name = rawName.length > 0 ? rawName.slice(0, 14) : `Joueur${state.nextPlayerNumId}`;
        const color = chooseColor(payload?.color);

        const player = {
            id: socket.id, socketId: socket.id, numId: state.nextPlayerNumId,
            name, color, x: 1, y: 1, dirX: 1, dirY: 0, inputX: 1, inputY: 0,
            alive: false, respawnAt: 0, lastDeathReason: '',
            trail: [], trailSet: new Set(), outside: false, score: 0,
            boostUntil: 0, shieldUntil: 0, disconnectedAt: 0
        };

        state.nextPlayerNumId += 1;
        state.players.set(player.id, player);
        state.socketToPlayer.set(socket.id, player.id);

        // Spawne uniquement si la partie est déjà en cours
        // En lobby, le joueur attend le lancement de la partie
        if (currentGameState === 'PLAYING') {
            respawnPlayer(player);
        }

        // On inclut la phase courante pour que le téléphone affiche le bon écran
        callback?.({
            ok: true,
            id: player.id,
            numId: player.numId,
            name: player.name,
            color: player.color,
            currentState: currentGameState
        });
    });

    socket.on('adminUpdateSettings', (newSettings) => {
        gameSettings = { ...gameSettings, ...newSettings };
        io.emit('settingsUpdated', gameSettings);
    });

    socket.on('adminStartGame', () => {
        // Empêche de lancer si une partie est déjà en cours
        if (currentGameState === 'PLAYING') return;
        
        currentGameState = 'PLAYING';
        timeRemaining = gameSettings.durationSec;
        state.startedAt = Date.now();
        roundStartFreezeUntil = Date.now() + ROUND_START_FREEZE_MS;
        state.items = [];
        state.nextItemAt = Date.now() + randomInt(ITEM_MIN_MS, ITEM_MAX_MS); // Bug 4
        state.grid = createGrid();

        for (const player of state.players.values()) {
            respawnPlayer(player);
        }

        io.emit('gameStateChanged', {
            state: 'PLAYING',
            timeRemaining,
            freezeRemainingMs: ROUND_START_FREEZE_MS
        });

        clearInterval(gameTimerInterval);
        clearTimeout(gameStartTimeout);
        gameStartTimeout = setTimeout(() => {
            gameTimerInterval = setInterval(() => {
                timeRemaining -= 1;
                io.emit('timeUpdate', timeRemaining);
                if (timeRemaining <= 0) {
                    endGame();
                }
            }, 1000);
        }, ROUND_START_FREEZE_MS);
    });

    socket.on('adminResetGame', () => {
        clearInterval(gameTimerInterval);
        clearTimeout(gameStartTimeout);
        currentGameState = 'LOBBY';
        timeRemaining = 0;
        roundStartFreezeUntil = 0;

        // Remet la grille à zéro
        state.grid = createGrid();
        state.items = [];
        state.nextItemId  = 1;                                                    // Bug 10
        state.nextItemAt  = Date.now() + randomInt(ITEM_MIN_MS, ITEM_MAX_MS);    // Bug 10

        // Supprime tous les joueurs — ils devront re-scanner le lien
        state.players.clear();
        state.socketToPlayer.clear();
        state.nextPlayerNumId = 1;

        io.emit('gameStateChanged', { state: 'LOBBY' });
    });

    socket.on('playerInput', (payload) => {
        const playerId = state.socketToPlayer.get(socket.id);
        if (!playerId) return;
        const player = state.players.get(playerId);
        if (!player) return;

        player.disconnectedAt = 0;
        player.socketId = socket.id;
        player.inputX = clamp(Number(payload?.x) || 0, -1, 1);
        player.inputY = clamp(Number(payload?.y) || 0, -1, 1);
    });

    socket.on('disconnect', () => {
        const playerId = state.socketToPlayer.get(socket.id);
        state.socketToPlayer.delete(socket.id);
        if (!playerId) return;
        const player = state.players.get(playerId);
        if (!player) return;

        player.disconnectedAt = Date.now();
        player.socketId = null;
        player.inputX = 0;
        player.inputY = 0;
    });
});

// ==========================================
// FIN AUTOMATIQUE
// ==========================================

/**
 * Termine la partie si l'option est activée et que plus aucun
 * joueur connecté n'est vivant.
 *
 * Préconditions vérifiées avant d'appeler endGame() :
 *  - La partie est bien en cours (PLAYING).
 *  - L'option autoEndEnabled est activée.
 *  - Il reste au moins un joueur connecté (évite un faux-déclenchement
 *    si tout le monde se déconnecte avant la première action).
 *  - Aucun de ces joueurs n'est vivant.
 */
function checkAllEliminated() {
    if (currentGameState !== 'PLAYING')   return;
    if (!gameSettings.autoEndEnabled)     return;

    const connected = Array.from(state.players.values())
        .filter(p => !p.disconnectedAt);

    // Pas encore de joueurs connectés → ne rien faire
    if (connected.length === 0) return;

    const anyoneAlive = connected.some(p => p.alive);
    if (!anyoneAlive) {
        console.log('[CHROMATRACE] Fin automatique : plus aucun joueur vivant.');
        endGame();
    }
}

// ==========================================
// MAIN LOOPS
// ==========================================

setInterval(() => {
    const now = Date.now();
    removeExpiredPlayers(now);

    if (currentGameState !== 'PLAYING') return;

    if (now < roundStartFreezeUntil) return;

    if (gameSettings.itemsEnabled) spawnItemIfNeeded(now);

    for (const player of state.players.values()) {
        // Ne bouge pas les joueurs déconnectés (inputX/Y remis à 0 à la déco)
        if (!player.disconnectedAt) {
            movePlayer(player, now);
        }
    }

    // Vérifier après tous les mouvements du tick
    checkAllEliminated();
}, TICK_MS);

setInterval(() => {
    emitState(); 
}, STATE_MS);


// ==========================================
// STARTUP & GAME END
// ==========================================
server.listen(PORT, () => {
    console.log(`CHROMATRACE lancé sur http://localhost:${PORT}`);
});

function endGame() {
    currentGameState = 'FINISHED';
    clearInterval(gameTimerInterval);
    clearTimeout(gameStartTimeout);
    roundStartFreezeUntil = 0;

    rebuildScores();

    // Classement complet trié par score décroissant
    const rankings = Array.from(state.players.values())
        .filter((p) => !p.disconnectedAt)
        .sort((a, b) => b.score - a.score)
        .map((p, index) => ({
            rank:  index + 1,
            numId: p.numId,   // Bug 9 : inclus pour identification côté client
            name:  p.name,
            color: p.color,
            score: p.score
        }));

    // top3 pour le podium visuel
    const podium = rankings.slice(0, 3);

    io.emit('gameStateChanged', {
        state:    'FINISHED',
        podium,
        rankings
    });
}