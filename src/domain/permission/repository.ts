import type {
  PermissionRequest,
  PermissionRequestId,
  PermissionDecision,
  SessionId,
} from '@foundation/types';

export interface PermissionRequestRepository {
  findById(id: PermissionRequestId): PermissionRequest | null;
  findBySession(sessionId: SessionId): PermissionRequest[];
  findPendingBySession(sessionId: SessionId): PermissionRequest[];
  create(data: Omit<PermissionRequest, 'id' | 'createdAt' | 'resolvedAt'>): PermissionRequest;
  resolve(
    id: PermissionRequestId,
    decision: PermissionDecision,
    reason?: string,
    comment?: string,
  ): PermissionRequest | null;
  delete(id: PermissionRequestId): boolean;
}
