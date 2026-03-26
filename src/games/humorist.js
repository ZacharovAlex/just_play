const humoristGame = {
  id: "humorist",
  title: "Юморист",
  description: "Игроки придумывают смешные ответы и голосуют за лучший.",
  config: {
    totalRounds: 5,
    roundStartDelaySeconds: 2,
    roundDurationSeconds: 60,
    votingDurationSeconds: 30,
    revealAnswerSeconds: 5,
    rulesAudioUrl: "/audio/humorist-rules.mp3"
  },
  questions: [
    "Какая суперсила идеально подходит для скучного офиса?",
    "Худшее имя для домашнего дракона?",
    "Что инопланетяне неправильно поймут в людях в первую очередь?",
    "Что точно нельзя говорить на первом свидании?",
    "Самый неудачный вкус мороженого?"
  ]
};

module.exports = {
  humoristGame
};
