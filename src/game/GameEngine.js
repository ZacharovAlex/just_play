const { ROOM_STATES, GAME_PHASES, GAME_PHASE_TRANSITIONS } = require("../core/constants");

class GameEngine {
  constructor(roomManager, gameStateManager) {
    this.roomManager = roomManager;
    this.gameStateManager = gameStateManager;
    this.roundDurationSeconds = 60;
    this.votingDurationSeconds = 30;
    this.totalRounds = 5;
    this.roundStartDelaySeconds = 2;
    this.revealAnswerSeconds = 5;
    this.answeringTimers = new Map();
    this.votingTimers = new Map();
    this.roundStartTimers = new Map();
    this.nextRoundTimers = new Map();
    this.questions = [];
  }

  startGame(roomCode) {
    const room = this.roomManager.getRoomOrThrow(roomCode);
    if (room.state !== ROOM_STATES.LOBBY) {
      throw new Error("GAME_CAN_ONLY_START_FROM_LOBBY");
    }
    if (room.players.size < 3) {
      throw new Error("NOT_ENOUGH_PLAYERS_MIN_3");
    }

    const gameConfig = room.gameConfig || {};
    const roundDurationSeconds = gameConfig.roundDurationSeconds || this.roundDurationSeconds;
    const votingDurationSeconds = gameConfig.votingDurationSeconds || this.votingDurationSeconds;
    const totalRounds = gameConfig.totalRounds || this.totalRounds;
    const roundStartDelaySeconds = gameConfig.roundStartDelaySeconds || this.roundStartDelaySeconds;
    const revealAnswerSeconds = gameConfig.revealAnswerSeconds || this.revealAnswerSeconds;
    const questions = Array.isArray(gameConfig.questions) ? gameConfig.questions : this.questions;
    const rulesAudioUrl = gameConfig.rulesAudioUrl || null;
    const pendingWatcherIds = Array.from(this.roomManager.getWatchersForRoom(roomCode));

    const gameState = {
      round: 1,
      totalRounds,
      startedAt: Date.now(),
      phase: GAME_PHASES.LOBBY,
      roundDurationSeconds,
      remainingSeconds: 0,
      roundStartedAt: null,
      roundStartDelaySeconds,
      interRoundDelaySeconds: 0,
      revealAnswerSeconds,
      votingDurationSeconds,
      questions,
      currentQuestion: null,
      answersByPlayerId: {},
      votesByVoterId: {},
      voteCounts: {},
      votingClosed: false,
      roundWinner: null,
      lastRoundResults: [],
      scores: Object.fromEntries(
        Array.from(room.players.values()).map((p) => [p.playerId, 0])
      ),
      rulesAudioUrl,
      rulesAudioPendingWatcherIds: pendingWatcherIds,
      rulesAudioFinishedWatcherIds: []
    };

    this.roomManager.setRoomState(roomCode, ROOM_STATES.IN_GAME);
    this.gameStateManager.updateGameState(roomCode, () => gameState);
    if (!rulesAudioUrl || pendingWatcherIds.length === 0) {
      this.#enterRoundStart(roomCode);
      return this.roomManager.getRoomOrThrow(roomCode);
    }
    this.#transitionPhase(roomCode, GAME_PHASES.RULES_AUDIO);
    return this.roomManager.getRoomOrThrow(roomCode);
  }

  markRulesAudioFinished(roomCode, watcherSocketId) {
    const room = this.roomManager.getRoomByCode(roomCode);
    if (!room) {
      return null;
    }

    const state = this.gameStateManager.getGameState(roomCode) || {};
    if (state.phase !== GAME_PHASES.RULES_AUDIO) {
      throw new Error("INVALID_STATE_TRANSITION");
    }

    this.gameStateManager.updateGameState(roomCode, (prevState) => {
      const pending = new Set(prevState?.rulesAudioPendingWatcherIds || []);
      const finished = new Set(prevState?.rulesAudioFinishedWatcherIds || []);
      if (pending.has(watcherSocketId)) {
        finished.add(watcherSocketId);
      }
      return {
        ...(prevState || {}),
        rulesAudioFinishedWatcherIds: Array.from(finished)
      };
    });

    const next = this.gameStateManager.getGameState(roomCode) || {};
    const pending = new Set(next.rulesAudioPendingWatcherIds || []);
    const finished = new Set(next.rulesAudioFinishedWatcherIds || []);
    const isComplete = Array.from(pending).every((id) => finished.has(id));
    if (isComplete) {
      this.#enterRoundStart(roomCode);
    }
    return this.roomManager.getRoomByCode(roomCode);
  }

