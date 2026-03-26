const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const { SOCKET_EVENTS } = require("./core/constants");
const { RoomManager } = require("./rooms/RoomManager");
const { GameEngine } = require("./game/GameEngine");
const { GameStateManager } = require("./game/GameStateManager");
const { GameDisplayController } = require("./game/GameDisplayController");
const { SessionManager } = require("./sessions/SessionManager");
const { registerSocketHandlers } = require("./sockets/registerSocketHandlers");
const { listGames } = require("./games");

function createApp() {
  const app = express();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const roomManager = new RoomManager();
  const gameStateManager = new GameStateManager(roomManager);
  const gameEngine = new GameEngine(roomManager, gameStateManager);
  const gameDisplayController = new GameDisplayController();
  const sessionManager = new SessionManager({
    ttlMs: 30_000,
    onExpire: ({ playerId, roomCode }) => {
      const roomBefore = roomManager.getRoomByCode(roomCode);
      const previousHostPlayerId = roomBefore?.hostPlayerId || null;
      const result = roomManager.removeDisconnectedPlayer(playerId);
      if (!result) {
        return;
      }

      if (result.roomClosed) {
        gameEngine.cleanupRoom(roomCode);
        return;
      }

      io.to(roomCode).emit(SOCKET_EVENTS.ROOM_PLAYER_LEFT, { playerId });
      if (previousHostPlayerId && result.room.hostPlayerId !== previousHostPlayerId) {
        const newHost = result.room.players.get(result.room.hostPlayerId);
        io.to(roomCode).emit(SOCKET_EVENTS.ROOM_HOST_CHANGED, {
          newHostPlayerId: result.room.hostPlayerId,
          newHostSocketId: newHost?.socketId || null
        });
      }
      io.to(roomCode).emit(SOCKET_EVENTS.ROOM_STATE, roomManager.serializeRoom(result.room));
    }
  });

  gameStateManager.subscribe(({ roomCode, nextState }) => {
    const room = roomManager.getRoomByCode(roomCode);
    const view = gameDisplayController.toTvView({ room, gameState: nextState });
    io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, view);
  });

  // Static assets for game rules audio, served as:
  //   /audio/<file>.mp3
  app.use("/audio", express.static(path.join(__dirname, "..", "public", "audio")));

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get("/games", (_req, res) => {
    res.status(200).json({ games: listGames() });
  });

  io.on(SOCKET_EVENTS.CONNECTION, (socket) => {
    registerSocketHandlers(io, socket, { roomManager, gameEngine, sessionManager });
  });

  return { app, server, io };
}

module.exports = {
  createApp
};
