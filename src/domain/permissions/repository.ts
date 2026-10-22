import type {
  PermissionRequest,
  PermissionRequestId,
  PermissionRequestStatus,
  PermissionRule,
  PermissionRuleId,
} from '@foundation/permission-types';

export type NewPermissionRequest = Omit<PermissionRequest, 'id' | 'createdAt' | 'decidedAt'>;
export type NewPermissionRule = Omit<PermissionRule, 'id' | 'createdAt'>;

export interface PermissionRepository {
  createRequest(data: NewPermissionRequest): PermissionRequest;
  findRequestById(id: PermissionRequestId): PermissionRequest | null;
  listRequests(opts: {
    status?: PermissionRequestStatus;
    normalizedTool?: string;
    limit: number;
  }): PermissionRequest[];
  updateRequestStatus(
    id: PermissionRequestId,
    status: PermissionRequestStatus,
    ruleId?: PermissionRuleId,
  ): PermissionRequest | null;
  listRules(): PermissionRule[];
  findRuleById(id: PermissionRuleId): PermissionRule | null;
  createRule(data: NewPermissionRule): PermissionRule;
  deleteRule(id: PermissionRuleId): boolean;
}
