const validator = require('./WordValidator');

class RoomManager {
    constructor() {
        // roomId -> room details
        this.rooms = new Map();
    }

    getOrCreateRoom(roomId) {
        if (!this.rooms.has(roomId)) {
            this.rooms.set(roomId, {
                id: roomId,
                state: 'Waiting', // 'Waiting', 'Playing', 'Finished'
                players: new Map(), // socketId -> player details
                targetWord: null,
                startTime: null,
                timeLimit: 180, // Default to 3 minutes
                endTime: null,
                hostId: null,
                allowSurrender: false,
                finishers: 0,
                timerId: null
            });
        }
        return this.rooms.get(roomId);
    }

    joinRoom(roomId, socketId, playerName) {
        const isNew = !this.rooms.has(roomId);
        const room = this.getOrCreateRoom(roomId);
        
        if (isNew) {
            room.hostId = socketId;
        }
        
        // Don't allow joining if game already in progress
        if (room.state !== 'Waiting') {
            return { error: 'Game already in progress' };
        }

        if (room.players.size >= 5 && !room.players.has(socketId)) {
            return { error: 'Room is full (max 5 players).' };
        }

        room.players.set(socketId, {
            id: socketId,
            name: playerName,
            isReady: false,
            guesses: [],
            isFinished: false,
            hasSurrendered: false,
            finishTime: null,
            score: null,
            connected: true
        });

        return { room };
    }

    leaveRoom(roomId, socketId) {
        const room = this.rooms.get(roomId);
        if (room) {
            if (room.state === 'Waiting') {
                room.players.delete(socketId);
                if (room.players.size === 0) {
                    this.rooms.delete(roomId);
                } else {
                    if (room.hostId === socketId) {
                        // Reassign host to the first available player
                        const nextHost = room.players.keys().next().value;
                        room.hostId = nextHost;
                    }
                    this.checkAllReady(roomId);
                }
            } else {
                // Game is playing or finished. Keep the player data so they can reconnect.
                const player = room.players.get(socketId);
                if (player) {
                    player.connected = false;
                }
                
                let anyConnected = false;
                for (const p of room.players.values()) {
                    if (p.connected) anyConnected = true;
                }
                if (!anyConnected) {
                    this.rooms.delete(roomId);
                } else {
                    this.checkAllFinished(roomId);
                }
            }
        }
    }

    rejoinRoom(roomId, oldSocketId, newSocketId) {
        const room = this.rooms.get(roomId);
        if (!room) return { error: 'Room not found' };

        const player = room.players.get(oldSocketId);
        if (!player) return { error: 'Player not found in room' };

        room.players.delete(oldSocketId);
        player.id = newSocketId;
        player.connected = true;
        room.players.set(newSocketId, player);

        if (room.hostId === oldSocketId) {
            room.hostId = newSocketId;
        }

        return { success: true };
    }

    setReady(roomId, socketId, isReady, onTimeOut) {
        const room = this.rooms.get(roomId);
        if (!room || room.state !== 'Waiting') return false;

        const player = room.players.get(socketId);
        if (player) {
            player.isReady = isReady;
        }

        return this.checkAllReady(roomId, onTimeOut);
    }

    updateSettings(roomId, socketId, settings) {
        const room = this.rooms.get(roomId);
        if (!room || room.state !== 'Waiting') return false;
        if (room.hostId !== socketId) return false;

        if (settings.timeLimit !== undefined) room.timeLimit = parseInt(settings.timeLimit) || 0;
        if (settings.allowSurrender !== undefined) room.allowSurrender = !!settings.allowSurrender;
        return true;
    }

    checkAllReady(roomId, onTimeOut) {
        const room = this.rooms.get(roomId);
        if (!room || room.players.size === 0) return false;

        let allReady = true;
        for (const [_, player] of room.players) {
            if (!player.isReady) {
                allReady = false;
                break;
            }
        }

        if (allReady && room.players.size > 0) {
            this.startGame(room, onTimeOut);
            return true;
        }
        return false;
    }

    startGame(room, onTimeOut) {
        room.state = 'Playing';
        room.targetWord = validator.getRandomTarget();
        room.startTime = Date.now();
        room.endTime = room.timeLimit > 0 ? room.startTime + room.timeLimit * 1000 : null;

        room.finishers = 0;

        // Reset player states just in case
        for (const [_, player] of room.players) {
            player.guesses = [];
            player.isFinished = false;
            player.hasSurrendered = false;
            player.finishTime = null;
            player.score = null;
            player.isReady = false;
        }

        // Start Server Timer
        if (room.timeLimit > 0 && onTimeOut) {
            if (room.timerId) clearTimeout(room.timerId);
            room.timerId = setTimeout(() => {
                if (this.forceEndGame(room.id)) {
                    onTimeOut();
                }
            }, room.timeLimit * 1000);
        }
    }

