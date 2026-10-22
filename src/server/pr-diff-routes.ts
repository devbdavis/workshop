import { Router } from 'express';
import type { TodoId } from '@foundation/types';
import type { TodoRepository } from '@domain/todo/repository';
import type { ForgeAdapter } from '@infrastructure/forge/forge-adapter';

export interface PrDiffRouterDeps {
  todos: Pick<TodoRepository, 'findById'>;
  forge: Pick<ForgeAdapter, 'fetchPrDiff'>;
}

/** Diff of a PR linked to a todo; the URL must match a stored one so the client can't make us fetch arbitrary PRs. */
export function createPrDiffRouter({ todos, forge }: PrDiffRouterDeps): Router {
  const router = Router();

  router.get('/todos/:todoId/pr-diff', async (req, res) => {
    const { prUrl } = req.query;
    if (typeof prUrl !== 'string' || !prUrl) {
      res.status(400).json({ error: 'prUrl is required' });
      return;
    }
    const todo = todos.findById(req.params.todoId as TodoId);
    if (!todo?.pullRequests?.some((p) => p.url === prUrl)) {
      res.status(404).json({ error: 'No such pull request on this todo' });
      return;
    }
    try {
      res.json({ diff: await forge.fetchPrDiff(prUrl) });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to fetch PR diff' });
    }
  });

  return router;
}
