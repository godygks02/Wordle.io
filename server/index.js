const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const roomManager = require('./RoomManager');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, '../public')));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Join a room
    socket.on('join_room', ({ roomId, playerName }) => {
        const result = roomManager.joinRoom(roomId, socket.id, playerName);
        if (result.error) {
            socket.emit('error', result.error);
            return;
        }

        socket.join(roomId);
        socket.data.roomId = roomId;

        // Broadcast updated room state
        io.to(roomId).emit('room_update', roomManager.getRoomSummary(roomId));
    });

    socket.on('update_settings', (timeLimit) => {
        const roomId = socket.data.roomId;
        if (!roomId) return;
        
        if (roomManager.updateSettings(roomId, socket.id, timeLimit)) {
            io.to(roomId).emit('room_update', roomManager.getRoomSummary(roomId));
        }
    });

    // Toggle ready state
    socket.on('set_ready', (isReady) => {
        const roomId = socket.data.roomId;
        if (!roomId) return;

        const allReady = roomManager.setReady(roomId, socket.id, isReady);
        
        if (allReady) {
            // Game started!
            const roomSummary = roomManager.getRoomSummary(roomId);
            
            // Everyone leaves spectator room for the new game
            io.in(roomId).socketsLeave(`${roomId}_spectators`);
            
            io.to(roomId).emit('game_start', roomSummary);
            
            if (roomSummary.timeLimit > 0) {
                setTimeout(() => {
                    if (roomManager.forceEndGame(roomId)) {
                        io.to(roomId).emit('game_over', {
                            targetWord: roomManager.getOrCreateRoom(roomId).targetWord,
                            leaderboard: roomManager.getLeaderboard(roomId)
                        });
                    }
                }, roomSummary.timeLimit * 1000);
            }
        } else {
            io.to(roomId).emit('room_update', roomManager.getRoomSummary(roomId));
        }
    });

    // Handle guess
    socket.on('submit_guess', (word) => {
        const roomId = socket.data.roomId;
        if (!roomId) return;

        const result = roomManager.submitGuess(roomId, socket.id, word);
        
        if (result.error) {
            socket.emit('guess_error', result.error);
            return;
        }

        // Send back the specific result to the player
        socket.emit('guess_result', {
            valid: true,
            colors: result.colors,
            isWin: result.isWin
        });

        if (result.isWin) {
            io.to(roomId).emit('player_won', { name: result.playerName, rank: result.rank });
            socket.join(`${roomId}_spectators`);
            socket.emit('spectator_update', roomManager.getSpectatorData(roomId));
        } else if (result.playerFinished) {
            socket.join(`${roomId}_spectators`);
            socket.emit('spectator_update', roomManager.getSpectatorData(roomId));
        }

        // Broadcast the update (colors only) to everyone
        io.to(roomId).emit('room_update', roomManager.getRoomSummary(roomId));
        
        // Broadcast spectator update (full words) to spectators
        io.to(`${roomId}_spectators`).emit('spectator_update', roomManager.getSpectatorData(roomId));

        if (result.allFinished) {
            const targetWord = roomManager.rooms.get(roomId).targetWord;
            io.to(roomId).emit('game_over', {
                leaderboard: roomManager.getLeaderboard(roomId),
                targetWord: targetWord
            });
        }
    });

    socket.on('surrender', () => {
        const roomId = socket.data.roomId;
        if (!roomId) return;

        const result = roomManager.surrender(roomId, socket.id);
        if (result.error) return;

        const room = roomManager.rooms.get(roomId);
        const player = room.players.get(socket.id);
        io.to(roomId).emit('player_surrendered', { name: player.name });

        socket.join(`${roomId}_spectators`);
        socket.emit('spectator_update', roomManager.getSpectatorData(roomId));

        io.to(roomId).emit('room_update', roomManager.getRoomSummary(roomId));
        io.to(`${roomId}_spectators`).emit('spectator_update', roomManager.getSpectatorData(roomId));

        if (result.allFinished) {
            const targetWord = roomManager.rooms.get(roomId).targetWord;
            io.to(roomId).emit('game_over', {
                leaderboard: roomManager.getLeaderboard(roomId),
                targetWord: targetWord
            });
        }
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const roomId = socket.data.roomId;
        if (roomId) {
            roomManager.leaveRoom(roomId, socket.id);
            // Broadcast update if room still exists
            const summary = roomManager.getRoomSummary(roomId);
            if (summary) {
                io.to(roomId).emit('room_update', summary);
                
                // If game was playing and leaving caused all remaining to be finished
                if (summary.state === 'Playing') {
                    if (roomManager.checkAllFinished(roomId)) {
                        const targetWord = roomManager.rooms.get(roomId).targetWord;
                        io.to(roomId).emit('game_over', {
                            leaderboard: roomManager.getLeaderboard(roomId),
                            targetWord: targetWord
                        });
                    }
                }
            }
        }
    });

    socket.on('return_to_room', () => {
        const roomId = socket.data.roomId;
        if (!roomId) return;
        
        socket.leave(`${roomId}_spectators`);
        
        if (roomManager.resetRoom(roomId)) {
            io.to(roomId).emit('room_update', roomManager.getRoomSummary(roomId));
        } else {
            // If already reset, just sync for this player
            socket.emit('room_update', roomManager.getRoomSummary(roomId));
        }
    });

    socket.on('leave_room', () => {
        const roomId = socket.data.roomId;
        if (roomId) {
            roomManager.leaveRoom(roomId, socket.id);
            socket.leave(roomId);
            socket.leave(`${roomId}_spectators`);
            socket.data.roomId = null;
            
            const summary = roomManager.getRoomSummary(roomId);
            if (summary) {
                io.to(roomId).emit('room_update', summary);
                
                if (summary.state === 'Playing') {
                    if (roomManager.checkAllFinished(roomId)) {
                        const targetWord = roomManager.rooms.get(roomId).targetWord;
                        io.to(roomId).emit('game_over', {
                            leaderboard: roomManager.getLeaderboard(roomId),
                            targetWord: targetWord
                        });
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
