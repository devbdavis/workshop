// Branded ID types for type safety
export type TrackId = string & { readonly __brand: 'TrackId' };
export type SessionId = string & { readonly __brand: 'SessionId' };
export type TicketId = string & { readonly __brand: 'TicketId' };
export type SummaryId = string & { readonly __brand: 'SummaryId' };
export type AutomationRuleId = string & { readonly __brand: 'AutomationRuleId' };
export type RepoId = string & { readonly __brand: 'RepoId' };
export type PathId = string & { readonly __brand: 'PathId' };
export type TemplateId = string & { readonly __brand: 'TemplateId' };
export type TodoId = string & { readonly __brand: 'TodoId' };
export type AgentId = string & { readonly __brand: 'AgentId' };
export type ScheduledTaskId = string & { readonly __brand: 'ScheduledTaskId' };
export type WorkflowTicketId = string & { readonly __brand: 'WorkflowTicketId' };
export type WorkflowTransitionId = string & { readonly __brand: 'WorkflowTransitionId' };

// Track
export interface Track {
  id: TrackId;
  name: string;
  description?: string;
  context?: string;
  /** Optional label for categorisation (e.g. 'system' for internal tracks) */
  label?: string;
  /** Matrix room ID bound to this track (e.g. '!abc123:example.com') */
  matrixRoomId?: string;
  status: 'active' | 'archived';
  defaultPromptTemplateId?: TemplateId;
  terminalLayout?: TerminalLayout;
  /** If true, all background sessions on this track get per-session git worktrees */
  worktreeMode?: boolean;
  /** Default agent to use when dispatching messages on this track */
  defaultAgentId?: AgentId;
  createdAt: string;
  updatedAt: string;
  // Populated relations
  repos?: TrackRepo[];
  paths?: TrackPath[];
  tickets?: ExternalTicket[];
}

export interface TrackRepo {
  id: RepoId;
  trackId: TrackId;
  path: string;
  remoteUrl?: string;
  /** Reference to the global repo registry entry, if this track repo is linked */
  repoId?: GlobalRepoId;
  createdAt: string;
  // Live state (not persisted, populated at runtime)
  branch?: string;
  lastCommit?: string;
  dirty?: boolean;
}

export interface TrackPath {
  id: PathId;
  trackId: TrackId;
  path: string;
  label?: string;
  createdAt: string;
}

// Session
export type SessionState = 'active' | 'detached' | 'dead' | 'suspended';
export type SessionProvider = 'claude' | 'codex' | 'gemini' | 'cursor';

const SESSION_PROVIDER_VALUES = new Set<string>(['claude', 'codex', 'gemini', 'cursor']);

export function isSessionProvider(value: unknown): value is SessionProvider {
  return typeof value === 'string' && SESSION_PROVIDER_VALUES.has(value);
}

/** Parse API / stored values into a session provider. Unknown values fall back to Claude. */
export function parseSessionProvider(value: unknown): SessionProvider {
  return isSessionProvider(value) ? value : 'claude';
}

/**
 * Preferred default CLI for new sessions (General settings).
 * Widened to the full SessionProvider set so any installed/enabled agent can
 * be the default (claude/codex/gemini/cursor).
 */
export type DefaultAiCli = SessionProvider;

export function isDefaultAiCli(value: unknown): value is DefaultAiCli {
  return isSessionProvider(value);
}

export function parseDefaultAiCli(value: unknown): DefaultAiCli {
  return isDefaultAiCli(value) ? value : 'claude';
}

/**
 * Resolve a requested provider, falling back to the saved default when omitted.
 * Invalid explicit values still fall back to Claude for safety.
 */
export function resolveSessionProvider(
  requestedProvider: unknown,
  savedDefaultAiCli: unknown,
): SessionProvider {
  if (requestedProvider === undefined || requestedProvider === null) {
    return parseDefaultAiCli(savedDefaultAiCli);
  }
  return parseSessionProvider(requestedProvider);
}

