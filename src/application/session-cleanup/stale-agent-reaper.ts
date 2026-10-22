import type { SessionRepository } from '@domain/session/repository';
import type { SettingsRepository } from '@domain/repo/repository';
import type { SessionId, TrackId } from '@foundation/types';

/**
 * Settings keys naming the disposable system tracks. Sessions here are one-shot
 * agent runs, not work the user returns to: PR-review analysis (dispatched
 * `interactive` so it parks at its prompt after reporting, and therefore never
 * trips the generic exited-CLI reaper) and Linear issue drafting. Once cold they
 * are terminated — re-analyzing or asking a follow-up means a fresh dispatch.
 */
const DISPOSABLE_TRACK_SETTINGS = ['pr_review_track_id', 'linear_ticket_track_id'];

const MAX_AGE_MS = 48 * 60 * 60 * 1_000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1_000;

export interface StaleAgentReaperDeps {
  sessions: SessionRepository;
  settings: SettingsRepository;
  terminal: { softDeleteSession(sessionId: SessionId): Promise<void> };
  broadcast: (type: 'session:deleted', trackId: string) => void;
}

export interface StaleAgentReaper {
  start(): void;
  stop(): void;
  /** Returns the number of sessions terminated. */
  reapNow(): Promise<number>;
}

export function createStaleAgentReaper(deps: StaleAgentReaperDeps): StaleAgentReaper {
  let intervalHandle: ReturnType<typeof setInterval> | null = null;

  async function reapNow(): Promise<number> {
    const cutoff = Date.now() - MAX_AGE_MS;
    let reaped = 0;

    for (const key of DISPOSABLE_TRACK_SETTINGS) {
      const trackId = deps.settings.get(key);
      if (!trackId) continue;

      // findByTrack skips the recycle bin — soft-deleted rows are already owned
      // by the terminal manager's 7-day purge.
      for (const session of deps.sessions.findByTrack(trackId as TrackId)) {
        // updatedAt, not the manager's in-memory lastActivityAt: that map is
        // stamped on the first pane observation after every restart, which would
        // reset the clock on any long-parked session each time Workshop restarts.
        if (new Date(session.updatedAt).getTime() > cutoff) continue;
        try {
          // Soft-delete, like every other retire path: tmux dies and the session
          // leaves the active list, but the scrollback stays readable in the
          // recycle bin until purgeExpiredSessions() drops it after 7 days.
          await deps.terminal.softDeleteSession(session.id);
          deps.broadcast('session:deleted', session.trackId);
          reaped++;
          console.log(
            `[stale-agent-reaper] terminated ${session.id} (${session.name ?? 'unnamed'}), last touched ${session.updatedAt}`,
          );
        } catch (err) {
          console.error(`[stale-agent-reaper] failed to terminate ${session.id}:`, err);
        }
      }
    }

    return reaped;
  }

  function tick(): void {
    void reapNow().catch((err) => console.error('[stale-agent-reaper] error:', err));
  }

  return {
    start(): void {
      if (intervalHandle) return;
      tick();
      intervalHandle = setInterval(tick, SWEEP_INTERVAL_MS);
      intervalHandle.unref?.();
      console.log(`[stale-agent-reaper] started (max age: ${MAX_AGE_MS / 3_600_000}h)`);
    },

    stop(): void {
      if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
    },

    reapNow,
  };
}