    submitGuess(roomId, socketId, word) {
        const room = this.rooms.get(roomId);
        if (!room || room.state !== 'Playing') return { error: 'Not in playing state' };

        const player = room.players.get(socketId);
        if (!player || player.isFinished) return { error: 'Player already finished' };

        if (!validator.isValidGuess(word)) {
            return { error: 'Invalid word' };
        }

        const colors = validator.evaluateGuess(word, room.targetWord);
        const isWin = colors.every(c => c === 'green');
        
        player.guesses.push({ word, colors });

        let finished = false;
        let rank = null;
        if (isWin) {
            room.finishers++;
            rank = room.finishers;
            player.isFinished = true;
            player.finishTime = Date.now();
            player.score = { rank }; // Temporary rank
            finished = true;
        } else if (player.guesses.length >= 6) {
            player.isFinished = true;
            player.finishTime = Infinity;
            finished = true;
        }

        const allFinished = this.checkAllFinished(roomId);

        return {
            valid: true,
            colors: colors,
            isWin: isWin,
            playerFinished: finished,
            allFinished: allFinished,
            rank: rank,
            playerName: player.name
        };
    }

    surrender(roomId, socketId) {
        const room = this.rooms.get(roomId);
        if (!room || room.state !== 'Playing') return { error: 'Not in playing state' };
        
        const player = room.players.get(socketId);
        if (!player || player.isFinished) return { error: 'Player already finished' };
        
        player.isFinished = true;
        player.hasSurrendered = true;
        player.finishTime = Infinity;
        
        const allFinished = this.checkAllFinished(roomId);
        return { success: true, allFinished };
    }

    getSpectatorData(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) return null;

        return Array.from(room.players.values()).map(p => ({
            id: p.id,
            name: p.name,
            guesses: p.guesses, // Has both word and colors
            isFinished: p.isFinished,
            hasSurrendered: p.hasSurrendered,
            isWin: p.finishTime !== Infinity && p.finishTime !== null && !p.hasSurrendered,
            connected: p.connected
        }));
    }

    checkAllFinished(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) return false;

        let allFinished = true;
        for (const [_, player] of room.players) {
            if (!player.isFinished) {
                allFinished = false;
                break;
            }
        }

        if (allFinished && room.state === 'Playing') {
            room.state = 'Finished';
            if (room.timerId) {
                clearTimeout(room.timerId);
                room.timerId = null;
            }
            this.calculateRankings(room);
        }
        return allFinished;
    }

    forceEndGame(roomId) {
        const room = this.rooms.get(roomId);
        if (!room || room.state !== 'Playing') return false;

        for (const [_, player] of room.players) {
            if (!player.isFinished) {
                player.isFinished = true;
                player.finishTime = Infinity;
            }
        }
        
        room.state = 'Finished';
        if (room.timerId) {
            clearTimeout(room.timerId);
            room.timerId = null;
        }
        this.calculateRankings(room);
        return true;
    }

    resetRoom(roomId) {
        const room = this.rooms.get(roomId);
        if (!room || room.state === 'Waiting') return false;
        
        room.state = 'Waiting';
        room.targetWord = null;
        room.startTime = null;
        room.endTime = null;
        room.finishers = 0;
        if (room.timerId) {
            clearTimeout(room.timerId);
            room.timerId = null;
        }
        
        for (const [_, player] of room.players) {
            player.isReady = false;
            player.guesses = [];
            player.isFinished = false;
            player.finishTime = null;
            player.score = null;
        }
        return true;
    }

    calculateRankings(room) {
        const playersArray = Array.from(room.players.values());
        
        // Sort: Winners first (finishTime !== Infinity), then by finishTime (lowest first), then by guess count (lowest first)
        playersArray.sort((a, b) => {
            if (a.finishTime !== Infinity && b.finishTime === Infinity) return -1;
            if (a.finishTime === Infinity && b.finishTime !== Infinity) return 1;
            
            if (a.finishTime !== Infinity && b.finishTime !== Infinity) {
                // Both won, check time
                const timeDiff = a.finishTime - b.finishTime;
                if (timeDiff !== 0) return timeDiff;
                
                // If exact same time (unlikely but possible), check guesses
                return a.guesses.length - b.guesses.length;
            }

            // Both failed
            return 0;
        });

        // Assign ranks to non-surrendered players
        let currentRank = 1;
        playersArray.forEach((p) => {
            if (!p.hasSurrendered) {
                p.score = {
                    rank: p.score?.rank || currentRank, // Use dynamic rank if set
                    timeTaken: p.finishTime !== Infinity ? p.finishTime - room.startTime : null
                };
                currentRank++;
            }
        });
    }

    getRoomSummary(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) return null;

        return {
            id: room.id,
            state: room.state,
            hostId: room.hostId,
            timeLimit: room.timeLimit,
            endTime: room.endTime,
            allowSurrender: room.allowSurrender,
            finishers: room.finishers,
            players: Array.from(room.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                isReady: p.isReady,
                guessCount: p.guesses.length,
                isFinished: p.isFinished,
                hasSurrendered: p.hasSurrendered,
                connected: p.connected,
                guesses: p.guesses.map(g => g.colors) // only send colors to prevent cheating
            }))
        };
    }

    getLeaderboard(roomId) {
        const room = this.rooms.get(roomId);
        if (!room || room.state !== 'Finished') return null;

        return Array.from(room.players.values())
            .filter(p => !p.hasSurrendered)
            .map(p => ({
                name: p.name,
                rank: p.score.rank,
                guessCount: p.guesses.length,
                guessesColors: p.finishTime !== Infinity ? p.guesses : null, // Send full words only for winners
                timeTaken: p.score.timeTaken,
                isWin: p.finishTime !== Infinity
            }))
            .sort((a, b) => a.rank - b.rank);
    }
}

module.exports = new RoomManager();
