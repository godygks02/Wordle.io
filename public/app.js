const socket = io();

// State
let currentRoom = null;
let playerName = '';
let myId = null;
let guesses = [];
let currentGuess = '';
let gameState = 'lobby'; // lobby, waiting, playing, finished
const MAX_GUESSES = 6;
const WORD_LENGTH = 5;

// DOM Elements
const views = {
    lobby: document.getElementById('lobby-view'),
    waiting: document.getElementById('waiting-view'),
    game: document.getElementById('game-view'),
    spectator: document.getElementById('spectator-view'),
    leaderboard: document.getElementById('leaderboard-view')
};

// --- View Management ---
function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[viewName].classList.add('active');
    gameState = viewName;
    
    if (viewName === 'waiting') {
        isReady = false;
        readyBtn.textContent = 'Ready Up';
        readyBtn.style.backgroundColor = 'var(--primary-color)';
    }
}

function showToast(message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// --- Lobby Logic ---
document.getElementById('create-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('player-name').value.trim();
    
    if (!nameInput) {
        document.getElementById('lobby-error').textContent = 'Please enter your name first.';
        return;
    }
    
    const randomRoom = Math.random().toString(36).substring(2, 8).toUpperCase();
    playerName = nameInput;
    socket.emit('join_room', { roomId: randomRoom, playerName });
});
document.getElementById('join-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('player-name').value.trim();
    const roomInput = document.getElementById('room-code').value.trim().toUpperCase();
    
    if (!nameInput || !roomInput) {
        document.getElementById('lobby-error').textContent = 'Please enter both name and room code.';
        return;
    }
    
    playerName = nameInput;
    socket.emit('join_room', { roomId: roomInput, playerName });
});

// --- Waiting Room Logic ---
const readyBtn = document.getElementById('ready-btn');
let isReady = false;

readyBtn.addEventListener('click', () => {
    isReady = !isReady;
    readyBtn.textContent = isReady ? 'Cancel Ready' : 'Ready Up';
    readyBtn.style.backgroundColor = isReady ? 'var(--gray-dark)' : 'var(--primary-color)';
    socket.emit('set_ready', isReady);
});

document.getElementById('leave-room-btn').addEventListener('click', () => {
    socket.emit('leave_room');
    switchView('lobby');
    currentRoom = null;
    if (timerInterval) clearInterval(timerInterval);
});

window.addEventListener('beforeunload', (e) => {
    if (gameState !== 'lobby') {
        e.preventDefault();
        e.returnValue = ''; // Required for Chrome and others
        return '';
    }
});

const timerToggle = document.getElementById('timer-toggle');
const surrenderToggle = document.getElementById('surrender-toggle');
const timerInputGroup = document.getElementById('timer-input-group');
const timerValue = document.getElementById('timer-value');
function autoSaveSettings() {
    const timeLimit = timerToggle.checked ? parseInt(timerValue.value) * 60 : 0;
    const allowSurrender = surrenderToggle.checked;
    socket.emit('update_settings', { timeLimit, allowSurrender });
}

timerToggle.addEventListener('change', () => {
    timerInputGroup.style.display = timerToggle.checked ? 'flex' : 'none';
    autoSaveSettings();
});

surrenderToggle.addEventListener('change', autoSaveSettings);

timerValue.addEventListener('input', autoSaveSettings);

function updateWaitingRoom(roomData) {
    document.getElementById('display-room-code').textContent = roomData.id;
    const list = document.getElementById('waiting-players-list');
    list.innerHTML = '';
    
    const isHost = socket.id === roomData.hostId;
    
    // Sync Settings UI
    document.getElementById('host-badge').style.display = isHost ? 'inline' : 'none';
    timerToggle.disabled = !isHost;
    surrenderToggle.disabled = !isHost;
    timerValue.disabled = !isHost;
    
    // Only update if not currently typing to avoid overwriting user input
    if (document.activeElement !== timerValue && document.activeElement !== timerToggle && document.activeElement !== surrenderToggle) {
        surrenderToggle.checked = !!roomData.allowSurrender;
        
        if (roomData.timeLimit > 0) {
            timerToggle.checked = true;
            timerValue.value = roomData.timeLimit / 60;
            timerInputGroup.style.display = 'flex';
        } else {
            timerToggle.checked = false;
            timerInputGroup.style.display = 'none';
        }
    }
    
    roomData.players.forEach(p => {
        if (p.id === socket.id) {
            myId = p.id;
            // Sync local isReady state with server
            isReady = p.isReady;
            readyBtn.textContent = isReady ? 'Cancel Ready' : 'Ready Up';
            readyBtn.style.backgroundColor = isReady ? 'var(--gray-dark)' : 'var(--primary-color)';
        }
        const hostCrown = p.id === roomData.hostId ? '👑' : '';
        const item = document.createElement('div');
        item.className = 'player-item';
        item.innerHTML = `
            <span>${p.name} ${hostCrown} ${p.id === socket.id ? '(You)' : ''}</span>
            <span class="status ${p.isReady ? 'ready' : ''}">${p.isReady ? 'READY' : 'WAITING'}</span>
        `;
        list.appendChild(item);
    });
}

