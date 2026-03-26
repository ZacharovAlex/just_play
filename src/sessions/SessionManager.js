class SessionManager {
  constructor({ ttlMs = 30_000, onExpire }) {
    this.ttlMs = ttlMs;
    this.onExpire = onExpire;
    this.sessions = new Map();
  }

  createSession({ playerId, roomCode }) {
    this.removeSession(playerId);

    const expiresAt = Date.now() + this.ttlMs;
    const timeoutId = setTimeout(() => {
      this.sessions.delete(playerId);
      if (this.onExpire) {
        this.onExpire({ playerId, roomCode });
      }
    }, this.ttlMs);

    this.sessions.set(playerId, { playerId, roomCode, expiresAt, timeoutId });
  }

  consumeSession(playerId) {
    const session = this.sessions.get(playerId);
    if (!session) {
      return null;
    }
    this.sessions.delete(playerId);
    clearTimeout(session.timeoutId);

    if (session.expiresAt < Date.now()) {
      return null;
    }
    return {
      playerId: session.playerId,
      roomCode: session.roomCode,
      expiresAt: session.expiresAt
    };
  }

  removeSession(playerId) {
    const existing = this.sessions.get(playerId);
    if (!existing) {
      return;
    }
    clearTimeout(existing.timeoutId);
    this.sessions.delete(playerId);
  }
}

module.exports = {
  SessionManager
};
