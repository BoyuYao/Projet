// =============================================================
//  projector.js — Rendu Phaser CHROMATRACE
//  Bugs corrigés :
//   #1  - Effets aux bonnes coordonnées écran (cellW/cellH)
//   #5  - getCellSize ne pollue plus gameData.cellSize
//   #11 - Sprites items mis en cache (pas recréés chaque frame)
// =============================================================

const socket = io();

// ── Plein écran automatique ───────────────────────────────────
function demanderPleinEcran() {
    const el = document.documentElement;
    if (el.requestFullscreen)            el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else if (el.mozRequestFullScreen)    el.mozRequestFullScreen();
}

// Bug 5 fix : met à jour cellW/cellH directement, sans retourner de valeur
function syncCellSize() {
    gameData.cellW = window.innerWidth  / gameData.cols;
    gameData.cellH = window.innerHeight / gameData.rows;
}

socket.on('gameStateChanged', (payload) => {
    if (payload.state === 'PLAYING') {
        demanderPleinEcran();
        setTimeout(syncCellSize, 500);
    }
});

const gameData = {
    cols:     80,
    rows:     45,
    cellSize: 16,   // taille serveur (coordonnées logiques)
    cellW:    16,   // largeur cellule à l'écran (recalculé dynamiquement)
    cellH:    16,   // hauteur cellule à l'écran (recalculé dynamiquement)
    state:    null,
    prevAlive:  new Set(),
    prevScores: new Map(),
};

// =============================================================
//  Scène Phaser
// =============================================================
class ChromaScene extends Phaser.Scene {

    constructor() {
        super('ChromaScene');
        this.playerLabels  = new Map();   // numId → Text
        this.spawnEffects  = [];
        this.flashEffects  = [];
        this.particles     = [];
        this.gridPulse     = 0;
        this.itemSpriteMap = new Map();   // Bug 11 : id → Sprite (cache)
    }

    // Recalcule cellW/cellH selon la taille du canvas
    updateCellSize() {
        const w = this.scale.width  || window.innerWidth;
        const h = this.scale.height || window.innerHeight;
        gameData.cellW = w / gameData.cols;
        gameData.cellH = h / gameData.rows;
    }

    preload() {
        this.load.image('img-boost',  'assets/boost.png');
        this.load.image('img-shield', 'assets/shield.png');
        this.load.audio('game-music', 'assets/musique.mp3');
    }

    create() {
        // Calques ordonnés par profondeur explicite
        this.layerBackground = this.add.graphics().setDepth(0);
        this.layerGrid       = this.add.graphics().setDepth(10);  // territoires
        this.layerEffects    = this.add.graphics().setDepth(20);  // spawn/capture (sous joueurs)
        this.layerPlayers    = this.add.graphics().setDepth(40);  // traînées + cubes
        this.layerParticles  = this.add.graphics().setDepth(50);  // explosions (au-dessus)
        // items : depth 30 (entre effets et joueurs), géré via itemSpriteMap

        // ── Musique de fond ──────────────────────────────────
        // volume initial à 0 pour permettre le fade-in au démarrage
        this.bgMusic = this.sound.add('game-music', { loop: true, volume: 0 });

        socket.on('gameStateChanged', (payload) => {
            if (payload.state === 'PLAYING') {
                this.playMusic();
            } else {
                // FINISHED ou LOBBY : fondu de sortie
                this.stopMusic();
            }
        });

        socket.on('state', (payload) => {
            this.detectEvents(payload);
            gameData.cols     = payload.cols;
            gameData.rows     = payload.rows;
            gameData.cellSize = payload.cellSize;
            gameData.state    = payload;
        });
    }

    // ─────────────────────────────────────────────────────────
    //  Musique : fondu à l'entrée
    // ─────────────────────────────────────────────────────────
    playMusic() {
        if (this.bgMusic.isPlaying) return;

        // Stoppe tout tween en cours sur le volume avant de relancer
        this.tweens.killTweensOf(this.bgMusic);
        this.bgMusic.play();
        this.tweens.add({
            targets:  this.bgMusic,
            volume:   0.5,
            duration: 1500,
            ease:     'Linear',
        });
    }