// --- Game Logic ---

function initBoard() {
    const board = document.getElementById('main-board');
    board.innerHTML = '';
    guesses = [];
    currentGuess = '';
    
    // Create 6 rows of 5 tiles
    for (let i = 0; i < MAX_GUESSES; i++) {
        const row = document.createElement('div');
        row.className = 'row';
        for (let j = 0; j < WORD_LENGTH; j++) {
            const tile = document.createElement('div');
            tile.className = 'tile';
            tile.id = `tile-${i}-${j}`;
            row.appendChild(tile);
        }
        board.appendChild(row);
    }

    // Reset keyboard colors
    document.querySelectorAll('.keyboard-row button').forEach(btn => {
        btn.removeAttribute('data-state');
    });
}


function updateBoardUI() {
    // Clear current row
    const currentRowIdx = guesses.length;
    if (currentRowIdx >= MAX_GUESSES) return;

    for (let i = 0; i < WORD_LENGTH; i++) {
        const tile = document.getElementById(`tile-${currentRowIdx}-${i}`);
        tile.textContent = currentGuess[i] || '';
        if (currentGuess[i]) {
            tile.setAttribute('data-state', 'tbd');
        } else {
            tile.removeAttribute('data-state');
        }
    }
}

function handleKeypress(key) {
    if (gameState !== 'game') return;
    
    if (key === 'Backspace' || key === 'Backspace') {
        if (currentGuess.length > 0) {
            currentGuess = currentGuess.slice(0, -1);
            updateBoardUI();
        }
        return;
    }
    
    if (key === 'Enter') {
        if (currentGuess.length !== WORD_LENGTH) {
            showToast('Not enough letters');
            // Shake row
            const rowIdx = guesses.length;
            const row = document.getElementById(`tile-${rowIdx}-0`).parentElement;
            row.classList.remove('shake');
            void row.offsetWidth; // trigger reflow
            row.classList.add('shake');
            return;
        }
        
        // Submit guess
        socket.emit('submit_guess', currentGuess);
        return;
    }
    
    if (/^[a-zA-Z]$/.test(key) && currentGuess.length < WORD_LENGTH) {
        currentGuess += key.toLowerCase();
        updateBoardUI();
    }
}

// Keyboard input mapping
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    handleKeypress(e.key);
});

document.getElementById('keyboard').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
        handleKeypress(e.target.getAttribute('data-key'));
        // remove focus so enter doesn't re-trigger button
        e.target.blur(); 
    }
});

function animateRow(rowIdx, colors, word) {
    for (let i = 0; i < WORD_LENGTH; i++) {
        const tile = document.getElementById(`tile-${rowIdx}-${i}`);
        setTimeout(() => {
            tile.classList.add('flip');
            tile.setAttribute('data-state', colors[i]);
            
            // Update keyboard color
            const keyBtn = document.querySelector(`.keyboard-row button[data-key="${word[i]}"]`);
            if (keyBtn) {
                // Only upgrade colors (gray -> yellow -> green)
                const currentState = keyBtn.getAttribute('data-state');
                if (colors[i] === 'green' || (colors[i] === 'yellow' && currentState !== 'green') || (!currentState && colors[i] === 'gray')) {
                    keyBtn.setAttribute('data-state', colors[i]);
                }
            }
        }, i * 250); // Staggered animation
    }
}


// --- Socket Listeners ---
socket.on('connect', () => {
    if (currentRoom && myId) {
        socket.emit('rejoin_room', { 
            roomId: currentRoom.id, 
            oldSocketId: myId
        });
    }
});

socket.on('error', (msg) => {
    document.getElementById('lobby-error').textContent = msg;
});

socket.on('room_update', (roomData) => {
    currentRoom = roomData;
    
    const me = roomData.players.find(p => p.id === socket.id);
    if (me) {
        myId = me.id;
    }
    
    if (roomData.state === 'Waiting' && gameState !== 'waiting') {
        // Only force switch to waiting if we are not on the leaderboard
        if (gameState !== 'leaderboard') {
            switchView('waiting');
        }
    }
    
    if (gameState === 'waiting') {
        updateWaitingRoom(roomData);
    }
});

let timerInterval = null;

function startTimer(endTime) {
    if (timerInterval) clearInterval(timerInterval);
    const display = document.getElementById('timer-display');
    if (!endTime) {
        display.textContent = 'No Limit';
        return;
    }
    
    timerInterval = setInterval(() => {
        const now = Date.now();
        const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
        
        const mins = Math.floor(remaining / 60).toString().padStart(2, '0');
        const secs = (remaining % 60).toString().padStart(2, '0');
        display.textContent = `${mins}:${secs}`;
        
        if (remaining <= 0) {
            clearInterval(timerInterval);
        }
    }, 1000);
}

