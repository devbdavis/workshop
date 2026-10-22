import type { SessionId, TrackId } from './types.js';

export type PermissionRequestId = string & { readonly __brand: 'PermissionRequestId' };
export type PermissionRuleId = string & { readonly __brand: 'PermissionRuleId' };

/** CLIs that can route a blocked tool call to Workshop. */
export type PermissionHarness = 'claude' | 'codex' | 'gemini';
export type PermissionDecision = 'allow' | 'deny';
export type PermissionRequestStatus =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'expired'
  | 'auto-approved'
  | 'auto-declined';

export interface PermissionRequest {
  id: PermissionRequestId;
  sessionId: SessionId;
  trackId: TrackId | null;
  /** Todo title, else session name, else track name. */
  taskName: string;
  harness: PermissionHarness;
  toolName: string;
  /** 'shell' for any CLI's shell tool, otherwise the raw tool name. */
  normalizedTool: string;
  /** Shell command, file path, or truncated JSON of the input. */
  summary: string;
  toolInput: unknown;
  reason?: string;
  /** Prefill for "always" decisions; null when the rule would cover any input of the tool. */
  suggestedPattern: string | null;
  status: PermissionRequestStatus;
  ruleId?: PermissionRuleId;
  createdAt: string;
  decidedAt?: string;
}

export interface PermissionRule {
  id: PermissionRuleId;
  /** Normalized tool name ('shell' for shell tools). */
  toolName: string;
  /** Shell command prefix; null matches any input of the tool. */
  pattern: string | null;
  decision: PermissionDecision;
  sourceRequestId?: PermissionRequestId;
  createdAt: string;
}
