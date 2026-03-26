require("dotenv").config();

const { createApp } = require("./app");

const PORT = Number(process.env.PORT || 3000);
const { server } = createApp();

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Realtime game backend listening on port ${PORT}`);
});
