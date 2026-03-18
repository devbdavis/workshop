import { execSync } from 'child_process';
import type { DiscussionId } from '@foundation/discussion-types';
import type {
  DiscussionRepository,
  DiscussionMessageRepository,
  DiscussionSessionRepository,
} from '@domain/discussion/repository';
import type { SessionRepository } from '@domain/session/repository';
import type { DiscussionService } from './discussion-service.js';

export interface DiscussionPollerDeps {
  discussionSessions: DiscussionSessionRepository;
  discussions: DiscussionRepository;
  messages: DiscussionMessageRepository;
  sessions: SessionRepository;
  discussionService: DiscussionService;
  broadcast: (type: string, id: string) => void;
}

export interface DiscussionPoller {
  start(intervalMs?: number): void;
  stop(): void;
  pollNow(): void;
}

export function createDiscussionPoller(deps: DiscussionPollerDeps): DiscussionPoller {
  let intervalHandle: ReturnType<typeof setInterval> | null = null;

  function pollNow(): void {
    try {
      nudgeAgents();
      checkStaleDiscussions();
    } catch (err) {
      console.error('Discussion poller error:', err);
    }
  }

  function nudgeAgents(): void {
    const unreadSessions = deps.discussionSessions.findWithUnread();
    let pokeCount = 0;

    for (const entry of unreadSessions) {
      try {
        // Check if the Workshop session still exists (may have been cascade-deleted by session sync)
        const session = deps.sessions.findById(entry.sessionId);
        if (!session) continue;

        // Check if tmux session is alive
        try {
          execSync(`tmux has-session -t ${session.tmuxSession}`, { stdio: 'pipe' });
        } catch {
          // tmux session is dead — skip
          continue;
        }

        // Send nudge message via tmux send-keys
        const message = `There are ${entry.unreadCount} new message(s) in discussion "${entry.discussionTitle}". Use workshop_discussion_read to review and respond.`;
        const escaped = message.replace(/"/g, '\\"');
        execSync(
          `tmux send-keys -t ${session.tmuxSession} "${escaped}" Enter`,
          { stdio: 'pipe' },
        );

        // Update last seen to the latest message rowid
        const latestRowid = deps.messages.latestRowid(entry.discussionId);
        if (latestRowid !== null) {
          // We need the latest message ID, not rowid. Get the latest messages.
          const allMessages = deps.messages.findByDiscussion(entry.discussionId);
          if (allMessages.length > 0) {
            const latestMsg = allMessages[allMessages.length - 1];
            deps.discussionSessions.updateLastSeen(
              entry.discussionId,
              entry.agentId,
              latestMsg.id,
            );
          }
        }

        pokeCount++;
      } catch (err) {
        console.error(`Failed to nudge agent ${entry.agentId} for discussion ${entry.discussionId}:`, err);
      }
    }

    if (pokeCount > 0) {
      console.log(`Discussion poller: nudged ${pokeCount} agent(s)`);
    }
  }

  function checkStaleDiscussions(): void {
    const openDiscussions = deps.discussions.findAll({ status: 'open' as any });
    const now = Date.now();
    let staleCount = 0;

    for (const disc of openDiscussions) {
      if (disc.staleAfterMinutes <= 0) continue;

      const lastActivity = new Date(disc.lastActivityAt).getTime();
      const staleThreshold = disc.staleAfterMinutes * 60 * 1000;

      if (now - lastActivity > staleThreshold) {
        try {
          deps.discussions.updateStatus(disc.id, 'stale');
          void deps.discussionService.closeDiscussion(disc.id);
          deps.broadcast('discussion:closed', disc.id);
          staleCount++;
        } catch (err) {
          console.error(`Failed to close stale discussion ${disc.id}:`, err);
        }
      }
    }

    if (staleCount > 0) {
      console.log(`Discussion poller: closed ${staleCount} stale discussion(s)`);
    }
  }

  return {
    start(intervalMs = 60_000): void {
      if (intervalHandle) return;
      intervalHandle = setInterval(pollNow, intervalMs);
      console.log(`Discussion poller started (interval: ${intervalMs / 1000}s)`);
    },

    stop(): void {
      if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
        console.log('Discussion poller stopped');
      }
    },

    pollNow,
  };
}
