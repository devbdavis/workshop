/**
 * Domain interface for terminal session management.
 *
 * Infrastructure provides the concrete implementation (tmux + node-pty).
 */
import type { Session, SessionId, SessionProvider, TrackId } from '@foundation/types';

export interface CreateSessionOptions {
  systemPrompt?: string;
  workingDirectory?: string;
  /** Which AI CLI to use. Defaults to 'claude'. */
  provider?: SessionProvider;
  /** If true, do not start the AI CLI in the tmux session. Defaults to false. */
  skipClaude?: boolean;
  /** If true, the session runs in the background with permission hooks. Defaults to false. */
  background?: boolean;
  /** Todo ID if dispatched from a todo (used in system prompt extension). */
  todoId?: string;
  /** Initial prompt to send to the AI CLI (the task to work on). */
  initialPrompt?: string;
  /** If true, skip permission hooks and run with --dangerously-skip-permissions. */
  dangerouslySkipPermissions?: boolean;
  /** Display name for the session (shown in the terminal pane header). */
  name?: string;
  /** Workflow ticket ID — if set, adds SubagentStop + SessionEnd hooks for execution tracking */
  executionTicketId?: string;
  /** Tool patterns to pre-approve (passed as --allowedTools to claude CLI). */
  allowedTools?: string[];
  /** Route tool permissions through Workshop UI even for interactive (non-background) sessions. */
  usePermissionHooks?: boolean;
  /** Claude session ID to resume (passed as --resume to claude CLI). */
  claudeResumeId?: string;
  /** Per-session MCP server configs to inject into the session's settings.json */
  mcpServers?: Record<string, unknown>;
}

export interface SyncResult {
  cleaned: { sessionId: SessionId; trackId: TrackId }[];
  suspended: { sessionId: SessionId; trackId: TrackId }[];
  dying: { sessionId: SessionId; trackId: TrackId }[];
  activityChanged: TrackId[];
}

export interface TerminalManager {
  createSession(trackId: TrackId, options?: CreateSessionOptions): Promise<Session>;
  destroySession(sessionId: SessionId): Promise<void>;
  isSessionAlive(session: Session): boolean;
  syncSessionStates(): SyncResult;
  /** Resume all sessions marked 'suspended' that have a Claude resume ID. */
  resumeSuspendedSessions(): Promise<Session[]>;
  /** Get the last time activity was detected for a session (ISO string), or undefined */
  getLastActivityAt(sessionId: SessionId): string | undefined;
  /** Whether a session is in the dying grace period (tmux dead, awaiting reap/suspend) */
  isDying(sessionId: SessionId): boolean;
}