  handleWatcherDisconnected(roomCode, watcherSocketId) {
    const room = this.roomManager.getRoomByCode(roomCode);
    if (!room) {
      return;
    }

    const state = this.gameStateManager.getGameState(roomCode) || {};
    if (state.phase !== GAME_PHASES.RULES_AUDIO) {
      return;
    }

    this.gameStateManager.updateGameState(roomCode, (prevState) => {
      const pending = new Set(prevState?.rulesAudioPendingWatcherIds || []);
      const finished = new Set(prevState?.rulesAudioFinishedWatcherIds || []);
      pending.delete(watcherSocketId);
      finished.delete(watcherSocketId);
      return {
        ...(prevState || {}),
        rulesAudioPendingWatcherIds: Array.from(pending),
        rulesAudioFinishedWatcherIds: Array.from(finished)
      };
    });

    const next = this.gameStateManager.getGameState(roomCode) || {};
    if ((next.rulesAudioPendingWatcherIds || []).length === 0) {
      this.#enterRoundStart(roomCode);
    }
  }

  submitAnswer(roomCode, { socketId, answer }) {
    const room = this.roomManager.getRoomOrThrow(roomCode);
    if (room.state !== ROOM_STATES.IN_GAME) {
      throw new Error("GAME_NOT_ACTIVE");
    }
    const actor = this.roomManager.getPlayerBySocket(socketId);
    if (!actor || !room.players.has(actor.playerId)) {
      throw new Error("PLAYER_NOT_IN_ROOM");
    }
    const currentState = this.gameStateManager.getGameState(roomCode) || {};
    if (currentState.phase !== GAME_PHASES.ANSWERING) {
      throw new Error("INVALID_STATE_TRANSITION");
    }
    if (!answer || !String(answer).trim()) {
      throw new Error("ANSWER_REQUIRED");
    }

    this.gameStateManager.updateGameState(roomCode, (prevState) => {
      const answersByPlayerId = {
        ...(prevState?.answersByPlayerId || {})
      };
      answersByPlayerId[actor.playerId] = String(answer).trim();

      return {
        ...(prevState || {}),
        answersByPlayerId
      };
    });

    const nextState = this.gameStateManager.getGameState(roomCode) || {};
    const answeredCount = Object.keys(nextState.answersByPlayerId || {}).length;
    if (answeredCount >= room.players.size) {
      this.#enterResultsPhase(roomCode);
    }

    return this.roomManager.getRoomOrThrow(roomCode);
  }

  submitVote(roomCode, { socketId, targetPlayerId }) {
    const room = this.roomManager.getRoomOrThrow(roomCode);
    if (room.state !== ROOM_STATES.RESULTS) {
      throw new Error("GAME_NOT_ACTIVE");
    }
    const voter = this.roomManager.getPlayerBySocket(socketId);
    if (!voter || !room.players.has(voter.playerId)) {
      throw new Error("PLAYER_NOT_IN_ROOM");
    }

    const currentState = this.gameStateManager.getGameState(roomCode) || {};
    if (currentState.phase !== GAME_PHASES.RESULTS) {
      throw new Error("INVALID_STATE_TRANSITION");
    }
    if (!targetPlayerId) {
      throw new Error("TARGET_PLAYER_ID_REQUIRED");
    }
    if (targetPlayerId === voter.playerId) {
      throw new Error("SELF_VOTE_NOT_ALLOWED");
    }
    if (!currentState.answersByPlayerId?.[targetPlayerId]) {
      throw new Error("TARGET_HAS_NO_ANSWER");
    }

    this.gameStateManager.updateGameState(roomCode, (prevState) => {
      const votesByVoterId = {
        ...(prevState?.votesByVoterId || {})
      };
      votesByVoterId[voter.playerId] = targetPlayerId;
      const voteCounts = this.#buildVoteCounts(votesByVoterId);

      return {
        ...(prevState || {}),
        votesByVoterId,
        voteCounts
      };
    });

    const updatedState = this.gameStateManager.getGameState(roomCode) || {};
    const votedCount = Object.keys(updatedState.votesByVoterId || {}).length;
    if (votedCount >= room.players.size) {
      this.#finishCurrentRound(roomCode);
    }

    return this.roomManager.getRoomOrThrow(roomCode);
  }

