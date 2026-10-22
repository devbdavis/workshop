import type { IssueImportIgnore, IssueSource } from '@foundation/types';

export interface IssueImportIgnoreRepository {
  findBySource(source: IssueSource): IssueImportIgnore[];
  findOne(source: IssueSource, externalId: string): IssueImportIgnore | null;
  add(data: {
    source: IssueSource;
    externalId: string;
    cachedTitle?: string;
    cachedUrl?: string;
  }): IssueImportIgnore;
  remove(source: IssueSource, externalId: string): boolean;
}
