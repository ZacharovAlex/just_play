const { CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_STATES } = require("../core/constants");

class RoomManager {
  constructor({ emptyRoomTtlMs = 30_000 } = {}) {
    this.roomsByCode = new Map();
    this.playerToRoom = new Map();
    this.socketToPlayer = new Map();
    this.watcherToRoom = new Map();
    this.roomToWatchers = new Map();
    this.emptyRoomTtlMs = emptyRoomTtlMs;
    this.emptyRoomTimers = new Map();
  }

  createRoom({ hostSocketId, hostName, playerId, gameId, gameConfig, gameTitle }) {
    const code = this.#generateUniqueCode();
    const now = Date.now();

    const room = {
      code,
      hostPlayerId: playerId,
      createdAt: now,
      updatedAt: now,
      state: ROOM_STATES.LOBBY,
      players: new Map(),
      gameState: null,
      gameId,
      gameTitle,
      gameConfig
    };

    room.players.set(playerId, {
      playerId,
      socketId: hostSocketId,
      name: hostName,
      joinedAt: now,
      isHost: true,
      isConnected: true,
      disconnectedAt: null
    });

    this.roomsByCode.set(code, room);
    this.playerToRoom.set(playerId, code);
    this.socketToPlayer.set(hostSocketId, playerId);
    return room;
  }

  joinRoom({ roomCode, socketId, playerName, playerId }) {
    const room = this.roomsByCode.get(roomCode);
    if (!room) {
      throw new Error("ROOM_NOT_FOUND");
    }
    if (this.playerToRoom.has(playerId)) {
      throw new Error("PLAYER_ALREADY_IN_ROOM");
    }
    if (this.socketToPlayer.has(socketId)) {
      throw new Error("SOCKET_ALREADY_BOUND");
    }

    const shouldBecomeHost = room.players.size === 0 || !room.hostPlayerId || !room.players.has(room.hostPlayerId);
    room.players.set(playerId, {
      playerId,
      socketId,
      name: playerName,
      joinedAt: Date.now(),
      isHost: shouldBecomeHost,
      isConnected: true,
      disconnectedAt: null
    });
    if (shouldBecomeHost) {
      room.hostPlayerId = playerId;
    }
    room.updatedAt = Date.now();
    this.#clearEmptyRoomTimer(roomCode);
    this.playerToRoom.set(playerId, roomCode);
    this.socketToPlayer.set(socketId, playerId);
    return room;
  }

  reconnectPlayer({ playerId, socketId }) {
    const roomCode = this.playerToRoom.get(playerId);
    if (!roomCode) {
      throw new Error("SESSION_NOT_FOUND");
    }
    const room = this.getRoomOrThrow(roomCode);
    const player = room.players.get(playerId);
    if (!player) {
      throw new Error("PLAYER_NOT_FOUND_IN_ROOM");
    }

    if (player.socketId) {
      this.socketToPlayer.delete(player.socketId);
    }
    player.socketId = socketId;
    player.isConnected = true;
    player.disconnectedAt = null;
    room.updatedAt = Date.now();
    this.socketToPlayer.set(socketId, playerId);
    return room;
  }

  markDisconnected(socketId) {
    const playerId = this.socketToPlayer.get(socketId);
    if (!playerId) {
      return null;
    }

    const roomCode = this.playerToRoom.get(playerId);
    if (!roomCode) {
      this.socketToPlayer.delete(socketId);
      return null;
    }

    const room = this.roomsByCode.get(roomCode);
    if (!room) {
      this.socketToPlayer.delete(socketId);
      this.playerToRoom.delete(playerId);
      return null;
    }

    const player = room.players.get(playerId);
    if (!player) {
      this.socketToPlayer.delete(socketId);
      return null;
    }

    player.socketId = null;
    player.isConnected = false;
    player.disconnectedAt = Date.now();
    room.updatedAt = Date.now();
    this.socketToPlayer.delete(socketId);

    return { roomCode, room, player };
  }

