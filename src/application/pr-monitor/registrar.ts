import type { PrMonitorRepository } from '@domain/pr-monitor/repository';
import { parsePrUrl } from '@infrastructure/github/gh-adapter.js';
import type { PullRequest, Todo } from '@foundation/types';

export interface PrMonitorRegistrar {
  /**
   * Reconcile monitor rows against the current `pullRequests` list on a todo.
   * - New PR URLs are registered.
   * - Stale URLs (removed from the todo) are unregistered.
   * Returns the URLs that were added / removed for logging.
   */
  reconcile(todo: Todo): { added: string[]; removed: string[] };
  /** Removes every monitor row pointing at this todo (used when a todo is deleted). */
  removeAllForTodo(todoId: string): number;
}

export function createPrMonitorRegistrar(monitors: PrMonitorRepository): PrMonitorRegistrar {
  return {
    reconcile(todo: Todo): { added: string[]; removed: string[] } {
      const desired = new Set<string>();
      const desiredByUrl = new Map<string, PullRequest>();
      for (const pr of todo.pullRequests ?? []) {
        if (!pr.url) continue;
        const parsed = parsePrUrl(pr.url);
        if (!parsed) continue;
        desired.add(pr.url);
        desiredByUrl.set(pr.url, pr);
      }

      const existing = monitors.findByTodo(todo.id);
      const existingUrls = new Set(existing.map((m) => m.prUrl));

      const added: string[] = [];
      const removed: string[] = [];

      for (const url of desired) {
        if (existingUrls.has(url)) continue;
        const parsed = parsePrUrl(url)!;
        const pr = desiredByUrl.get(url);
        monitors.register({
          prUrl: url,
          todoId: todo.id,
          trackId: todo.trackId,
          repoOwner: parsed.owner,
          repoName: parsed.repo,
          prNumber: parsed.number,
          prTitle: pr?.title,
        });
        added.push(url);
      }

      for (const monitor of existing) {
        if (desired.has(monitor.prUrl)) continue;
        monitors.unregister(monitor.prUrl);
        removed.push(monitor.prUrl);
      }

      return { added, removed };
    },

    removeAllForTodo(todoId: string): number {
      const existing = monitors.findByTodo(todoId as Todo['id']);
      let count = 0;
      for (const m of existing) {
        if (monitors.unregister(m.prUrl)) count += 1;
      }
      return count;
    },
  };
}
