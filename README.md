# Realtime Party Game Backend

Scalable backend architecture for a real-time party game using Node.js and Socket.IO.

## Modules

- `src/rooms/RoomManager.js` - room lifecycle, unique room codes, host ownership, player membership.
- `src/sockets/registerSocketHandlers.js` - transport layer: validates socket events, orchestrates room/game actions, broadcasts updates.
- `src/game/GameEngine.js` - game domain logic and state transitions (`lobby` -> `in_game` -> `results`).
- `src/game/GameStateManager.js` - single source of truth for `gameState` per room, immutable updates via `updateGameState()`.
- `src/core/constants.js` - shared events and enums.
- `src/app.js` - dependency wiring and server bootstrap.
- `src/server.js` - runtime entrypoint.

## Start

```bash
npm install
npm run dev
```

## Socket Events

Client -> Server:
- `room:create` `{ hostName, playerId }`
- `room:join` `{ roomCode, playerName, playerId }`
- `room:leave`
- `game:start` (host only)
- `game:submit_answer` `{ answer }`
- `game:submit_vote` `{ targetPlayerId }`
- `game:action` `{ answer }` (legacy alias for submit answer)
- `game:finish` (host only)

Server -> Client:
- `room:state`
- `room:error`
- `room:player_joined`
- `room:player_reconnected`
- `room:player_disconnected`
- `room:player_left`
- `room:host_changed`
- `game:state`

`game:state` now includes round timer fields (`roundDurationSeconds`, `remainingSeconds`) and is sent every second while a round is active.
It also includes round progression fields (`round`, `totalRounds`, `phase`, `lastRoundResults`) for multi-round flow.
`phase` now follows a strict finite-state model: `lobby -> round_start -> answering -> results -> (round_start | game_end)`.
For the Q&A game flow, state also contains `currentQuestion`, `answersByPlayerId`, `answers`, `votesByVoterId`, and `voteCounts`.
`game:state` is emitted as a TV-ready view model (not raw internal game state).

Reconnect flow: on disconnect, player stays in room as temporarily disconnected for 30 seconds (in-memory session store). If they reconnect with the same `playerId` within TTL, their room session is restored.

## Scalability Notes

1. Keep business logic out of transport:
   - Socket handlers only parse, validate, and orchestrate.
   - Room/game modules stay framework-agnostic.
2. Keep game state mutations centralized:
   - All game-state mutations go through `GameStateManager.updateGameState()`.
   - State is cloned/frozen to prevent direct mutation side effects.
3. Replace in-memory storage behind `RoomManager` with Redis/PostgreSQL without changing handlers.
4. For horizontal scaling, add Socket.IO Redis adapter and route room state via shared storage/pub-sub.
5. Add schema validation (Zod/Joi) and auth middleware for production.
