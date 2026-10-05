/** /hooks/activity — Claude Code hook callback reporting working/idle/needs-input instantly. */
import { Router } from 'express';
import type { SessionId } from '@foundation/types';
import type { TerminalManager } from '@infrastructure/terminal/manager.js';
import { broadcast } from './events.js';

const STATUSES = ['working', 'idle', 'needs-input'] as const;

export function createActivityHookRouter(deps: { terminal: TerminalManager }): Router {
  const router = Router();

  router.post('/hooks/activity', (req, res) => {
    try {
      const sessionId = req.headers['x-workshop-session'];
      const status = req.body?.status;
      if (typeof sessionId !== 'string' || !STATUSES.includes(status)) {
        res.json({});
        return;
      }
      const result = deps.terminal.reportHookActivity(sessionId as SessionId, status);
      if (result?.changed) {
        broadcast('session:updated', result.trackId);
        const payload = { sessionId, sessionName: result.sessionName };
        if (status === 'idle') broadcast('session:idle-alert', result.trackId, payload);
        if (status === 'needs-input') broadcast('session:needs-input', result.trackId, payload);
      }
      res.json({});
    } catch (err) {
      console.error('[activity-hook] failed:', err);
      res.json({});
    }
  });

  return router;
}