export interface Session {
  id: SessionId;
  trackId: TrackId;
  name?: string;
  tmuxSession: string;
  claudeResumeId?: string;
  systemPrompt?: string;
  state: SessionState;
  /** Which AI CLI to use for this session */
  provider: SessionProvider;
  /** Background sessions run agents silently — not shown in the main terminal area */
  background: boolean;
  /** Workspace directory containing per-session git worktrees, if worktree mode was used */
  worktreeRoot?: string;
  /** Working directory the session was originally launched from — used to restore CWD on resume */
  workingDirectory?: string;
  createdAt: string;
  updatedAt: string;
  /** Set when session is moved to the recycle bin; null/undefined = not deleted */
  deletedAt?: string;
  /** NOT persisted — enriched at runtime from in-memory activity tracking */
  lastActivityAt?: string;
  /** NOT persisted — enriched at runtime: current agent activity state */
  activityStatus?: 'working' | 'idle' | 'needs-input';
}

// External ticket
export type TicketSource = 'jira' | 'linear';
export type TicketRelationship = 'primary' | 'related' | 'blocked-by';

export interface ExternalTicket {
  id: TicketId;
  trackId: TrackId;
  source: TicketSource;
  externalId: string;
  relationship: TicketRelationship;
  cachedTitle?: string;
  cachedStatus?: string;
  cachedData?: string;
  lastSyncedAt?: string;
  createdAt: string;
}

// Ticket import — hidden tickets (user-hidden issues from import UI)
export type TicketImportIgnoreId = string & { readonly __brand: 'TicketImportIgnoreId' };

export interface TicketImportIgnore {
  id: TicketImportIgnoreId;
  source: TicketSource;
  externalId: string;
  cachedTitle?: string;
  cachedUrl?: string;
  createdAt: string;
}

/**
 * Shape returned by integration endpoints when listing importable issues.
 * Kept purposefully narrow — only fields that matter for the import UI.
 */
export interface ImportableIssue {
  source: TicketSource;
  externalId: string;
  title: string;
  description?: string;
  url: string;
  stateName?: string;
  stateType?: string;
  projectName?: string;
  priority?: number;
  updatedAt?: string;
  /** Already-imported todo id, if any — lets UI hide or label these. */
  importedTodoId?: TodoId;
}

// Summary
export interface TrackSummary {
  id: SummaryId;
  trackId: TrackId;
  content: string;
  version: number;
  createdAt: string;
}

// Automation
export type TriggerType = 'schedule' | 'git-change' | 'ticket-status-change' | 'session-end' | 'manual';
export type ActionType = 'regenerate-summary' | 'run-agent-prompt' | 'sync-tickets';

