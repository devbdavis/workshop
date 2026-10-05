import { Router } from 'express';
import type { TodoId } from '@foundation/types';
import type { PrMonitorRepository } from '@domain/pr-monitor/repository';
import type { ForgeAdapter } from '@infrastructure/forge/forge-adapter';

export interface PrCheckLogRouterDeps {
  monitors: PrMonitorRepository;
  forge: Pick<ForgeAdapter, 'fetchCheckLog'>;
}

/**
 * Tail of a failing check's job log, looked up by check name on the stored
 * monitor so the client never hands us a URL to fetch.
 */
export function createPrCheckLogRouter({ monitors, forge }: PrCheckLogRouterDeps): Router {
  const router = Router();

  router.get('/todos/:todoId/pr-monitors/check-log', async (req, res) => {
    const { prUrl, check } = req.query;
    if (typeof prUrl !== 'string' || typeof check !== 'string') {
      res.status(400).json({ error: 'prUrl and check are required' });
      return;
    }
    const monitor = monitors.findByTodo(req.params.todoId as TodoId).find((m) => m.prUrl === prUrl);
    const detailsUrl = monitor?.failingChecks.find((c) => c.name === check)?.detailsUrl;
    if (!detailsUrl) {
      res.status(404).json({ error: 'No failing check with a details link by that name' });
      return;
    }
    try {
      res.json({ log: await forge.fetchCheckLog(prUrl, detailsUrl) });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to fetch check log' });
    }
  });

  return router;
}