  finishGame(roomCode) {
    const room = this.roomManager.getRoomOrThrow(roomCode);
    if (room.state !== ROOM_STATES.IN_GAME && room.state !== ROOM_STATES.RESULTS) {
      throw new Error("GAME_NOT_ACTIVE");
    }

    const currentState = this.gameStateManager.getGameState(roomCode);
    const results = this.#buildResults(currentState?.scores || {}, room.players);

    this.roomManager.setRoomState(roomCode, ROOM_STATES.RESULTS);
    this.#clearAnsweringTimer(roomCode);
    this.#clearVotingTimer(roomCode);
    this.#clearRoundStartTimer(roomCode);
    this.#clearNextRoundTimer(roomCode);
    const currentPhase = currentState?.phase || GAME_PHASES.LOBBY;
    if (currentPhase === GAME_PHASES.ROUND_START || currentPhase === GAME_PHASES.ANSWERING) {
      this.#transitionPhase(roomCode, GAME_PHASES.RESULTS, {
        remainingSeconds: 0,
        roundFinishedAt: Date.now(),
        lastRoundResults: results
      });
    }

    this.#transitionPhase(roomCode, GAME_PHASES.GAME_END, {
      finishedAt: Date.now(),
      lastRoundResults: results,
      results
    });
    return this.roomManager.getRoomOrThrow(roomCode);
  }

  cleanupRoom(roomCode) {
    this.#clearAnsweringTimer(roomCode);
    this.#clearVotingTimer(roomCode);
    this.#clearRoundStartTimer(roomCode);
    this.#clearNextRoundTimer(roomCode);
  }

  #enterRoundStart(roomCode, { round, remainingSeconds } = {}) {
    this.#clearRoundStartTimer(roomCode);
    const current = this.gameStateManager.getGameState(roomCode) || {};
    this.#transitionPhase(roomCode, GAME_PHASES.ROUND_START, {
      round: round || current.round || 1,
      roundStartedAt: Date.now(),
      remainingSeconds: remainingSeconds || current.roundDurationSeconds || this.roundDurationSeconds,
      currentQuestion: this.#pickQuestion(round || current.round || 1, current.questions),
      answersByPlayerId: {},
      votesByVoterId: {},
      voteCounts: {},
      votingClosed: false,
      roundWinner: null,
      lastRoundResults: []
    });

    const timeoutId = setTimeout(() => {
      try {
        const room = this.roomManager.getRoomByCode(roomCode);
        if (!room || room.state !== ROOM_STATES.IN_GAME) {
          this.#clearRoundStartTimer(roomCode);
          return;
        }

        const current = this.gameStateManager.getGameState(roomCode);
        if (current?.phase !== GAME_PHASES.ROUND_START) {
          this.#clearRoundStartTimer(roomCode);
          return;
        }
        this.#transitionPhase(roomCode, GAME_PHASES.ANSWERING);
        this.#startAnsweringTimer(roomCode);
      } catch (_error) {
        this.#clearRoundStartTimer(roomCode);
      }
    }, this.roundStartDelaySeconds * 1000);

    this.roundStartTimers.set(roomCode, timeoutId);
  }

  #startAnsweringTimer(roomCode) {
    this.#clearAnsweringTimer(roomCode);
    const intervalId = setInterval(() => {
      try {
        const current = this.gameStateManager.getGameState(roomCode) || {};
        if (current.phase !== GAME_PHASES.ANSWERING) {
          this.#clearAnsweringTimer(roomCode);
          return;
        }
        const nextRemaining = Math.max((current.remainingSeconds ?? 0) - 1, 0);
        this.gameStateManager.updateGameState(roomCode, (prevState) => ({
          ...(prevState || {}),
          remainingSeconds: nextRemaining
        }));
        if (nextRemaining === 0) {
          this.#handleRoundTimeout(roomCode);
        }
      } catch (_error) {
        this.#clearAnsweringTimer(roomCode);
      }
    }, 1000);
    this.answeringTimers.set(roomCode, intervalId);
  }

  #handleRoundTimeout(roomCode) {
    const room = this.roomManager.getRoomByCode(roomCode);
    if (!room || room.state !== ROOM_STATES.IN_GAME) {
      this.#clearAnsweringTimer(roomCode);
      return;
    }

    this.#enterResultsPhase(roomCode);
  }

  #clearAnsweringTimer(roomCode) {
    const timer = this.answeringTimers.get(roomCode);
    if (!timer) {
      return;
    }
    clearInterval(timer);
    this.answeringTimers.delete(roomCode);
  }

  #startVotingTimer(roomCode) {
    this.#clearVotingTimer(roomCode);
    const intervalId = setInterval(() => {
      try {
        const current = this.gameStateManager.getGameState(roomCode) || {};
        if (current.phase !== GAME_PHASES.RESULTS) {
          this.#clearVotingTimer(roomCode);
          return;
        }
        const nextRemaining = Math.max((current.remainingSeconds ?? 0) - 1, 0);
        this.gameStateManager.updateGameState(roomCode, (prevState) => ({
          ...(prevState || {}),
          remainingSeconds: nextRemaining
        }));
        if (nextRemaining === 0) {
          this.#finishCurrentRound(roomCode);
        }
      } catch (_error) {
        this.#clearVotingTimer(roomCode);
      }
    }, 1000);
    this.votingTimers.set(roomCode, intervalId);
  }

  #clearVotingTimer(roomCode) {
    const timer = this.votingTimers.get(roomCode);
    if (!timer) {
      return;
    }
    clearInterval(timer);
    this.votingTimers.delete(roomCode);
  }

  #clearRoundStartTimer(roomCode) {
    const timer = this.roundStartTimers.get(roomCode);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.roundStartTimers.delete(roomCode);
  }

  #finishCurrentRound(roomCode) {
    const room = this.roomManager.getRoomOrThrow(roomCode);
    const currentState = this.gameStateManager.getGameState(roomCode) || {};
    if (currentState.phase !== GAME_PHASES.RESULTS) {
      throw new Error("INVALID_STATE_TRANSITION");
    }
    const roundResults = this.#buildRoundResults(
      currentState.voteCounts || {},
      room.players,
      currentState.answersByPlayerId || {}
    );
    const roundWinner = roundResults[0] || null;
    const revealTotalSeconds = Math.max(roundResults.length, 1) * (currentState.revealAnswerSeconds || this.revealAnswerSeconds);
    const isLastRound = (currentState.round || 1) >= (currentState.totalRounds || this.totalRounds);

    this.#clearAnsweringTimer(roomCode);
    this.#clearVotingTimer(roomCode);
    this.roomManager.setRoomState(roomCode, ROOM_STATES.RESULTS);
    this.gameStateManager.updateGameState(roomCode, (prevState) => ({
      ...(prevState || {}),
      remainingSeconds: 0,
      roundFinishedAt: Date.now(),
      lastRoundResults: roundResults,
      votingClosed: true,
      roundWinner,
      revealTotalSeconds,
      scores: this.#mergeScores(prevState?.scores || {}, prevState?.voteCounts || {})
    }));

    if (isLastRound) {
      this.#transitionPhase(roomCode, GAME_PHASES.GAME_END, {
        finishedAt: Date.now(),
        results: this.#buildResults(
          this.#mergeScores(currentState.scores || {}, currentState.voteCounts || {}),
          room.players
        )
      });
      this.#clearNextRoundTimer(roomCode);
      return;
    }

    this.#scheduleNextRound(roomCode, revealTotalSeconds);
  }

  #scheduleNextRound(roomCode, delaySeconds) {
    this.#clearNextRoundTimer(roomCode);

    const timeoutId = setTimeout(() => {
      try {
        const room = this.roomManager.getRoomByCode(roomCode);
        if (!room || room.state !== ROOM_STATES.RESULTS) {
          this.#clearNextRoundTimer(roomCode);
          return;
        }

        const currentState = this.gameStateManager.getGameState(roomCode) || {};
        if (currentState.phase !== GAME_PHASES.RESULTS) {
          this.#clearNextRoundTimer(roomCode);
          return;
        }
        const nextRound = (currentState.round || 1) + 1;
        this.roomManager.setRoomState(roomCode, ROOM_STATES.IN_GAME);
        this.#clearNextRoundTimer(roomCode);
        this.#enterRoundStart(roomCode, {
          round: nextRound,
          remainingSeconds: currentState.roundDurationSeconds || this.roundDurationSeconds
        });
      } catch (_error) {
        this.#clearNextRoundTimer(roomCode);
      }
    }, delaySeconds * 1000);

    this.nextRoundTimers.set(roomCode, timeoutId);
  }

  #clearNextRoundTimer(roomCode) {
    const timer = this.nextRoundTimers.get(roomCode);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.nextRoundTimers.delete(roomCode);
  }

  #enterResultsPhase(roomCode) {
    const room = this.roomManager.getRoomOrThrow(roomCode);
    const currentState = this.gameStateManager.getGameState(roomCode) || {};
    if (currentState.phase !== GAME_PHASES.ANSWERING) {
      throw new Error("INVALID_STATE_TRANSITION");
    }

    this.#clearAnsweringTimer(roomCode);
    this.roomManager.setRoomState(roomCode, ROOM_STATES.RESULTS);
    this.#transitionPhase(roomCode, GAME_PHASES.RESULTS, {
      remainingSeconds: currentState.votingDurationSeconds || this.votingDurationSeconds,
      answers: this.#serializeAnswers(currentState.answersByPlayerId || {}, room.players),
      votesByVoterId: {},
      voteCounts: {},
      votingClosed: false,
      roundWinner: null,
      revealTotalSeconds: null
    });
    this.#startVotingTimer(roomCode);
  }

  #transitionPhase(roomCode, nextPhase, patch = {}) {
    const current = this.gameStateManager.getGameState(roomCode) || {};
    const currentPhase = current.phase || GAME_PHASES.LOBBY;
    this.#assertTransition(currentPhase, nextPhase);

    this.gameStateManager.updateGameState(roomCode, (prevState) => ({
      ...(prevState || {}),
      phase: nextPhase,
      ...patch
    }));
  }

  #assertTransition(fromPhase, toPhase) {
    const allowed = GAME_PHASE_TRANSITIONS[fromPhase] || [];
    if (!allowed.includes(toPhase)) {
      throw new Error("INVALID_STATE_TRANSITION");
    }
  }

  #buildResults(scores, players) {
    return Object.entries(scores)
      .map(([playerId, score]) => ({
        playerId,
        socketId: players.get(playerId)?.socketId || null,
        name: players.get(playerId)?.name || "unknown",
        score
      }))
      .sort((a, b) => b.score - a.score);
  }

  #buildRoundResults(voteCounts, players, answersByPlayerId) {
    return Array.from(players.values())
      .filter((player) => Boolean(answersByPlayerId[player.playerId]))
      .map((player) => ({
        playerId: player.playerId,
        socketId: player.socketId || null,
        name: player.name || "unknown",
        answer: answersByPlayerId[player.playerId],
        votes: voteCounts[player.playerId] || 0
      }))
      .sort((a, b) => b.votes - a.votes);
  }

  #buildVoteCounts(votesByVoterId) {
    const output = {};
    for (const targetPlayerId of Object.values(votesByVoterId)) {
      output[targetPlayerId] = (output[targetPlayerId] || 0) + 1;
    }
    return output;
  }

  #mergeScores(scores, voteCounts) {
    const nextScores = { ...scores };
    for (const [playerId, votes] of Object.entries(voteCounts)) {
      nextScores[playerId] = (nextScores[playerId] || 0) + votes;
    }
    return nextScores;
  }

  #serializeAnswers(answersByPlayerId, players) {
    return Object.entries(answersByPlayerId).map(([playerId, answer]) => ({
      playerId,
      name: players.get(playerId)?.name || "unknown",
      answer
    }));
  }

  #pickQuestion(round, questionsList) {
    const list = Array.isArray(questionsList) && questionsList.length > 0 ? questionsList : this.questions;
    if (!list.length) {
      return "Question";
    }
    const index = (round - 1) % list.length;
    return list[index];
  }
}

module.exports = {
  GameEngine
};
