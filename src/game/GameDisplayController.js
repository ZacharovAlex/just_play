const { GAME_PHASES } = require("../core/constants");

class GameDisplayController {
  toTvView({ room, gameState }) {
    if (!room || !gameState) {
      return {
        screen: "idle",
        title: "Waiting for game"
      };
    }

    const base = {
      roomCode: room.code,
      round: gameState.round || 1,
      totalRounds: gameState.totalRounds || 1,
      phase: gameState.phase
    };

    switch (gameState.phase) {
      case GAME_PHASES.RULES_AUDIO:
        return {
          ...base,
          screen: "rules_audio",
          title: "Listen to game rules",
          rulesAudioUrl: gameState.rulesAudioUrl || null,
          rulesAudioProgress: {
            finished: (gameState.rulesAudioFinishedWatcherIds || []).length,
            total: (gameState.rulesAudioPendingWatcherIds || []).length
          }
        };

      case GAME_PHASES.ROUND_START:
        return {
          ...base,
          screen: "round_start",
          title: `Round ${base.round} of ${base.totalRounds}`,
          question: gameState.currentQuestion || "",
          countdownSeconds: gameState.roundStartDelaySeconds || 0
        };

      case GAME_PHASES.ANSWERING:
        return {
          ...base,
          screen: "answering",
          title: "Submit your answer",
          question: gameState.currentQuestion || "",
          remainingSeconds: gameState.remainingSeconds || 0,
          progress: {
            answered: Object.keys(gameState.answersByPlayerId || {}).length,
            totalPlayers: room.players.size
          }
        };

      case GAME_PHASES.RESULTS:
        {
          const votesRevealed = Boolean(gameState.votingClosed);
          const voted = Object.keys(gameState.votesByVoterId || {}).length;
          return {
            ...base,
            screen: "results",
            title: "Vote for the best answer",
            remainingSeconds: gameState.remainingSeconds || 0,
            roundQuestion: gameState.currentQuestion || "",
            votesRevealed,
            voteProgress: {
              voted,
              totalPlayers: room.players.size
            },
            revealAnswerSeconds: gameState.revealAnswerSeconds || 5,
            nextRoundInSeconds: votesRevealed ? gameState.revealTotalSeconds || null : null,
            roundWinner: gameState.roundWinner
              ? {
                  playerId: gameState.roundWinner.playerId,
                  name: gameState.roundWinner.name,
                  votes: gameState.roundWinner.votes
                }
              : null,
            roundResults: (gameState.lastRoundResults || []).map((item, index) => ({
              rank: index + 1,
              playerId: item.playerId,
              name: item.name,
              answer: item.answer,
              votes: item.votes
            })),
            answers: (gameState.answers || []).map((item) => ({
              playerId: item.playerId,
              name: votesRevealed ? item.name : null,
              answer: item.answer,
              votes: votesRevealed ? gameState.voteCounts?.[item.playerId] || 0 : null
            }))
          };
        }

      case GAME_PHASES.GAME_END:
        return {
          ...base,
          screen: "game_end",
          title: "Final results",
          leaderboard: (gameState.results || []).map((item, index) => ({
            rank: index + 1,
            playerId: item.playerId,
            name: item.name,
            score: item.score
          }))
        };

      case GAME_PHASES.LOBBY:
      default:
        return {
          ...base,
          screen: "lobby",
          title: "Game is starting"
        };
    }
  }
}

module.exports = {
  GameDisplayController
};
