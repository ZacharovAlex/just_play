class GameStateManager {
  constructor(roomManager) {
    this.roomManager = roomManager;
    this.listeners = new Set();
  }

  getGameState(roomCode) {
    const room = this.roomManager.getRoomOrThrow(roomCode);
    return this.#deepFreeze(this.#deepClone(room.gameState));
  }

  updateGameState(roomCode, updater) {
    const room = this.roomManager.getRoomOrThrow(roomCode);
    const previousState = this.#deepFreeze(this.#deepClone(room.gameState));
    const nextStateRaw = updater(previousState);
    const nextState = this.#deepFreeze(this.#deepClone(nextStateRaw));

    this.roomManager.setGameState(roomCode, nextState);
    this.#notify(roomCode, nextState, previousState);
    return nextState;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  #notify(roomCode, nextState, previousState) {
    for (const listener of this.listeners) {
      listener({ roomCode, nextState, previousState });
    }
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
}

module.exports = {
  GameStateManager
};
