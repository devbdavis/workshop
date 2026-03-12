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

// Track
export interface Track {
  id: TrackId;
  name: string;
  description?: string;
  context?: string;
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
export type SessionState = 'active' | 'detached' | 'dead';

export interface Session {
  id: SessionId;
  trackId: TrackId;
  tmuxSession: string;
  claudeResumeId?: string;
  systemPrompt?: string;
  state: SessionState;
  /** Background sessions run agents silently — not shown in the main terminal area */
  background: boolean;
  createdAt: string;
  updatedAt: string;
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
