const appSocket = (typeof socket !== 'undefined') ? socket : io();

let currentDuration = 180;
let itemsOn = true;
let boostOn = true;
let playerCount = 0;

window.changeDuration = function(amount) {
    currentDuration += amount;
    if (currentDuration < 60) currentDuration = 60; 
    if (currentDuration > 600) currentDuration = 600; 
    
    const mins = Math.floor(currentDuration / 60);
    const secs = currentDuration % 60;
    document.getElementById('duration-display').innerText = `${mins}:${secs.toString().padStart(2, '0')}`;
    sendSettings();
};

window.toggleItems = function() {
    itemsOn = !itemsOn;
    const btn = document.getElementById('items-toggle');
    btn.innerText = itemsOn ? 'ON' : 'OFF';
    btn.className = itemsOn ? 'toggle-btn on' : 'toggle-btn';
    sendSettings();
};

window.toggleBoost = function() {
    boostOn = !boostOn;
    const btn = document.getElementById('boost-toggle');
    btn.innerText = boostOn ? 'ON' : 'OFF';
    btn.className = boostOn ? 'toggle-btn on' : 'toggle-btn';
    sendSettings();
};

function sendSettings() {
    appSocket.emit('adminUpdateSettings', {
        durationSec: currentDuration,
        itemsEnabled: itemsOn,
        boostEnabled: boostOn
    });
}

window.startGame = function() {
    appSocket.emit('adminStartGame');
};

window.resetGame = function() {
    appSocket.emit('adminResetGame');
};

appSocket.on('gameStateChanged', (payload) => {
    const state = payload.state || payload;

    if (state === 'LOBBY') {
        document.getElementById('end-screen').classList.remove('visible');
        document.getElementById('hud').classList.remove('visible');
        document.getElementById('game-canvas').classList.remove('visible');
        document.getElementById('lobby-screen').classList.remove('hidden');
    } 
    else if (state === 'PLAYING') {
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('hud').classList.add('visible');
        document.getElementById('game-canvas').classList.add('visible');
    } 
    else if (state === 'FINISHED') {
        document.getElementById('hud').classList.remove('visible');
        document.getElementById('game-canvas').classList.remove('visible');
        document.getElementById('end-screen').classList.add('visible');
        
        const podiumDiv = document.getElementById('podium');
        podiumDiv.innerHTML = '';
        if(payload.podium) {
            payload.podium.forEach((p, index) => {
                podiumDiv.innerHTML += `
                    <div class="podium-entry" style="--podium-color: ${p.color}; order: ${index === 0 ? 2 : (index === 1 ? 1 : 3)}">
                        <div class="podium-cube" style="height: ${120 - index * 30}px">${index + 1}</div>
                        <div class="podium-name">${p.name}</div>
                        <div class="podium-territory">${p.score} blocs</div>
                    </div>
                `;
            });
        }
    }
});

appSocket.on('timeUpdate', (timeRemaining) => {
    const mins = Math.floor(timeRemaining / 60);
    const secs = timeRemaining % 60;
    const timerDisplay = document.getElementById('timer-display');
    timerDisplay.innerText = `${mins}:${secs.toString().padStart(2, '0')}`;
    
    if (timeRemaining <= 10) {
        timerDisplay.classList.add('urgent'); 
    } else {
        timerDisplay.classList.remove('urgent');
    }
});

appSocket.on('state', (payload) => {
    const urlBox = document.getElementById('server-url');
    if (urlBox && payload.serverIp) {
        urlBox.innerText = `${payload.serverIp}:3000/controller.html`;
    }
    if (!document.getElementById('lobby-screen').classList.contains('hidden')) {
        if (payload.connectedPlayers !== playerCount) {
            playerCount = payload.connectedPlayers;
            document.getElementById('player-count-num').innerText = playerCount;
            document.getElementById('start-btn').disabled = playerCount < 1; 

            const list = document.getElementById('player-list');
            list.innerHTML = '';
            payload.players.forEach(p => {
                list.innerHTML += `
                    <div class="player-entry" style="--player-color: ${p.color}">
                        <div class="player-dot"></div>
                        <div class="player-name">${p.name}</div>
                    </div>
                `;
            });
        }
    }
    
    if (document.getElementById('hud').classList.contains('visible')) {
        const lbContainer = document.getElementById('lb-entries');
        if (!lbContainer) return;
        lbContainer.innerHTML = ''; 
        
        payload.top5.forEach((p, index) => {
            lbContainer.innerHTML += `
                <div class="lb-entry">
                    <span class="lb-rank">#${index + 1}</span>
                    <div class="lb-color-dot" style="background: ${p.color}; box-shadow: 0 0 8px ${p.color}"></div>
                    <span class="lb-pseudo" style="color: ${p.color}; font-weight: bold;">${p.name}</span>
                    <span class="lb-score">${p.score} blocs</span>
                </div>
            `;
        });
    }
});