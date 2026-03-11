import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApiRouter } from './api.js';
import { setupWebSocket } from './websocket.js';
import { closeDatabase } from '@infrastructure/persistence/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3001', 10);
const isProduction = process.env.NODE_ENV === 'production';

const app = express();
app.use(express.json());

// API routes
app.use('/api', createApiRouter());

// Serve static files in production
if (isProduction) {
  const clientDir = path.resolve(__dirname, '../../dist/client');
  app.use(express.static(clientDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

const server = createServer(app);

// WebSocket for terminal sessions
setupWebSocket(server);

server.listen(PORT, () => {
  console.log(`Workshop server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  closeDatabase();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDatabase();
  server.close();
  process.exit(0);
});