    // ─────────────────────────────────────────────────────────
    //  Musique : fondu à la sortie
    // ─────────────────────────────────────────────────────────
    stopMusic() {
        if (!this.bgMusic.isPlaying) return;

        this.tweens.killTweensOf(this.bgMusic);
        this.tweens.add({
            targets:    this.bgMusic,
            volume:     0,
            duration:   800,
            ease:       'Linear',
            onComplete: () => this.bgMusic.stop(),
        });
    }

    // ─────────────────────────────────────────────────────────
    //  Détection événements entre deux ticks
    // ─────────────────────────────────────────────────────────
    detectEvents(payload) {
        payload.players.forEach(player => {
            const wasAlive = gameData.prevAlive.has(player.numId);
            const isAlive  = player.alive;

            // Bug 1 fix : coordonnées en pixels écran (cellW/cellH), pas en cellSize serveur
            const px = player.x * gameData.cellW + gameData.cellW / 2;
            const py = player.y * gameData.cellH + gameData.cellH / 2;

            if (wasAlive && !isAlive) {
                this.spawnExplosion(px, py, player.color);
            }

            if (!wasAlive && isAlive) {
                this.spawnEffect(px, py, player.color);
            }

            const prevScore = gameData.prevScores.get(player.numId) || 0;
            if (player.score > prevScore + 5) {
                this.spawnCaptureFlash(px, py, player.color);
            }

            gameData.prevScores.set(player.numId, player.score);
        });

        gameData.prevAlive = new Set(
            payload.players.filter(p => p.alive).map(p => p.numId)
        );
    }

