/**
 * Domain interface for terminal session management.
 *
 * Infrastructure provides the concrete implementation (tmux + node-pty).
 */
import type { Session, SessionId, SessionProvider, TrackId, TrackRepo } from '@foundation/types';

export interface CreateSessionOptions {
  systemPrompt?: string;
  workingDirectory?: string;
  /** Which AI CLI to use. Defaults to 'claude'. */
  provider?: SessionProvider;
  /** If true, do not start the AI CLI in the tmux session. Defaults to false. */
  skipClaude?: boolean;
  /** If true, the session runs as a background agent. Defaults to false. */
  background?: boolean;
  /** Todo ID if dispatched from a todo (used in system prompt extension). */
  todoId?: string;
  /** Initial prompt to send to the AI CLI (the task to work on). */
  initialPrompt?: string;
  /** Display name for the session (shown in the terminal pane header). */
  name?: string;
  /** Workflow ticket ID — if set, adds SubagentStop + SessionEnd hooks for execution tracking */
  executionTicketId?: string;
  /** Tool patterns to pre-approve (passed as --allowedTools to claude CLI). */
  allowedTools?: string[];
  /** Claude session ID to resume (passed as --resume to claude CLI). */
  claudeResumeId?: string;
  /** Per-session MCP server configs to inject into the session's settings.json */
  mcpServers?: Record<string, unknown>;
  /** If true, pass --dangerously-skip-permissions to Claude so it runs without permission prompts. */
  dangerouslySkipPermissions?: boolean;
  /** If true, skip the automatic background agent instructions appended to the system prompt. */
  skipBackgroundInstructions?: boolean;
  /** If true, create an isolated git worktree per repo for this session. */
  worktreeMode?: boolean;
  /** Repos to create worktrees for. Required when worktreeMode is true. */
  repos?: TrackRepo[];
  /** Issue key to append to the worktree branch name (e.g. "ASY-1402"). */
  issueKey?: string;
}

export interface SyncResult {
  cleaned: { sessionId: SessionId; trackId: TrackId }[];
  suspended: { sessionId: SessionId; trackId: TrackId }[];
  dying: { sessionId: SessionId; trackId: TrackId }[];
  activityChanged: TrackId[];
  /** Sessions that transitioned working→idle and have stayed idle for the notify threshold. */
  idleAlerts: { sessionId: SessionId; trackId: TrackId; sessionName: string | undefined }[];
}

export interface TerminalManager {
  createSession(trackId: TrackId, options?: CreateSessionOptions): Promise<Session>;
  destroySession(sessionId: SessionId): Promise<void>;
  /** Move session to recycle bin: kills tmux, marks deleted_at, preserves worktree. */
  softDeleteSession(sessionId: SessionId): Promise<void>;
  /** Hard-delete any sessions whose deleted_at is older than retentionDays (default 7). */
  purgeExpiredSessions(retentionDays?: number): number;
  isSessionAlive(session: Session): boolean;
  syncSessionStates(): SyncResult;
  /** Resume all sessions marked 'suspended' that have a Claude resume ID. */
  resumeSuspendedSessions(): Promise<Session[]>;
  /**
   * Restore a session from the recycle bin: clears deleted_at, creates a fresh tmux
   * session, and re-launches Claude with --resume if a claudeResumeId is present,
   * otherwise drops to a bare shell at the original CWD.
   */
  restoreSession(sessionId: SessionId): Promise<Session>;
  /** Get the last time activity was detected for a session (ISO string), or undefined */
  getLastActivityAt(sessionId: SessionId): string | undefined;
  /** Whether a session is in the dying grace period (tmux dead, awaiting reap/suspend) */
  isDying(sessionId: SessionId): boolean;
  /** Get the current activity status of a session based on pane detection */
  getActivityStatus(sessionId: SessionId): 'working' | 'idle' | 'needs-input' | undefined;
}
