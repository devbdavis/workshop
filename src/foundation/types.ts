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
export type PermissionRequestId = string & { readonly __brand: 'PermissionRequestId' };
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
export type SessionProvider = 'claude' | 'codex' | 'gemini';

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
  createdAt: string;
  updatedAt: string;
  /** NOT persisted — enriched at runtime from in-memory activity tracking */
  lastActivityAt?: string;
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

export interface Todo {
  id: TodoId;
  trackId: TrackId;
  title: string;
  description?: string;
  status: TodoStatus;
  priority: TodoPriority;
  refined: boolean;
  sessionId?: SessionId;
  agentId?: AgentId;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// Permission request (for background agent tool approvals)
export type PermissionDecision = 'pending' | 'approved' | 'denied';

export interface PermissionRequest {
  id: PermissionRequestId;
  sessionId: SessionId;
  toolName: string;
  toolInput: Record<string, unknown>;
  decision: PermissionDecision;
  decisionReason?: string;
  userComment?: string;
  createdAt: string;
  resolvedAt?: string;
}

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
export interface PromptTemplate {
  id: TemplateId;
  name: string;
  description?: string;
  content: string;
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
  // State
  enabled: boolean;
  lastRunAt?: string;
  lastRunStatus?: 'running' | 'completed' | 'failed';
  lastSessionId?: SessionId;
  runCount: number;
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

  // Dynamic workflow template binding
  workflowTemplateRowId?: string;
  workflowTemplateVersion?: number;

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