  leaveCurrentRoom(socketId) {
    const playerId = this.socketToPlayer.get(socketId);
    const roomCode = playerId ? this.playerToRoom.get(playerId) : null;
    if (!roomCode) {
      return null;
    }

    const room = this.roomsByCode.get(roomCode);
    if (!room) {
      this.socketToPlayer.delete(socketId);
      if (playerId) {
        this.playerToRoom.delete(playerId);
      }
      return null;
    }

    const leavingPlayer = room.players.get(playerId);
    room.players.delete(playerId);
    room.updatedAt = Date.now();
    this.playerToRoom.delete(playerId);
    this.socketToPlayer.delete(socketId);

    if (room.players.size === 0) {
      room.hostPlayerId = null;
      this.#scheduleEmptyRoomCleanup(roomCode, room);
      return { roomClosed: true, roomCode, room, leavingPlayer };
    }

    if (room.hostPlayerId === playerId) {
      const [nextHostPlayerId] = room.players.keys();
      room.hostPlayerId = nextHostPlayerId;
      const hostPlayer = room.players.get(nextHostPlayerId);
      hostPlayer.isHost = true;
    }

    return { roomClosed: false, roomCode, room, leavingPlayer };
  }

  removeDisconnectedPlayer(playerId) {
    const roomCode = this.playerToRoom.get(playerId);
    if (!roomCode) {
      return null;
    }

    const room = this.roomsByCode.get(roomCode);
    if (!room) {
      this.playerToRoom.delete(playerId);
      return null;
    }

    const player = room.players.get(playerId);
    if (!player || player.isConnected) {
      return null;
    }

    room.players.delete(playerId);
    room.updatedAt = Date.now();
    this.playerToRoom.delete(playerId);

    if (room.players.size === 0) {
      room.hostPlayerId = null;
      this.#scheduleEmptyRoomCleanup(roomCode, room);
      return { roomClosed: true, roomCode, room, player };
    }

    if (room.hostPlayerId === playerId) {
      const [nextHostPlayerId] = room.players.keys();
      room.hostPlayerId = nextHostPlayerId;
      const hostPlayer = room.players.get(nextHostPlayerId);
      hostPlayer.isHost = true;
    }

    return { roomClosed: false, roomCode, room, player };
  }

  removePlayerFromRoom(playerId) {
    const roomCode = this.playerToRoom.get(playerId);
    if (!roomCode) {
      return null;
    }

    const room = this.roomsByCode.get(roomCode);
    if (!room) {
      this.playerToRoom.delete(playerId);
      return null;
    }

    const leavingPlayer = room.players.get(playerId);
    if (!leavingPlayer) {
      this.playerToRoom.delete(playerId);
      return null;
    }

    room.players.delete(playerId);
    room.updatedAt = Date.now();

    this.playerToRoom.delete(playerId);

    if (leavingPlayer.socketId) {
      this.socketToPlayer.delete(leavingPlayer.socketId);
    }

    if (room.players.size === 0) {
      room.hostPlayerId = null;
      this.#scheduleEmptyRoomCleanup(roomCode, room);
      return { roomClosed: true, roomCode, room, leavingPlayer };
    }

    if (room.hostPlayerId === playerId) {
      const [nextHostPlayerId] = room.players.keys();
      room.hostPlayerId = nextHostPlayerId;
      const hostPlayer = room.players.get(nextHostPlayerId);
      hostPlayer.isHost = true;
    }

    return { roomClosed: false, roomCode, room, leavingPlayer };
  }

  setRoomState(roomCode, nextState) {
    const room = this.getRoomOrThrow(roomCode);
    room.state = nextState;
    room.updatedAt = Date.now();
    return room;
  }

  setGameState(roomCode, gameState) {
    const room = this.getRoomOrThrow(roomCode);
    room.gameState = this.#deepFreeze(this.#deepClone(gameState));
    room.updatedAt = Date.now();
    return room;
  }

  getRoomByCode(roomCode) {
    return this.roomsByCode.get(roomCode) || null;
  }

  addWatcherToRoom(roomCode, socketId) {
    const room = this.getRoomOrThrow(roomCode);
    this.watcherToRoom.set(socketId, roomCode);
    if (!this.roomToWatchers.has(roomCode)) {
      this.roomToWatchers.set(roomCode, new Set());
    }
    this.roomToWatchers.get(roomCode).add(socketId);
    room.updatedAt = Date.now();
    return room;
  }

