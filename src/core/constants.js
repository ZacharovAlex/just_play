const ROOM_STATES = Object.freeze({
  LOBBY: "lobby",
  IN_GAME: "in_game",
  RESULTS: "results"
});

const GAME_PHASES = Object.freeze({
  LOBBY: "lobby",
  RULES_AUDIO: "rules_audio",
  ROUND_START: "round_start",
  ANSWERING: "answering",
  RESULTS: "results",
  GAME_END: "game_end"
});

const GAME_PHASE_TRANSITIONS = Object.freeze({
  [GAME_PHASES.LOBBY]: [GAME_PHASES.RULES_AUDIO, GAME_PHASES.ROUND_START],
  [GAME_PHASES.RULES_AUDIO]: [GAME_PHASES.ROUND_START],
  [GAME_PHASES.ROUND_START]: [GAME_PHASES.ANSWERING],
  [GAME_PHASES.ANSWERING]: [GAME_PHASES.RESULTS],
  [GAME_PHASES.RESULTS]: [GAME_PHASES.ROUND_START, GAME_PHASES.GAME_END],
  [GAME_PHASES.GAME_END]: []
});

const SOCKET_EVENTS = Object.freeze({
  CONNECTION: "connection",
  DISCONNECT: "disconnect",
  ERROR: "error",

  ROOM_CREATE: "room:create",
  ROOM_JOIN: "room:join",
  ROOM_WATCH: "room:watch",
  ROOM_LEAVE: "room:leave",
  ROOM_STATE: "room:state",
  ROOM_ERROR: "room:error",
  ROOM_PLAYER_JOINED: "room:player_joined",
  ROOM_PLAYER_RECONNECTED: "room:player_reconnected",
  ROOM_PLAYER_DISCONNECTED: "room:player_disconnected",
  ROOM_PLAYER_LEFT: "room:player_left",
  ROOM_HOST_CHANGED: "room:host_changed",

  GAME_START: "game:start",
  GAME_FINISH: "game:finish",
  GAME_ACTION: "game:action",
  GAME_SUBMIT_ANSWER: "game:submit_answer",
  GAME_SUBMIT_VOTE: "game:submit_vote",
  GAME_RULES_AUDIO_FINISHED: "game:rules_audio_finished",
  GAME_STATE: "game:state"
});

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;

module.exports = {
  ROOM_STATES,
  GAME_PHASES,
  GAME_PHASE_TRANSITIONS,
  SOCKET_EVENTS,
  CODE_ALPHABET,
  ROOM_CODE_LENGTH
};
