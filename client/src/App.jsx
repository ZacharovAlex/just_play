import React, { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = "http://localhost:3000";

function getPlayerId() {
  const key = "just-play-player-id";
  const existing = localStorage.getItem(key);
  if (existing) {
    return existing;
  }
  const generated = `p_${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(key, generated);
  return generated;
}

export function App() {
  const mode = getModeFromPath(window.location.pathname);
  const [playerName, setPlayerName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [answer, setAnswer] = useState("");
  const [voteTarget, setVoteTarget] = useState("");
  const [roomState, setRoomState] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [error, setError] = useState("");
  const [screenVersion, setScreenVersion] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [answerSubmitted, setAnswerSubmitted] = useState(false);
  const [voteSubmitted, setVoteSubmitted] = useState(false);
  const [tvTableCount, setTvTableCount] = useState(0);
  const [games, setGames] = useState([]);
  const [selectedGameId, setSelectedGameId] = useState("humorist");

  const playerId = useMemo(() => getPlayerId(), []);
  const socket = useMemo(() => io(SOCKET_URL, { autoConnect: true }), []);

  useEffect(() => {
    // Force a connection attempt to backend Socket.IO.
    socket.connect();
    // eslint-disable-next-line no-console
    console.log("[socket] target", SOCKET_URL, "connected?", socket.connected);

    const onConnect = () => {
      // eslint-disable-next-line no-console
      console.log("[socket] connect", socket.id);
      setIsConnected(true);
    };
    const onDisconnect = (reason) => {
      // eslint-disable-next-line no-console
      console.log("[socket] disconnect", reason);
      setIsConnected(false);
    };
    const onConnectError = (err) => {
      // eslint-disable-next-line no-console
      console.log("[socket] connect_error", err?.message || err);
      setIsConnected(false);
    };

    const onRoomState = (payload) => {
      // eslint-disable-next-line no-console
      console.log("[socket] room:state", payload);
      setRoomState(payload);
    };
    const onGameState = (payload) => {
      // eslint-disable-next-line no-console
      console.log("[socket] game:state", payload);
      setGameState(payload);
    };
    const onRoomError = (payload) => {
      // eslint-disable-next-line no-console
      console.log("[socket] room:error", payload);
      setError(payload?.message || "Unknown error");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("room:state", onRoomState);
    socket.on("game:state", onGameState);
    socket.on("room:error", onRoomError);

    if (socket.connected) {
      setIsConnected(true);
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("room:state", onRoomState);
      socket.off("game:state", onGameState);
      socket.off("room:error", onRoomError);
      socket.disconnect();
    };
  }, [socket]);

  useEffect(() => {
    setScreenVersion((v) => v + 1);
    setAnswerSubmitted(false);
    setVoteSubmitted(false);
  }, [gameState?.screen]);

  useEffect(() => {
    if (mode !== "tv" || gameState?.screen !== "results" || !gameState?.votesRevealed) {
      setTvTableCount(0);
      return;
    }

    const items = buildTvRevealOrder(gameState.roundResults || []);
    if (items.length === 0) {
      setTvTableCount(0);
      return;
    }

    setTvTableCount(1);
    const stepMs = (gameState.revealAnswerSeconds || 5) * 1000;
    const intervalId = setInterval(() => {
      setTvTableCount((prev) => {
        const next = prev + 1;
        if (next >= items.length) {
          clearInterval(intervalId);
        }
        return Math.min(next, items.length);
      });
    }, stepMs);

    return () => clearInterval(intervalId);
  }, [mode, gameState?.screen, gameState?.votesRevealed, gameState?.round, gameState?.revealAnswerSeconds, gameState?.roundResults]);

  useEffect(() => {
    fetch(`${SOCKET_URL}/games`)
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data?.games) ? data.games : [];
        setGames(list);
        if (list.length > 0) {
          setSelectedGameId(list[0].id);
        }
      })
      .catch(() => {
        setGames([{ id: "humorist", title: "Юморист" }]);
      });
  }, []);

  const onJoin = () => {
    setError("");
    // eslint-disable-next-line no-console
    console.log("[socket] emit room:join", {
      roomCode: roomCode.trim().toUpperCase(),
      playerName: playerName.trim(),
      playerId
    });
    socket.emit("room:join", {
      roomCode: roomCode.trim().toUpperCase(),
      playerName: playerName.trim(),
      playerId
    });
  };

  const onCreateRoom = () => {
    setError("");
    // eslint-disable-next-line no-console
    console.log("[socket] emit room:create", {
      hostName: playerName.trim(),
      playerId,
      gameId: selectedGameId
    });
    socket.emit("room:create", {
      hostName: playerName.trim(),
      playerId,
      gameId: selectedGameId
    });
  };

  const onWatch = () => {
    setError("");
    // eslint-disable-next-line no-console
    console.log("[socket] emit room:watch", {
      roomCode: roomCode.trim().toUpperCase()
    });
    socket.emit("room:watch", {
      roomCode: roomCode.trim().toUpperCase()
    });
  };

  const onSubmitAnswer = () => {
    setError("");
    // eslint-disable-next-line no-console
    console.log("[socket] emit game:submit_answer", { answer });
    socket.emit("game:submit_answer", { answer });
    setAnswerSubmitted(true);
    setAnswer("");
  };

  const onSubmitVote = () => {
    setError("");
    // eslint-disable-next-line no-console
    console.log("[socket] emit game:submit_vote", { targetPlayerId: voteTarget });
    socket.emit("game:submit_vote", { targetPlayerId: voteTarget });
    setVoteSubmitted(true);
  };

  const onStartGame = () => {
    setError("");
    // eslint-disable-next-line no-console
    console.log("[socket] emit game:start");
    socket.emit("game:start");
  };

  const onFinishGame = () => {
    setError("");
    // eslint-disable-next-line no-console
    console.log("[socket] emit game:finish");
    socket.emit("game:finish");
  };

  const onRulesAudioFinished = () => {
    setError("");
    socket.emit("game:rules_audio_finished");
  };

  const screenLabel = getScreenLabel(gameState?.screen);
  const timeValue = gameState?.remainingSeconds;
  const timeTotal =
    gameState?.screen === "results"
      ? 30
      : gameState?.screen === "answering"
        ? 60
        : gameState?.countdownSeconds || 0;
  const progressPercent =
    typeof timeValue === "number" && timeTotal > 0 ? Math.max((timeValue / timeTotal) * 100, 0) : 0;
  const me = (roomState?.players || []).find((p) => p.playerId === playerId);
  const isHost = Boolean(me?.isHost);
  const canStartGame = isHost && (roomState?.players?.length || 0) >= 3;
  const answerProgress = gameState?.progress;
  const voteProgress = gameState?.voteProgress;

  return (
    <main className="page">
      <header className="hero">
        <h1>Just Play</h1>
        <p className="subtitle">
          Realtime party game · mode: <strong>{mode === "tv" ? "TV" : "Player"}</strong>
        </p>
        <p className="subtitle">Socket: {isConnected ? "connected" : "disconnected"}</p>
        <div className="modeSwitch">
          <a href="/play">Player mode</a>
          <a href="/tv">TV mode</a>
        </div>
      </header>

      {mode === "play" && !roomState && (
        <section className="card enter">
          <h2>Join room</h2>
          <input
            placeholder="Your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
          />
          <input
            placeholder="Room code"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
          />
          <button onClick={onJoin} disabled={!playerName.trim() || !roomCode.trim()}>
            Join
          </button>
          <select value={selectedGameId} onChange={(e) => setSelectedGameId(e.target.value)}>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
          <button onClick={onCreateRoom} disabled={!playerName.trim()}>
            Create test room
          </button>
        </section>
      )}

      {mode === "tv" && !roomState && (
        <section className="card enter">
          <h2>Connect TV to room</h2>
          <input
            placeholder="Room code"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
          />
          <button onClick={onWatch} disabled={!roomCode.trim()}>
            Connect TV
          </button>
        </section>
      )}

      {roomState && (
        <section className="card status">
          <div className="row">
            <strong>Room</strong>
            <span>{roomState.code}</span>
          </div>
          <div className="row">
            <strong>Join code</strong>
            <span>{roomState.code}</span>
          </div>
          {roomState.gameTitle && (
            <div className="row">
              <strong>Game</strong>
              <span>{roomState.gameTitle}</span>
            </div>
          )}
          {mode === "play" && (
            <div className="row">
              <strong>Role</strong>
              <span>{isHost ? "Host" : "Player"}</span>
            </div>
          )}
          <div className="row">
            <strong>Players</strong>
            <span>{roomState.players?.length || 0}</span>
          </div>
          <div className="row">
            <strong>Stage</strong>
            <span>{screenLabel}</span>
          </div>
          <div className="row">
            <strong>Round</strong>
            <span>
              {gameState?.round || "-"} / {gameState?.totalRounds || "-"}
            </span>
          </div>
          {typeof timeValue === "number" && (
            <>
              <div className="timer">
                <div className="timerHead">
                  <strong>Time left</strong>
                  <span>{timeValue}s</span>
                </div>
                <div className="bar">
                  <div className="barFill" style={{ width: `${progressPercent}%` }} />
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {mode === "play" && roomState && isHost && (
        <section className="card">
          <h2>Host controls</h2>
          <p>To start the game you need at least 3 players.</p>
          <div className="row">
            <button onClick={onStartGame} disabled={!canStartGame}>
              Start game
            </button>
            <button onClick={onFinishGame}>Finish game</button>
          </div>
        </section>
      )}

      {mode === "play" && gameState?.screen === "answering" && (
        <section className="card screen" key={`answering-${screenVersion}`}>
          <h2>Question</h2>
          <p className="question">{gameState.question}</p>
          <input
            placeholder="Your answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <button onClick={onSubmitAnswer} disabled={!answer.trim()}>
            {answerSubmitted ? "Update answer" : "Send answer"}
          </button>
          {answerSubmitted && (
            <p className="waitingText">
              Вы ответили. Можно отправить новый ответ, пока идет время или пока не ответит последний игрок.
            </p>
          )}
          {answerProgress?.answered < answerProgress?.totalPlayers && (
            <p className="waitingText">
              Ожидаем других игроков ({answerProgress?.answered || 0}/{answerProgress?.totalPlayers || 0})
            </p>
          )}
        </section>
      )}

      {mode === "tv" && gameState?.screen === "answering" && (
        <section className="card screen" key={`tv-answering-${screenVersion}`}>
          <h2>Question</h2>
          <p className="question">{gameState.question}</p>
          {answerProgress?.answered < answerProgress?.totalPlayers && (
            <p className="waitingText">
              Waiting for {answerProgress.totalPlayers - answerProgress.answered} players to answer
            </p>
          )}
        </section>
      )}

      {mode === "tv" && gameState?.screen === "rules_audio" && (
        <section className="card screen" key={`tv-rules-${screenVersion}`}>
          <h2>Правила игры</h2>
          <p className="waitingText">
            Сначала прослушайте правила. После завершения на всех экранах TV игра начнется автоматически.
          </p>
          {gameState.rulesAudioUrl ? (
            <audio
              key={gameState.rulesAudioUrl}
              controls
              autoPlay
              onEnded={onRulesAudioFinished}
              src={gameState.rulesAudioUrl}
            />
          ) : (
            <p className="waitingText">Аудио не настроено, можно продолжить вручную.</p>
          )}
          <div className="row">
            <span>
              TV confirmed: {gameState.rulesAudioProgress?.finished || 0}/{gameState.rulesAudioProgress?.total || 0}
            </span>
          </div>
          <button onClick={onRulesAudioFinished}>Я прослушал, продолжить</button>
        </section>
      )}

      {mode === "play" && gameState?.screen === "results" && (
        <section className="card screen" key={`results-${screenVersion}`}>
          <h2>Voting</h2>
          <p className="question">{gameState.roundQuestion}</p>
          <div className="voteList">
          {(gameState.answers || [])
            .filter((a) => a.playerId !== playerId)
            .map((a) => (
              <label className="answerCard voteRow" key={a.playerId}>
                <input
                  className="voteRadio"
                  type="radio"
                  name="vote"
                  value={a.playerId}
                  checked={voteTarget === a.playerId}
                  onChange={(e) => setVoteTarget(e.target.value)}
                />
                <div className="voteContent">
                  {a.name && <strong className="voteName">{a.name}</strong>}
                  <span className="voteAnswer">{a.answer}</span>
                  {/* Vote counts are intentionally hidden on player screen */}
                </div>
              </label>
            ))}
          </div>
          <button onClick={onSubmitVote} disabled={!voteTarget}>
            {voteSubmitted ? "Update vote" : "Submit vote"}
          </button>
          {voteSubmitted && (
            <p className="waitingText">
              Вы проголосовали. Можно изменить выбор, пока идет время или пока не проголосует последний игрок.
            </p>
          )}
          {voteProgress?.voted < voteProgress?.totalPlayers && (
            <p className="waitingText">
              Ожидаем других игроков ({voteProgress?.voted || 0}/{voteProgress?.totalPlayers || 0})
            </p>
          )}
        </section>
      )}

      {mode === "tv" && gameState?.screen === "results" && (
        <section className="card screen" key={`tv-results-${screenVersion}`}>
          <h2>Round summary</h2>
          <p className="question">{gameState.roundQuestion}</p>

          {/* During voting on TV: do not show answer options */}

          {!gameState.votesRevealed && voteProgress?.voted < voteProgress?.totalPlayers && (
            <p className="waitingText">
              Waiting for {voteProgress.totalPlayers - voteProgress.voted} players to vote
            </p>
          )}

          {gameState.votesRevealed && (gameState.roundResults || []).length > 0 && (
            <div className="tvRevealWrap">
              {(() => {
                const revealOrder = buildTvRevealOrder(gameState.roundResults || []);
                const visibleIds = new Set(revealOrder.slice(0, tvTableCount).map((p) => p.playerId));
                const visibleRows = (gameState.roundResults || [])
                  .filter((p) => visibleIds.has(p.playerId))
                  .sort((a, b) => a.rank - b.rank);
                return visibleRows.map((p) => (
                  <div className={`leaderRow tvRowReveal ${getTvRowSizeClass(p.rank)}`} key={`round-result-${p.playerId}`}>
                  <span>#{p.rank}</span>
                  <span>{p.name}</span>
                  <strong>{p.votes}</strong>
                  <span>{p.answer}</span>
                </div>
                ));
              })()}
            </div>
          )}

          {gameState.votesRevealed && gameState.roundWinner && tvTableCount >= (gameState.roundResults || []).length && (
            <div className="winnerBanner">
              Best answer: <strong>{gameState.roundWinner.name}</strong>
            </div>
          )}
          {gameState.votesRevealed && (
            <p className="waitingText">Next round starts in about {gameState.nextRoundInSeconds || 15} seconds</p>
          )}
        </section>
      )}

      {gameState?.screen === "game_end" && (
        <section className="card screen" key={`game_end-${screenVersion}`}>
          <h2>Final leaderboard</h2>
          {(gameState.leaderboard || []).map((p, idx) => (
            <div className="leaderRow" key={p.playerId}>
              <span>#{p.rank}</span>
              <span>{p.name}</span>
              <strong>{p.score}</strong>
              {idx === 0 && <span className="winner">Winner</span>}
            </div>
          ))}
        </section>
      )}

      {gameState?.screen === "round_start" && (
        <section className="card screen" key={`round_start-${screenVersion}`}>
          <h2>Get ready</h2>
          <p className="question">{gameState.question}</p>
          <div className="countdown">{gameState.countdownSeconds || 0}</div>
        </section>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  );
}

function getModeFromPath(pathname) {
  if (pathname === "/tv") {
    return "tv";
  }
  return "play";
}

function getScreenLabel(screen) {
  if (screen === "round_start") {
    return "Question";
  }
  if (screen === "answering") {
    return "Answer";
  }
  if (screen === "results") {
    return "Results";
  }
  if (screen === "game_end") {
    return "Game End";
  }
  return "Waiting";
}

function buildTvRevealOrder(results) {
  if (!results || results.length === 0) {
    return [];
  }

  const first = results[0];
  const second = results[1];
  const third = results[2];
  const rest = results.slice(3);
  return [third, second, first, ...rest].filter(Boolean);
}

function getTvRowSizeClass(rank) {
  if (rank === 1) {
    return "tvRowSize-1";
  }
  if (rank === 2) {
    return "tvRowSize-2";
  }
  if (rank === 3) {
    return "tvRowSize-3";
  }
  return "tvRowSize-4";
}