export interface AutomationRule {
  id: AutomationRuleId;
  trackId: TrackId;
  name: string;
  triggerType: TriggerType;
  triggerConfig?: Record<string, unknown>;
  actionType: ActionType;
  actionConfig?: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRun {
  id: string;
  ruleId: AutomationRuleId;
  status: 'running' | 'completed' | 'failed';
  result?: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
}

// Todo
export type TodoStatus = 'backlog' | 'ready' | 'in-progress' | 'review' | 'done';
export type TodoPriority = 'low' | 'medium' | 'high';

export interface PullRequest {
  url: string;
  title?: string;
}

export interface Todo {
  id: TodoId;
  trackId: TrackId;
  title: string;
  description?: string;
  resolution?: string;
  /** Linear or Jira issue key (e.g. "ASY-1402"). Appended to worktree branch names. */
  issueKey?: string;
  /** Pull requests associated with this todo. */
  pullRequests?: PullRequest[];
  status: TodoStatus;
  priority: TodoPriority;
  refined: boolean;
  sessionId?: SessionId;
  agentId?: AgentId;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// PR Monitor — tracks status checks and unresolved comments on PRs linked to todos.
// Polled in the background (capped at a handful of requests per cycle) so the
// UI can surface "needs attention" affordances without spamming GitHub.

/** Lifecycle state of the PR itself. */
export type PrState = 'open' | 'draft' | 'merged' | 'closed' | 'unknown';

/** Rolled-up status-check verdict across all checks/statuses on the PR head. */
export type PrCheckStatus = 'none' | 'pending' | 'passing' | 'failing' | 'error';

/** A single failing check surfaced to the UI. */
export interface PrCheckSummary {
  /** Display name (workflow / context). */
  name: string;
  /** GitHub conclusion (SUCCESS, FAILURE, CANCELLED, TIMED_OUT, ...) when COMPLETED. */
  conclusion?: string;
  /** GitHub status (QUEUED, IN_PROGRESS, COMPLETED, ...). */
  status?: string;
  /** Link the user can click to inspect the failure. */
  detailsUrl?: string;
  /** Short text the checker provided (truncated by the poller). */
  summary?: string;
}

/** A single PR comment surfaced to the UI as "needs attention". */
export interface PrComment {
  /** GitHub node ID — used so the UI can dispatch a response for a single comment. */
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url?: string;
  /** `issue` = PR-level comment; `review` = inline review comment. */
  kind: 'issue' | 'review';
  /** For review comments only: the file path being reviewed. */
  path?: string;
  /** For review comments only: the diff line. */
  line?: number;
}

/**
 * Reason the poller flipped `monitoring` off:
 * - `finished`: PR was merged or closed
 * - `stale`: PR has had no push in the configured cutoff window
 * - `user`: user paused it manually via the UI (reserved for future)
 * `undefined` means the monitor is still active or was never paused.
 */
export type PrPauseReason = 'finished' | 'stale' | 'user';

/** A PR being polled by the background monitor. */
export interface PrMonitor {
  /** Canonical PR URL (https://github.com/owner/repo/pull/N). Primary key. */
  prUrl: string;
  todoId: TodoId;
  trackId: TrackId;
  repoOwner: string;
  repoName: string;
  prNumber: number;
  prTitle?: string;
  /** Head ref name (the branch the PR is merging from), captured on each poll. */
  prBranch?: string;
  /** SHA of the PR head commit. Used to detect new pushes → resets `lastPushAt`. */
  headRefOid?: string;
  state: PrState;
  checkStatus: PrCheckStatus;
  failingChecks: PrCheckSummary[];
  unresolvedComments: PrComment[];
  /** ISO timestamp when the PR first started "needing attention" in the current cycle. */
  needsAttentionSince?: string;
  /** When we last finished a poll for this PR (success or failure). */
  lastPolledAt?: string;
  /** When the last meaningful change was observed (new comment, status flip). */
  lastEventAt?: string;
  /** When we last saw a push (headRefOid change). Seeded on first poll. */
  lastPushAt?: string;
  /** False once the PR is merged or closed OR the poller auto-paused it as stale. */
  monitoring: boolean;
  /** Set alongside `monitoring=false` so the UI can explain why polling stopped. */
  pauseReason?: PrPauseReason;
  createdAt: string;
  updatedAt: string;
}

/** What the UI/API surface as "this PR wants you to look at it". */
export type PrAttentionReason = 'failing-checks' | 'unresolved-comments' | 'both' | 'none';

// Terminal layout (recursive split tree)
export type LayoutNodeId = string & { readonly __brand: 'LayoutNodeId' };

/** Leaf node hosting a single terminal session */
export interface LayoutLeaf {
  type: 'leaf';
  id: LayoutNodeId;
  sessionId: SessionId;
}

/** Split node dividing space between children */
export interface LayoutSplit {
  type: 'split';
  id: LayoutNodeId;
  /** horizontal = children side by side (columns), vertical = children stacked (rows) */
  direction: 'horizontal' | 'vertical';
  children: LayoutNode[];
  /** Percentage sizes for each child (must sum to 100) */
  sizes: number[];
}

export type LayoutNode = LayoutLeaf | LayoutSplit;

/** Top-level layout configuration stored per track */
export interface TerminalLayout {
  root: LayoutNode | null;
}

// Prompt template
/**
 * Reserved system templates that the app maintains itself.
 * - `todo`: the default dispatched-todo template (also flagged via legacy `is_default = 1`).
 * - `pr-build-fix`: the prompt sent to a sub-agent when a monitored PR has failing CI checks.
 * - `pr-comment-response`: the prompt sent to a sub-agent when a monitored PR has unresolved comments.
 *
 * User-created templates leave `systemKind` undefined.
 */
export type PromptTemplateSystemKind = 'todo' | 'pr-build-fix' | 'pr-comment-response';

export interface PromptTemplate {
  id: TemplateId;
  name: string;
  description?: string;
  content: string;
  isDefault: boolean;
  /** Non-empty for the small set of templates Workshop manages itself. */
  systemKind?: PromptTemplateSystemKind;
  createdAt: string;
  updatedAt: string;
}

// Scheduled Task
export type SchedulePreset = 'interval' | 'daily' | 'weekly' | 'monthly' | 'cron';

export interface ScheduleConfig {
  preset: SchedulePreset;
  /** For preset=interval: run every N minutes */
  intervalMinutes?: number;
  /** HH:MM time for daily/weekly/monthly */
  time?: string;
  /** Days of week: 0=Sun..6=Sat. For daily preset (e.g. workdays=[1,2,3,4,5]) */
  daysOfWeek?: number[];
  /** For weekly: which day (0-6) */
  dayOfWeek?: number;
  /** For monthly: how to pick the day */
  monthRule?: 'day-of-month' | 'weekday-of-month';
  /** For monthly day-of-month: 1-31 */
  dayOfMonth?: number;
  /** For monthly weekday-of-month: 1-4 or -1 for last (combined with dayOfWeek) */
  weekOfMonth?: number;
  /** For preset=cron: raw cron expression */
  cronExpression?: string;
}

export interface ScheduledTask {
  id: ScheduledTaskId;
  name: string;
  description?: string;
  // Template sync
  /** Slug of the bundled template this task was created from (templates/schedules/<name>.json) */
  templateName?: string;
  /** Computed at API time: true when taskPrompt or scheduleConfig diverges from the template */
  isOutOfSync?: boolean;
  /** Template's taskPrompt — present when isOutOfSync is true, for diff display */
  templateContent?: string;
  // Schedule
  scheduleConfig: ScheduleConfig;
  /** The resolved cron expression used by node-cron */
  cronExpression: string;
  /** Human-readable schedule description */
  scheduleDescription: string;
  // Execution
  trackId?: TrackId;
  agentId?: AgentId;
  provider: SessionProvider;
  /** The task prompt / instruction sent to the agent */
  taskPrompt: string;
  /** If set, used instead of auto-composed prompt */
  systemPromptOverride?: string;
  /** Optional path to a shell script run before the agent; stdout is prepended to the task prompt as context */
  scriptPath?: string;
  // State
  enabled: boolean;
  lastRunAt?: string;
  lastRunStatus?: 'running' | 'completed' | 'failed';
  lastSessionId?: SessionId;
  runCount: number;
  /** Next scheduled occurrence — computed server-side, not persisted */
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskRun {
  id: string;
  taskId: ScheduledTaskId;
  sessionId?: SessionId;
  status: 'running' | 'completed' | 'failed';
  error?: string;
  startedAt: string;
  completedAt?: string;
}

// Workflow Ticket
export type WorkflowTicketType = 'epic' | 'task';

// Dynamic workflow types — all validation is runtime via Zod schemas
export type WorkflowState = string;
export type AgentRoleId = string;

/** Structured data from the execution pipeline */
export interface ExecutionData {
  prUrls?: string[];
  ciStatus?: 'pending' | 'passed' | 'failed';
  agentProgress?: Array<{
    role: string;
    status: 'running' | 'completed' | 'failed';
    completedAt?: string;
    summary?: string;
  }>;
  implementationSummary?: string;
  deviations?: string;
}

export interface WorkflowTicket {
  id: WorkflowTicketId;
  type: WorkflowTicketType;
  title: string;
  description: string;
  state: WorkflowState;
  stateData?: Record<string, unknown>;

