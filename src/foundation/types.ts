// Branded ID types for type safety
export type TrackId = string & { readonly __brand: 'TrackId' };
export type SessionId = string & { readonly __brand: 'SessionId' };
export type TicketId = string & { readonly __brand: 'TicketId' };
export type SummaryId = string & { readonly __brand: 'SummaryId' };
export type AutomationRuleId = string & { readonly __brand: 'AutomationRuleId' };
export type RepoId = string & { readonly __brand: 'RepoId' };
export type PathId = string & { readonly __brand: 'PathId' };
export type TemplateId = string & { readonly __brand: 'TemplateId' };

// Track
export interface Track {
  id: TrackId;
  name: string;
  description?: string;
  context?: string;
  status: 'active' | 'archived';
  defaultPromptTemplateId?: TemplateId;
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

// Prompt template
export interface PromptTemplate {
  id: TemplateId;
  name: string;
  description?: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}
