const { humoristGame } = require("./humorist");

const games = [humoristGame];
const gamesById = new Map(games.map((g) => [g.id, g]));

function listGames() {
  return games.map((g) => ({
    id: g.id,
    title: g.title,
    description: g.description,
    config: g.config
  }));
}

function getGameById(gameId) {
  return gamesById.get(gameId) || null;
}

module.exports = {
  listGames,
  getGameById
};
