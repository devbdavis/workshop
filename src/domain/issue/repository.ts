import type {
  ExternalIssue,
  IssueId,
  TrackId,
  IssueSource,
  IssueRelationship,
} from '@foundation/types';

export interface IssueRepository {
  findById(id: IssueId): ExternalIssue | null;
  findByTrack(trackId: TrackId): ExternalIssue[];
  findByExternalId(source: IssueSource, externalId: string): ExternalIssue[];
  create(issue: Omit<ExternalIssue, 'id' | 'createdAt'>): ExternalIssue;
  updateCachedData(
    id: IssueId,
    data: { cachedTitle?: string; cachedStatus?: string; cachedData?: string },
  ): ExternalIssue | null;
  updateRelationship(id: IssueId, relationship: IssueRelationship): ExternalIssue | null;
  delete(id: IssueId): boolean;
}
