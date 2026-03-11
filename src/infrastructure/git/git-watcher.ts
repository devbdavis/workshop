import { EventEmitter } from 'events';
import { createGitAdapter } from './git-adapter.js';
import type { GitStatus } from './git-adapter.js';

export interface GitWatcherEvents {
  'branch-changed': { repoPath: string; oldBranch: string; newBranch: string };
  'dirty-changed': { repoPath: string; dirty: boolean };
  'status-updated': { repoPath: string; status: GitStatus };
  error: { repoPath: string; error: unknown };
}

/**
 * A polling-based watcher that periodically checks git status for tracked repos
 * and emits events when branch or dirty state changes.
 */
export class GitWatcher extends EventEmitter {
  private readonly adapter = createGitAdapter();
  private readonly repos = new Map<string, GitStatus | null>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;

  constructor(intervalMs = 5000) {
    super();
    this.intervalMs = intervalMs;
  }

  /** Add a repo path to be watched. */
  addRepo(repoPath: string): void {
    if (!this.repos.has(repoPath)) {
      this.repos.set(repoPath, null);
    }
  }

  /** Remove a repo path from watching. */
  removeRepo(repoPath: string): void {
    this.repos.delete(repoPath);
  }

  /** Returns the set of currently watched repo paths. */
  getWatchedRepos(): string[] {
    return Array.from(this.repos.keys());
  }

  /** Start polling. Does nothing if already started. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.pollAll();
    }, this.intervalMs);
    // Run an initial poll immediately
    void this.pollAll();
  }

  /** Stop polling. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Returns true if the watcher is currently polling. */
  isRunning(): boolean {
    return this.timer !== null;
  }

  /** Poll all tracked repos and emit change events. */
  private async pollAll(): Promise<void> {
    const paths = Array.from(this.repos.keys());
    await Promise.all(paths.map((p) => this.pollRepo(p)));
  }

  /** Poll a single repo and emit events if state changed. */
  private async pollRepo(repoPath: string): Promise<void> {
    try {
      const status = await this.adapter.getStatus(repoPath);
      const previous = this.repos.get(repoPath) ?? null;

      // Emit branch-changed if branch differs
      if (previous && previous.branch !== status.branch) {
        this.emit('branch-changed', {
          repoPath,
          oldBranch: previous.branch,
          newBranch: status.branch,
        });
      }

      // Emit dirty-changed if dirty state differs
      if (previous && previous.dirty !== status.dirty) {
        this.emit('dirty-changed', {
          repoPath,
          dirty: status.dirty,
        });
      }

      // Always emit status-updated
      this.emit('status-updated', { repoPath, status });

      // Store current status
      this.repos.set(repoPath, status);
    } catch (err) {
      this.emit('error', { repoPath, error: err });
    }
  }
}

export function createGitWatcher(intervalMs?: number): GitWatcher {
  return new GitWatcher(intervalMs);
}
