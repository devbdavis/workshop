/**
 * Dark Factory usage-pacing poller — the resume half of usage pacing.
 *
 * Proactive pausing happens at dispatch time (dispatch-coordinator's usage gate);
 * this poller periodically resumes paused autonomous epics once (a) their pause
 * floor has elapsed and (b) the trailing usage window has drained back under the
 * threshold. Follows the codebase's plain setInterval poller idiom.
 */
import type { WorkflowTicket } from '@foundation/types.js';
import type { WorkflowTicketRepository } from '@domain/workflow/ticket-repository.js';
import type { UsageTracker } from '@infrastructure/usage/usage-tracker.js';
import type { DispatchCoordinator } from '../workflow/dispatch-coordinator.js';

export interface UsagePacingPollerDeps {
  tickets: WorkflowTicketRepository;
  usageTracker: UsageTracker;
  dispatcher: DispatchCoordinator;
  /** Called after an epic is resumed (used to broadcast a UI refresh). */
  onResumed?: (ticketId: string) => void;
  intervalMs?: number;
  threshold?: number;
  now?: () => number;
}

export interface UsagePacingPoller {
  start(): void;
  stop(): void;
  /** Run one pass (exposed for tests). */
  tick(): Promise<void>;
}

export function createUsagePacingPoller(deps: UsagePacingPollerDeps): UsagePacingPoller {
  const { tickets, usageTracker, dispatcher, onResumed } = deps;
  const intervalMs = deps.intervalMs ?? 3 * 60 * 1000;
  const threshold = deps.threshold ?? 0.75;
  const now = deps.now ?? (() => Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<void> {
    let epics: WorkflowTicket[];
    try {
      epics = tickets.findAll({ type: 'epic' });
    } catch {
      return;
    }
    for (const epic of epics) {
      const sd = (epic.stateData || {}) as Record<string, unknown>;
      if (sd.autonomous !== true || sd.paused !== true) continue;

      const until = typeof sd.pausedUntil === 'string' ? Date.parse(sd.pausedUntil) : 0;
      if (now() < until) continue; // still within the pause floor
      if (usageTracker.isOverThreshold(threshold)) continue; // window hasn't drained yet

      try {
        tickets.update(epic.id, { stateData: { ...sd, paused: false, pausedUntil: undefined } });
        onResumed?.(epic.id);
        await dispatcher.dispatchForCurrentState(epic.id);
      } catch (err) {
        console.warn(`[dark-factory] usage-pacing resume failed for ${epic.id}:`, err);
      }
    }
  }

  return {
    start() {
      if (!timer) timer = setInterval(() => { void tick(); }, intervalMs);
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
    },
    tick,
  };
}
