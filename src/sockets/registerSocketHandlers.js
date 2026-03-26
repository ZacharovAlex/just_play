const { SOCKET_EVENTS } = require("../core/constants");
const { getGameById } = require("../games");

function registerSocketHandlers(io, socket, deps) {
  const { roomManager, gameEngine, sessionManager } = deps;

  const emitRoomState = (roomCode) => {
    const room = roomManager.getRoomByCode(roomCode);
    if (!room) {
      return;
    }
    io.to(roomCode).emit(SOCKET_EVENTS.ROOM_STATE, roomManager.serializeRoom(room));
  };

  const emitRoomError = (message) => {
    socket.emit(SOCKET_EVENTS.ROOM_ERROR, { message });
  };

  const leaveAllCurrentMemberships = () => {
    const watcherRoomCode = roomManager.getWatcherRoomCode(socket.id);
    if (watcherRoomCode) {
      roomManager.removeWatcher(socket.id);
      gameEngine.handleWatcherDisconnected(watcherRoomCode, socket.id);
      socket.leave(watcherRoomCode);
    }

    const previousRoom = roomManager.getRoomByPlayer(socket.id);
    if (previousRoom) {
      const previousCode = previousRoom.code;
      const previousHostPlayerId = previousRoom.hostPlayerId;
      const leavingPlayer = roomManager.getPlayerBySocket(socket.id);
      if (leavingPlayer) {
        sessionManager.removeSession(leavingPlayer.playerId);
      }

      const result = roomManager.leaveCurrentRoom(socket.id);
      if (result) {
        if (result.roomClosed) {
          gameEngine.cleanupRoom(previousCode);
        } else {
          io.to(previousCode).emit(SOCKET_EVENTS.ROOM_PLAYER_LEFT, {
            socketId: socket.id,
            playerId: result.leavingPlayer?.playerId || null
          });

          if (previousHostPlayerId && result.room.hostPlayerId !== previousHostPlayerId) {
            const newHost = result.room.players.get(result.room.hostPlayerId);
            io.to(previousCode).emit(SOCKET_EVENTS.ROOM_HOST_CHANGED, {
              newHostSocketId: newHost?.socketId || null,
              newHostPlayerId: result.room.hostPlayerId
            });
          }

          emitRoomState(previousCode);
        }
      }

      socket.leave(previousCode);
    }

    // Safety net for stale subscriptions: keep only own socket room.
    for (const joinedRoom of socket.rooms) {
      if (joinedRoom !== socket.id) {
        socket.leave(joinedRoom);
      }
    }
  };

  socket.on(SOCKET_EVENTS.ROOM_CREATE, ({ hostName, playerId, gameId }) => {
    try {
      if (!hostName || !playerId || !gameId) {
        throw new Error("HOST_NAME_PLAYER_ID_GAME_ID_REQUIRED");
      }
      leaveAllCurrentMemberships();

      const game = getGameById(gameId);
      if (!game) {
        throw new Error("GAME_NOT_FOUND");
      }

      const room = roomManager.createRoom({
        hostSocketId: socket.id,
        hostName,
        playerId,
        gameId: game.id,
        gameTitle: game.title,
        gameConfig: {
          ...game.config,
          questions: game.questions
        }
      });
      socket.join(room.code);
      emitRoomState(room.code);
    } catch (error) {
      emitRoomError(error.message);
    }
  });

  socket.on(SOCKET_EVENTS.ROOM_JOIN, ({ roomCode, playerName, playerId }) => {
    try {
      if (!playerId) {
        throw new Error("PLAYER_ID_REQUIRED");
      }
      leaveAllCurrentMemberships();

      const hasExplicitRoomCode = Boolean(roomCode && String(roomCode).trim());
      if (hasExplicitRoomCode) {
        // Explicit room code means user wants this target room, not session restore.
        sessionManager.removeSession(playerId);

        // Ensure user is not bound to an old room by playerId.
        const previousByPlayerId = roomManager.removePlayerFromRoom(playerId);
        if (previousByPlayerId?.roomCode) {
          const previousCode = previousByPlayerId.roomCode;
          if (previousByPlayerId.roomClosed) {
            gameEngine.cleanupRoom(previousCode);
          } else {
            io.to(previousCode).emit(SOCKET_EVENTS.ROOM_PLAYER_LEFT, {
              socketId: socket.id,
              playerId
            });
            emitRoomState(previousCode);
          }
        }

        if (!playerName) {
          throw new Error("ROOM_CODE_PLAYER_NAME_REQUIRED_FOR_NEW_JOIN");
        }
        const normalizedCode = String(roomCode).trim().toUpperCase();
        const room = roomManager.joinRoom({
          roomCode: normalizedCode,
          socketId: socket.id,
          playerName,
          playerId
        });
        socket.join(room.code);
        io.to(room.code).emit(SOCKET_EVENTS.ROOM_PLAYER_JOINED, { socketId: socket.id, playerName, playerId });
        emitRoomState(room.code);
        return;
      }

      // No explicit room code: try session-based reconnection.
      const session = sessionManager.consumeSession(playerId);
      if (!session) {
        throw new Error("ROOM_CODE_REQUIRED");
      }
      const room = roomManager.reconnectPlayer({ playerId, socketId: socket.id });
      socket.join(room.code);
      io.to(room.code).emit(SOCKET_EVENTS.ROOM_PLAYER_RECONNECTED, { playerId, socketId: socket.id });
      emitRoomState(room.code);
    } catch (error) {
      emitRoomError(error.message);
    }
  });

  socket.on(SOCKET_EVENTS.ROOM_WATCH, ({ roomCode }) => {
    try {
      if (!roomCode) {
        throw new Error("ROOM_CODE_REQUIRED");
      }
      const normalizedCode = String(roomCode).trim().toUpperCase();
      const room = roomManager.getRoomByCode(normalizedCode);
      if (!room) {
        throw new Error("ROOM_NOT_FOUND");
      }
      roomManager.addWatcherToRoom(normalizedCode, socket.id);
      socket.join(normalizedCode);
      socket.emit(SOCKET_EVENTS.ROOM_STATE, roomManager.serializeRoom(room));
    } catch (error) {
      emitRoomError(error.message);
    }
  });

  socket.on(SOCKET_EVENTS.ROOM_LEAVE, () => {
    handleLeaveOrDisconnect({ notifySocket: true });
  });

  socket.on(SOCKET_EVENTS.GAME_START, () => {
    try {
      const room = roomManager.getRoomByPlayer(socket.id);
      if (!room) {
        throw new Error("PLAYER_NOT_IN_ROOM");
      }
      if (!roomManager.isHost(room.code, socket.id)) {
        throw new Error("ONLY_HOST_CAN_START_GAME");
      }

      gameEngine.startGame(room.code);
      emitRoomState(room.code);
    } catch (error) {
      emitRoomError(error.message);
    }
  });

  socket.on(SOCKET_EVENTS.GAME_SUBMIT_ANSWER, ({ answer }) => {
    try {
      const room = roomManager.getRoomByPlayer(socket.id);
      if (!room) {
        throw new Error("PLAYER_NOT_IN_ROOM");
      }

      gameEngine.submitAnswer(room.code, { socketId: socket.id, answer });
      emitRoomState(room.code);
    } catch (error) {
      emitRoomError(error.message);
    }
  });

  socket.on(SOCKET_EVENTS.GAME_SUBMIT_VOTE, ({ targetPlayerId }) => {
    try {
      const room = roomManager.getRoomByPlayer(socket.id);
      if (!room) {
        throw new Error("PLAYER_NOT_IN_ROOM");
      }

      gameEngine.submitVote(room.code, { socketId: socket.id, targetPlayerId });
      emitRoomState(room.code);
    } catch (error) {
      emitRoomError(error.message);
    }
  });

  socket.on(SOCKET_EVENTS.GAME_ACTION, ({ answer }) => {
    try {
      const room = roomManager.getRoomByPlayer(socket.id);
      if (!room) {
        throw new Error("PLAYER_NOT_IN_ROOM");
      }

      gameEngine.submitAnswer(room.code, { socketId: socket.id, answer });
      emitRoomState(room.code);
    } catch (error) {
      emitRoomError(error.message);
    }
  });

  socket.on(SOCKET_EVENTS.GAME_FINISH, () => {
    try {
      const room = roomManager.getRoomByPlayer(socket.id);
      if (!room) {
        throw new Error("PLAYER_NOT_IN_ROOM");
      }
      if (!roomManager.isHost(room.code, socket.id)) {
        throw new Error("ONLY_HOST_CAN_FINISH_GAME");
      }

      gameEngine.finishGame(room.code);
      emitRoomState(room.code);
    } catch (error) {
      emitRoomError(error.message);
    }
  });

  socket.on(SOCKET_EVENTS.GAME_RULES_AUDIO_FINISHED, () => {
    try {
      const roomCode = roomManager.getWatcherRoomCode(socket.id);
      if (!roomCode) {
        throw new Error("WATCHER_NOT_IN_ROOM");
      }
      gameEngine.markRulesAudioFinished(roomCode, socket.id);
      emitRoomState(roomCode);
    } catch (error) {
      emitRoomError(error.message);
    }
  });

  socket.on(SOCKET_EVENTS.DISCONNECT, () => {
    const watcherRoomCode = roomManager.removeWatcher(socket.id);
    if (watcherRoomCode) {
      gameEngine.handleWatcherDisconnected(watcherRoomCode, socket.id);
      emitRoomState(watcherRoomCode);
      return;
    }
    handleLeaveOrDisconnect({ notifySocket: false, preserveSession: true });
  });

  function handleLeaveOrDisconnect({ notifySocket, preserveSession = false }) {
    const previousRoom = roomManager.getRoomByPlayer(socket.id);
    const previousCode = previousRoom?.code;
    const previousHostPlayerId = previousRoom?.hostPlayerId;

    if (preserveSession) {
      const disconnected = roomManager.markDisconnected(socket.id);
      if (!disconnected) {
        return;
      }

      sessionManager.createSession({ playerId: disconnected.player.playerId, roomCode: disconnected.roomCode });
      io.to(disconnected.roomCode).emit(SOCKET_EVENTS.ROOM_PLAYER_DISCONNECTED, {
        playerId: disconnected.player.playerId
      });
      emitRoomState(disconnected.roomCode);
      return;
    }

    const leavingPlayer = roomManager.getPlayerBySocket(socket.id);
    if (leavingPlayer) {
      sessionManager.removeSession(leavingPlayer.playerId);
    }

    const result = roomManager.leaveCurrentRoom(socket.id);
    if (!result) {
      return;
    }

    if (result.roomClosed) {
      gameEngine.cleanupRoom(previousCode);
      return;
    }

    io.to(previousCode).emit(SOCKET_EVENTS.ROOM_PLAYER_LEFT, {
      socketId: socket.id,
      playerId: result.leavingPlayer?.playerId || null
    });

    if (previousHostPlayerId && result.room.hostPlayerId !== previousHostPlayerId) {
      const newHost = result.room.players.get(result.room.hostPlayerId);
      io.to(previousCode).emit(SOCKET_EVENTS.ROOM_HOST_CHANGED, {
        newHostSocketId: newHost?.socketId || null,
        newHostPlayerId: result.room.hostPlayerId
      });
    }

    emitRoomState(previousCode);
    if (notifySocket) {
      socket.leave(previousCode);
      socket.emit(SOCKET_EVENTS.ROOM_STATE, null);
    }
  }
}

module.exports = {
  registerSocketHandlers
};