  removeWatcher(socketId) {
    const roomCode = this.watcherToRoom.get(socketId);
    if (!roomCode) {
      return null;
    }
    this.watcherToRoom.delete(socketId);
    const set = this.roomToWatchers.get(roomCode);
    if (set) {
      set.delete(socketId);
      if (set.size === 0) {
        this.roomToWatchers.delete(roomCode);
      }
    }
    return roomCode;
  }

  getWatchersForRoom(roomCode) {
    return new Set(this.roomToWatchers.get(roomCode) || []);
  }

  getWatcherRoomCode(socketId) {
    return this.watcherToRoom.get(socketId) || null;
  }

  getRoomByPlayer(socketId) {
    const playerId = this.socketToPlayer.get(socketId);
    if (!playerId) {
      return null;
    }
    const roomCode = this.playerToRoom.get(playerId);
    if (!roomCode) {
      return null;
    }
    return this.roomsByCode.get(roomCode) || null;
  }

  isHost(roomCode, socketId) {
    const room = this.getRoomByCode(roomCode);
    const playerId = this.socketToPlayer.get(socketId);
    return Boolean(room && playerId && room.hostPlayerId === playerId);
  }

  getPlayerBySocket(socketId) {
    const playerId = this.socketToPlayer.get(socketId);
    if (!playerId) {
      return null;
    }
    const roomCode = this.playerToRoom.get(playerId);
    if (!roomCode) {
      return null;
    }
    const room = this.roomsByCode.get(roomCode);
    if (!room) {
      return null;
    }
    return room.players.get(playerId) || null;
  }

  serializeRoom(room) {
    const host = room.players.get(room.hostPlayerId) || null;
    return {
      code: room.code,
      hostPlayerId: room.hostPlayerId,
      hostSocketId: host?.socketId || null,
      state: room.state,
      gameId: room.gameId,
      gameTitle: room.gameTitle,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      watchersCount: this.getWatchersForRoom(room.code).size,
      players: Array.from(room.players.values()).map((p) => ({
        playerId: p.playerId,
        socketId: p.socketId,
        name: p.name,
        isHost: p.isHost,
        isConnected: p.isConnected
      })),
      gameState: room.gameState
    };
  }

  getRoomOrThrow(roomCode) {
    const room = this.getRoomByCode(roomCode);
    if (!room) {
      throw new Error("ROOM_NOT_FOUND");
    }
    return room;
  }

  #generateUniqueCode() {
    const maxAttempts = 50;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const code = this.#randomCode();
      if (!this.roomsByCode.has(code)) {
        return code;
      }
    }
    throw new Error("ROOM_CODE_GENERATION_FAILED");
  }

  #randomCode() {
    let output = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
      output += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return output;
  }

  #deepClone(value) {
    if (value === null || value === undefined) {
      return value;
    }
    return JSON.parse(JSON.stringify(value));
  }

  #deepFreeze(value) {
    if (value === null || value === undefined || typeof value !== "object") {
      return value;
    }

    Object.freeze(value);
    for (const key of Object.keys(value)) {
      this.#deepFreeze(value[key]);
    }
    return value;
  }

  #scheduleEmptyRoomCleanup(roomCode, room) {
    this.#clearEmptyRoomTimer(roomCode);
    room.state = ROOM_STATES.LOBBY;
    room.gameState = null;
    room.emptySince = Date.now();
    const timeoutId = setTimeout(() => {
      const currentRoom = this.roomsByCode.get(roomCode);
      if (!currentRoom) {
        this.emptyRoomTimers.delete(roomCode);
        return;
      }
      if (currentRoom.players.size > 0) {
        this.emptyRoomTimers.delete(roomCode);
        return;
      }
      this.roomsByCode.delete(roomCode);
      this.emptyRoomTimers.delete(roomCode);
    }, this.emptyRoomTtlMs);
    this.emptyRoomTimers.set(roomCode, timeoutId);
  }

  #clearEmptyRoomTimer(roomCode) {
    const timer = this.emptyRoomTimers.get(roomCode);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.emptyRoomTimers.delete(roomCode);
  }
}

module.exports = {
  RoomManager
};
