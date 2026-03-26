# Minimal React Client

## Run

```bash
cd client
npm install
npm run dev
```

Backend is expected on `http://localhost:3000`.

## Features

- Socket.IO connection
- `/play`: join room by code + player name, submit answer, submit vote
- `/tv`: connect to room as screen (`room:watch`) without joining as player
- React to `game:state` updates