    // ─────────────────────────────────────────────────────────
    //  Effet 1 : Explosion (élimination)
    // ─────────────────────────────────────────────────────────
    spawnExplosion(x, y, colorHex) {
        const color = Phaser.Display.Color.HexStringToColor(colorHex).color;
        const count = 18;

        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const speed = 2 + Math.random() * 4;
            const size  = 3 + Math.random() * 4;
            const life  = 0.6 + Math.random() * 0.4;

            this.particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size, color, alpha: 1, life, maxLife: life,
            });
        }

        this.flashEffects.push({
            type: 'shockwave', x, y,
            radius: 0, maxR: 60, color, alpha: 0.8, speed: 4,
        });
    }

    // ─────────────────────────────────────────────────────────
    //  Effet 2 : Spawn (apparition)
    // ─────────────────────────────────────────────────────────
    spawnEffect(x, y, colorHex) {
        const color = Phaser.Display.Color.HexStringToColor(colorHex).color;
        this.spawnEffects.push({ x, y, color, scale: 0, alpha: 1, phase: 'in' });
    }

    // ─────────────────────────────────────────────────────────
    //  Effet 3 : Flash capture
    // ─────────────────────────────────────────────────────────
    spawnCaptureFlash(x, y, colorHex) {
        const color = Phaser.Display.Color.HexStringToColor(colorHex).color;
        this.flashEffects.push({ type: 'flash', x, y, radius: 30, color, alpha: 0.6 });
    }

    // ─────────────────────────────────────────────────────────
    //  Fond : grille cyber avec pulse subtile
    // ─────────────────────────────────────────────────────────
    drawBackground() {
        const W = gameData.cols * gameData.cellW;
        const H = gameData.rows * gameData.cellH;

        this.layerBackground.clear();
        this.layerBackground.fillStyle(0x0f172a, 1);
        this.layerBackground.fillRect(0, 0, W, H);

        this.gridPulse += 0.02;
        const pulseAlpha = 0.05 + Math.sin(this.gridPulse) * 0.035;

        this.layerBackground.lineStyle(1, 0x06b6d4, pulseAlpha);
        for (let x = 0; x <= gameData.cols; x++) {
            this.layerBackground.lineBetween(
                x * gameData.cellW, 0,
                x * gameData.cellW, H
            );
        }
        for (let y = 0; y <= gameData.rows; y++) {
            this.layerBackground.lineBetween(
                0, y * gameData.cellH,
                W, y * gameData.cellH
            );
        }
    }

    // ─────────────────────────────────────────────────────────
    //  Territoires colorés
    // ─────────────────────────────────────────────────────────
    drawTerritories(state) {
        this.layerGrid.clear();

        const colorMap = new Map(
            state.players.map(p => [
                p.numId,
                Phaser.Display.Color.HexStringToColor(p.color).color
            ])
        );

        for (let y = 0; y < state.rows; y++) {
            for (let x = 0; x < state.cols; x++) {
                const owner = state.grid[y][x];
                if (!owner) continue;

                const color = colorMap.get(owner) || 0xffffff;
                this.layerGrid.fillStyle(color, 0.42);
                this.layerGrid.fillRect(
                    x * gameData.cellW,
                    y * gameData.cellH,
                    gameData.cellW,
                    gameData.cellH
                );
            }
        }
    }

    // ─────────────────────────────────────────────────────────
    //  Items — Bug 11 fix : sprites mis en cache par ID
    // ─────────────────────────────────────────────────────────
    drawItems(state) {
        const currentIds = new Set(state.items.map(i => i.id));

        // Détruire les sprites d'items qui n'existent plus
        for (const [id, sprite] of this.itemSpriteMap) {
            if (!currentIds.has(id)) {
                sprite.destroy();
                this.itemSpriteMap.delete(id);
            }
        }

        // Créer les nouveaux sprites, mettre à jour les existants
        state.items.forEach(item => {
            const sx = item.x * gameData.cellW + gameData.cellW / 2;
            const sy = item.y * gameData.cellH + gameData.cellH / 2;

            if (!this.itemSpriteMap.has(item.id)) {
                const texture = item.type === 'boost' ? 'img-boost' : 'img-shield';
                const sprite  = this.add.sprite(sx, sy, texture).setDepth(30);
                this.itemSpriteMap.set(item.id, sprite);
            } else {
                this.itemSpriteMap.get(item.id).setPosition(sx, sy);
            }

            this.itemSpriteMap.get(item.id)
                .setDisplaySize(gameData.cellW * 1.5, gameData.cellH * 1.5);
        });
    }

    // ─────────────────────────────────────────────────────────
    //  Joueurs : cubes + traînées + pseudos
    // ─────────────────────────────────────────────────────────
    drawPlayers(state) {
        this.layerPlayers.clear();

        // Nettoie les labels des joueurs éliminés
        const aliveIds = new Set(state.players.filter(p => p.alive).map(p => p.numId));
        for (const [id, label] of this.playerLabels.entries()) {
            if (!aliveIds.has(id)) {
                label.destroy();
                this.playerLabels.delete(id);
            }
        }

        const t = Date.now() / 1000;

        state.players.forEach(player => {
            const color = Phaser.Display.Color.HexStringToColor(player.color).color;

            // ── Traînée lumineuse avec effet de pulse ────────
            player.trail.forEach((cell, index) => {
                const phase = (t * 3 + index * 0.2) % (Math.PI * 2);
                const alpha = player.shield ? 0.35 : (0.75 + Math.sin(phase) * 0.15);
                const cw    = gameData.cellW;
                const ch    = gameData.cellH;
                const pad   = Math.min(cw, ch) * 0.18;

                this.layerPlayers.fillStyle(color, alpha);
                this.layerPlayers.fillRect(
                    cell.x * cw + pad,
                    cell.y * ch + pad,
                    cw - pad * 2,
                    ch - pad * 2
                );
            });

            if (!player.alive) return;

            const cw       = gameData.cellW;
            const ch       = gameData.cellH;
            const px       = player.x * cw + cw / 2;
            const py       = player.y * ch + ch / 2;
            const cubeSize = Math.min(cw, ch) * 1.5;
            const half     = cubeSize / 2;

            // Corps du cube
            this.layerPlayers.fillStyle(color, 1);
            this.layerPlayers.fillRoundedRect(px - half, py - half, cubeSize, cubeSize, 3);

            // Bordure sombre
            this.layerPlayers.lineStyle(1.5, 0x000000, 0.4);
            this.layerPlayers.strokeRoundedRect(px - half, py - half, cubeSize, cubeSize, 3);

            // Reflet blanc
            const shine = cubeSize * 0.38;
            this.layerPlayers.fillStyle(0xffffff, 0.42);
            this.layerPlayers.fillRoundedRect(px - half + 2, py - half + 2, shine, shine, 2);

            // Halo boost
            if (player.boost) {
                this.layerPlayers.lineStyle(2, 0x84cc16, 1);
                this.layerPlayers.strokeRoundedRect(
                    px - half - 3, py - half - 3, cubeSize + 6, cubeSize + 6, 5
                );
            }

            // Halo shield
            if (player.shield) {
                this.layerPlayers.lineStyle(2, 0xeab308, 1);
                this.layerPlayers.strokeRoundedRect(
                    px - half - 5, py - half - 5, cubeSize + 10, cubeSize + 10, 6
                );
            }

            // Pseudo (créé une fois, déplacé ensuite)
            if (!this.playerLabels.has(player.numId)) {
                const label = this.add.text(px, py - half - 2, player.name, {
                    fontFamily:      'Rajdhani',
                    fontStyle:       'bold',
                    fontSize:        '11px',
                    color:           '#ffffff',
                    stroke:          '#000000',
                    strokeThickness: 4,
                    resolution:      2,
                }).setOrigin(0.5, 1).setDepth(41);
                this.playerLabels.set(player.numId, label);
            } else {
                this.playerLabels.get(player.numId).setPosition(px, py - half - 2);
            }
        });
    }

    // ─────────────────────────────────────────────────────────
    //  Mise à jour et dessin des effets visuels
    // ─────────────────────────────────────────────────────────
    updateEffects(delta) {
        const dt = delta / 1000;
        this.layerEffects.clear();
        this.layerParticles.clear();

        // ── Effets de spawn (anneau qui s'agrandit) ──────────
        this.spawnEffects = this.spawnEffects.filter(e => e.alpha > 0);
        this.spawnEffects.forEach(e => {
            e.scale += dt * 3;
            e.alpha -= dt * 2;
            if (e.alpha <= 0) return;

            // Bug 5 fix : cellW pour la taille (pas gameData.cellSize qui peut être un objet)
            const size = gameData.cellW * 1.5 * e.scale;
            this.layerEffects.lineStyle(3, e.color, e.alpha);
            this.layerEffects.strokeRoundedRect(
                e.x - size / 2, e.y - size / 2, size, size, 4
            );
        });

        // ── Flashes et ondes de choc ─────────────────────────
        this.flashEffects = this.flashEffects.filter(e => e.alpha > 0);
        this.flashEffects.forEach(e => {
            if (e.type === 'shockwave') {
                e.radius += e.speed;
                e.alpha  -= dt * 2.5;
                if (e.alpha <= 0) return;

                this.layerEffects.lineStyle(3, e.color, e.alpha);
                this.layerEffects.strokeCircle(e.x, e.y, e.radius);

            } else if (e.type === 'flash') {
                e.alpha -= dt * 3;
                if (e.alpha <= 0) return;

                this.layerEffects.fillStyle(e.color, e.alpha * 0.3);
                this.layerEffects.fillCircle(e.x, e.y, e.radius);
                this.layerEffects.lineStyle(2, e.color, e.alpha);
                this.layerEffects.strokeCircle(e.x, e.y, e.radius);
            }
        });

        // ── Particules d'explosion ───────────────────────────
        this.particles = this.particles.filter(p => p.alpha > 0);
        this.particles.forEach(p => {
            p.x    += p.vx;
            p.y    += p.vy;
            p.vy   += 0.1;
            p.vx   *= 0.97;
            p.alpha -= dt / p.maxLife;
            if (p.alpha <= 0) return;

            this.layerParticles.fillStyle(p.color, p.alpha);
            this.layerParticles.fillRect(
                p.x - p.size / 2, p.y - p.size / 2,
                p.size, p.size
            );
        });
    }

    // ─────────────────────────────────────────────────────────
    //  Boucle principale
    // ─────────────────────────────────────────────────────────
    update(_time, delta) {
        this.updateCellSize();       // Recalcule cellW/cellH chaque frame
        this.drawBackground();
        this.updateEffects(delta);

        const state = gameData.state;
        if (!state) return;

        this.drawTerritories(state);
        this.drawItems(state);
        this.drawPlayers(state);
    }
}

// =============================================================
//  Configuration Phaser
// =============================================================
const config = {
    type: Phaser.AUTO,
    scale: {
        mode:       Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.NONE,
        width:      window.innerWidth,
        height:     window.innerHeight,
    },
    backgroundColor: '#0f172a',
    scene:    [ChromaScene],
    parent:   'game-canvas',
    pixelArt: false,
};

window.addEventListener('load', () => {
    const game = new Phaser.Game(config);
    // Bug 5 fix : syncCellSize met à jour cellW/cellH (plus d'assignation objet à cellSize)
    game.events.once('ready', syncCellSize);
});

window.addEventListener('resize', syncCellSize);