socket.on('game_start', (roomData) => {
    currentRoom = roomData;
    switchView('game');
    initBoard();
    document.getElementById('surrender-btn').style.display = 'none';
    startTimer(roomData.endTime);
});

socket.on('player_won', (data) => {
    showToast(`${data.name} guessed correctly in ${data.rank} place!`);
    if (currentRoom.allowSurrender && gameState === 'game') {
        document.getElementById('surrender-btn').style.display = 'block';
    }
});

socket.on('player_surrendered', (data) => {
    showToast(`${data.name} has given up!`);
});

socket.on('spectator_update', (data) => {
    if (gameState === 'game') {
        switchView('spectator');
    }
    if (gameState === 'spectator') {
        renderSpectatorBoards(data);
    }
});

function renderSpectatorBoards(players) {
    const grid = document.getElementById('spectator-grid');
    grid.innerHTML = '';
    
    players.forEach(p => {
        const container = document.createElement('div');
        container.className = 'spectator-board-container';
        
        let statusText = '';
        if (p.connected === false) statusText = ' - Offline';
        else if (p.isWin) statusText = ' - Finished';
        else if (p.hasSurrendered) statusText = ' - Surrendered';
        
        let boardHtml = `<div class="spectator-board">`;
        
        // Ensure 6 rows
        for (let i = 0; i < 6; i++) {
            boardHtml += `<div class="spectator-row">`;
            const guess = p.guesses[i];
            
            for (let j = 0; j < 5; j++) {
                if (guess) {
                    const char = guess.word[j];
                    const color = guess.colors[j];
                    boardHtml += `<div class="spectator-tile ${color}">${char}</div>`;
                } else {
                    boardHtml += `<div class="spectator-tile"></div>`;
                }
            }
            boardHtml += `</div>`;
        }
        boardHtml += `</div>`;
        
        container.innerHTML = `
            <h4>${p.name}${statusText}</h4>
            ${boardHtml}
        `;
        grid.appendChild(container);
    });
}

document.getElementById('surrender-btn').addEventListener('click', () => {
    socket.emit('surrender');
});

socket.on('guess_error', (msg) => {
    showToast(msg);
    const rowIdx = guesses.length;
    const row = document.getElementById(`tile-${rowIdx}-0`).parentElement;
    row.classList.remove('shake');
    void row.offsetWidth;
    row.classList.add('shake');
});

socket.on('guess_result', (res) => {
    const wordGuessed = currentGuess;
    animateRow(guesses.length, res.colors, wordGuessed);
    guesses.push({ word: wordGuessed, colors: res.colors });
    currentGuess = '';
    
    if (res.isWin) {
        setTimeout(() => showToast('Great job! Waiting for others...'), 1500);
    } else if (guesses.length >= MAX_GUESSES) {
        setTimeout(() => showToast('Out of guesses! Waiting for others...'), 1500);
    }
});

socket.on('game_over', (data) => {
    if (timerInterval) clearInterval(timerInterval);
    
    const showLeaderboard = () => {
        switchView('leaderboard');
        document.getElementById('final-target-word').textContent = data.targetWord.toUpperCase();
        
        const list = document.getElementById('leaderboard-list');
        list.innerHTML = '';
        
        data.leaderboard.forEach(p => {
            const item = document.createElement('div');
            item.className = 'leaderboard-item';
            
            const timeStr = p.isWin ? `${(p.timeTaken / 1000).toFixed(1)}s` : 'Failed';
            
            let miniBoardHtml = '';
            if (p.guessesColors && p.guessesColors.length > 0) {
                miniBoardHtml = '<div class="mini-board" style="margin-right: 15px;">';
                p.guessesColors.forEach(guess => {
                    miniBoardHtml += '<div class="mini-row">';
                    for (let i = 0; i < 5; i++) {
                        const color = guess.colors[i];
                        const char = guess.word[i];
                        miniBoardHtml += `<div class="mini-tile ${color}" style="display: flex; justify-content: center; align-items: center; color: white; font-size: 8px; font-weight: bold;">${char}</div>`;
                    }
                    miniBoardHtml += '</div>';
                });
                miniBoardHtml += '</div>';
            }
            
            item.innerHTML = `
                <div class="rank" style="margin-right: 15px;">#${p.rank}</div>
                ${miniBoardHtml}
                <div class="player-info">${p.name} ${p.name === playerName ? '(You)' : ''}</div>
                <div class="stats">
                    ${p.guessCount} Guesses<br>
                    ${timeStr}
                </div>
            `;
            list.appendChild(item);
        });
    };

    if (data.reason === 'timeout') {
        showLeaderboard();
    } else {
        // Wait a moment for final animations to finish
        setTimeout(showLeaderboard, 1000);
    }
});

// Play Again Button
document.getElementById('play-again-btn').addEventListener('click', () => {
    switchView('waiting');
    socket.emit('return_to_room');
});
