import 'dotenv/config';
import http from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { initSocket } from './sockets/queueSocket.js';
import { corsOrigins } from './config/cors.js';

const PORT = Number(process.env.PORT) || 8080;
// Bind all interfaces so container/host networking works. Most hosts inject PORT.
const HOST = process.env.HOST || '0.0.0.0';

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, {
  serveClient: false, // we don't serve the socket.io client bundle
  pingTimeout: 20000,
  pingInterval: 25000,
  connectTimeout: 10000,
  cors: {
    origin: corsOrigins(),
    methods: ['GET', 'POST'],
    credentials: false,
  },
});

app.set('io', io);
initSocket(io);

if (process.env.VERCEL !== '1') {
  server.listen(PORT, HOST, () => {
    console.log(`\n  KIMS Queue backend listening on ${HOST}:${PORT}`);
    console.log(`  Health check: GET /health\n`);
  });
}

export { app, server, io };
export default server;