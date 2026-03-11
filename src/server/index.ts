import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApiRouter } from './api.js';
import { setupWebSocket } from './websocket.js';
import { closeDatabase } from '@infrastructure/persistence/database.js';
import { createAutomationRuleRepository, createAutomationRunRepository } from '@infrastructure/persistence/automation-repository.js';
import { createAutomationEngine } from '@application/automation-engine/engine.js';
import { registerActionHandlers } from '@application/automation-engine/action-handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3001', 10);
const isProduction = process.env.NODE_ENV === 'production';

// Automation engine setup
const automationRuleRepo = createAutomationRuleRepository();
const automationRunRepo = createAutomationRunRepository();
const automationEngine = createAutomationEngine(automationRuleRepo, automationRunRepo);
registerActionHandlers(automationEngine);
automationEngine.start();

const app = express();
app.use(express.json());

// API routes
app.use('/api', createApiRouter({ automationEngine }));

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
  automationEngine.stop();
  closeDatabase();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  automationEngine.stop();
  closeDatabase();
  server.close();
  process.exit(0);
});