  // Hierarchy
  parentId?: WorkflowTicketId;
  childIds?: WorkflowTicketId[];

  // Relationships
  trackId?: TrackId;
  externalTicketId?: TicketId;
  executionSessionId?: SessionId;

  // Assignment — now string-based for dynamic roles
  assignedAgentRole?: string | null;
  assignedAgentIds?: AgentId[];
  provider: SessionProvider;

  // Metadata
  priority: 'low' | 'medium' | 'high' | 'critical';
  labels?: string[];
  sortOrder: number;

  // Dynamic playbook binding
  playbookRowId?: string;
  playbookVersion?: number;

  // Audit
  stateChangedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** Actor who triggered a state transition */
export type TransitionActor =
  | { type: 'agent'; agentId?: string; sessionId?: string }
  | { type: 'human'; userId?: string }
  | { type: 'system'; reason: string };

export interface WorkflowTransition {
  id: WorkflowTransitionId;
  ticketId: WorkflowTicketId;
  fromState: WorkflowState;
  toState: WorkflowState;
  actor: TransitionActor;
  comment?: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface TicketDependency {
  id: string;
  ticketId: WorkflowTicketId;
  dependsOnId: WorkflowTicketId;
  createdAt: string;
  resolvedAt?: string;
}


// Agent
export type AgentSource = 'global' | 'project' | 'workshop';

export interface Agent {
  id: AgentId;
  name: string;
  description: string;
  model?: string;
  provider?: SessionProvider;
  color?: string;
  systemPrompt: string;
  source: AgentSource;
  /** Filesystem path for global/project agents */
  filePath?: string;
  /** Allowed tools (from Claude Code agent frontmatter) */
  allowedTools?: string[];
  /** Max agentic turns */
  maxTurns?: number;
  /** Slug of the bundled template (templates/agents/<templateName>.md) */
  templateName?: string;
  /** Computed at API time: true when systemPrompt or description diverges from the template */
  isOutOfSync?: boolean;
  /** Template's systemPrompt — present when isOutOfSync is true, for diff display */
  templateContent?: string;
  createdAt: string;
  updatedAt: string;
}

// Global Repo
export type GlobalRepoId = string & { readonly __brand: 'GlobalRepoId' };

export interface GlobalRepo {
  id: GlobalRepoId;
  path: string;
  name: string;
  mainBranch: 'main' | 'master';
  createdAt: string;
  updatedAt: string;
}

// MCP Server Config
export type McpServerConfigId = string & { readonly __brand: 'McpServerConfigId' };
export type McpTransportType = 'stdio' | 'http' | 'sse';

export interface McpServerConfig {
  id: McpServerConfigId;
  /** Server name — unique key across all CLI tools */
  name: string;
  transportType: McpTransportType;
  /** For stdio servers: the command to run */
  command?: string;
  /** For stdio servers: arguments to the command */
  args?: string[];
  /** Environment variables for stdio servers */
  env?: Record<string, string>;
  /** For http/sse servers: the URL */
  url?: string;
  /** HTTP headers for http/sse servers */
  headers?: Record<string, string>;
  enabled: boolean;
  /** How this config was added */
  source: 'claude-import' | 'manual';
  createdAt: string;
  updatedAt: string;
}

/** Result of attempting to install an MCP server into a CLI tool */
export interface McpInstallResult {
  tool: 'claude' | 'codex' | 'gemini';
  serverName: string;
  success: boolean;
  message: string;
}

// Skill
export type SkillId = string & { readonly __brand: 'SkillId' };
export type SkillSource = 'global' | 'project';

export interface Skill {
  id: SkillId;
  name: string;
  description: string;
  /** The skill body — the markdown content that Claude Code injects */
  content: string;
  source: SkillSource;
  filePath?: string;
  /** Slug of the bundled template (templates/skills/<templateName>/SKILL.md) */
  templateName?: string;
  /** Computed at API time: true when content or description diverges from the template */
  isOutOfSync?: boolean;
  /** Template's content — present when isOutOfSync is true, for diff display */
  templateContent?: string;
  createdAt: string;
  updatedAt: string;
}
