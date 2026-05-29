import type { GhAdapter } from '@infrastructure/github/gh-adapter';
import { snapshotFromGhJson } from '@infrastructure/github/gh-adapter.js';
import type { PrMonitorRepository } from '@domain/pr-monitor/repository';
import type { PrCheckStatus, PrMonitor, PrState } from '@foundation/types';

export interface PrMonitorPollerDeps {
  monitors: PrMonitorRepository;
  gh: GhAdapter;
  broadcast: (type: 'pr:updated', trackId: string, payload?: Record<string, unknown>) => void;
  /** How long to wait between cycles. Defaults to 2 minutes; clamped to >= 60s. */
  intervalMs?: number;
  /** Max PR refreshes per cycle. Defaults to 5. */
  maxPerCycle?: number;
  /** Minimum time between refreshes of the same PR. Defaults to `intervalMs`. */
  minPrCooldownMs?: number;
  /** Stagger between gh calls within a single cycle (ms). Defaults to 1000ms. */
  perCallStaggerMs?: number;
  /** Override for tests. */
  now?: () => Date;
  /** Override for tests — fixed delay implementation. */
  delay?: (ms: number) => Promise<void>;
}

export interface PrMonitorPoller {
  start(): void;
  stop(): void;
  /** Run a single cycle now. Returns the list of monitor rows that were updated. */
  pollNow(): Promise<PrMonitor[]>;
}

const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;
const DEFAULT_MAX_PER_CYCLE = 5;
const DEFAULT_PER_CALL_STAGGER_MS = 1000;

function changedFromPrevious(
  previous: { state: PrState; checkStatus: PrCheckStatus; failingCount: number; commentCount: number; prTitle?: string },
  next: { state: PrState; checkStatus: PrCheckStatus; failingChecks: { name: string }[]; unresolvedComments: { id: string }[]; prTitle?: string },
): boolean {
  if (previous.state !== next.state) return true;
  if (previous.checkStatus !== next.checkStatus) return true;
  if (previous.failingCount !== next.failingChecks.length) return true;
  if (previous.commentCount !== next.unresolvedComments.length) return true;
  if ((previous.prTitle ?? '') !== (next.prTitle ?? '')) return true;
  return false;
}

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function createPrMonitorPoller(deps: PrMonitorPollerDeps): PrMonitorPoller {
  const intervalMs = Math.max(deps.intervalMs ?? DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS);
  const maxPerCycle = Math.max(deps.maxPerCycle ?? DEFAULT_MAX_PER_CYCLE, 1);
  const minPrCooldownMs = deps.minPrCooldownMs ?? intervalMs;
  const perCallStaggerMs = Math.max(deps.perCallStaggerMs ?? DEFAULT_PER_CALL_STAGGER_MS, 0);
  const now = deps.now ?? (() => new Date());
  const delay = deps.delay ?? defaultDelay;

  let handle: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  async function pollOnce(): Promise<PrMonitor[]> {
    if (inFlight) {
      // A previous cycle is still running (slow `gh` calls). Skip this tick so
      // we never queue overlapping work — the next tick will pick up where it left off.
      return [];
    }
    inFlight = true;
    try {
      const cutoffIso = new Date(now().getTime() - minPrCooldownMs).toISOString();
      const due = deps.monitors.findDueForPolling(maxPerCycle, cutoffIso);
      if (due.length === 0) return [];

      const updated: PrMonitor[] = [];
      for (let i = 0; i < due.length; i++) {
        const monitor = due[i];
        try {
          const snapshot = await deps.gh.fetchPrSnapshot(monitor.prUrl);
          const changed = changedFromPrevious(
            {
              state: monitor.state,
              checkStatus: monitor.checkStatus,
              failingCount: monitor.failingChecks.length,
              commentCount: monitor.unresolvedComments.length,
              prTitle: monitor.prTitle,
            },
            snapshot,
          );
          const result = deps.monitors.applyPoll(monitor.prUrl, {
            state: snapshot.state,
            checkStatus: snapshot.checkStatus,
            failingChecks: snapshot.failingChecks,
            unresolvedComments: snapshot.unresolvedComments,
            prTitle: snapshot.prTitle,
            prBranch: snapshot.headRefName,
            changed,
            stopMonitoring: snapshot.finished,
          });
          if (result) {
            updated.push(result);
            if (changed) {
              deps.broadcast('pr:updated', monitor.trackId, {
                todoId: monitor.todoId,
                prUrl: monitor.prUrl,
                state: result.state,
                checkStatus: result.checkStatus,
              });
            }
          }
        } catch (err) {
          // We deliberately swallow individual errors: a transient `gh` failure
          // shouldn't poison the whole cycle. Bump last_polled_at via a no-op
          // poll update so the failing row rotates to the back of the queue.
          console.warn(`[pr-monitor] gh poll failed for ${monitor.prUrl}:`, err instanceof Error ? err.message : err);
          deps.monitors.applyPoll(monitor.prUrl, {
            state: monitor.state,
            checkStatus: monitor.checkStatus,
            failingChecks: monitor.failingChecks,
            unresolvedComments: monitor.unresolvedComments,
            prTitle: monitor.prTitle,
            changed: false,
            stopMonitoring: false,
          });
        }
        if (i < due.length - 1 && perCallStaggerMs > 0) {
          await delay(perCallStaggerMs);
        }
      }
      return updated;
    } finally {
      inFlight = false;
    }
  }

  return {
    start(): void {
      if (handle) return;
      handle = setInterval(() => {
        void pollOnce().catch((err) => {
          console.error('[pr-monitor] poll cycle failed:', err);
        });
      }, intervalMs);
      // Don't pin the event loop open if this is the only thing running (tests).
      if (typeof handle === 'object' && handle && 'unref' in handle && typeof (handle as { unref?: () => void }).unref === 'function') {
        (handle as { unref: () => void }).unref();
      }
    },
    stop(): void {
      if (handle) {
        clearInterval(handle);
        handle = null;
      }
    },
    pollNow: pollOnce,
  };
}

// Re-export so tests can drive the pure snapshot logic without booting the poller.
export { snapshotFromGhJson };
