import type { GlobalRepo, GlobalRepoId } from '@foundation/types';

export interface GlobalRepoRepository {
  findAll(): GlobalRepo[];
  findById(id: GlobalRepoId): GlobalRepo | null;
  findByPath(path: string): GlobalRepo | null;
  create(data: Pick<GlobalRepo, 'path' | 'name' | 'mainBranch'>): GlobalRepo;
  delete(id: GlobalRepoId): boolean;
}

export interface SettingsRepository {
  get(key: string): string | null;
  set(key: string, value: string): void;
}
