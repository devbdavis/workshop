import type { Track, TrackId, TrackRepo, TrackPath, RepoId, PathId, TemplateId } from '@foundation/types';

export interface TrackRepository {
  findAll(): Track[];
  findById(id: TrackId): Track | null;
  create(track: Omit<Track, 'id' | 'createdAt' | 'updatedAt' | 'repos' | 'paths' | 'tickets'>): Track;
  update(id: TrackId, data: Partial<Pick<Track, 'name' | 'description' | 'context' | 'status'>>): Track | null;
  delete(id: TrackId): boolean;

  // Prompt template association
  setDefaultPromptTemplate(trackId: TrackId, templateId: TemplateId | null): boolean;

  // Repo associations
  addRepo(trackId: TrackId, path: string, remoteUrl?: string): TrackRepo;
  removeRepo(repoId: RepoId): boolean;
  findReposByTrack(trackId: TrackId): TrackRepo[];

  // Path associations
  addPath(trackId: TrackId, path: string, label?: string): TrackPath;
  removePath(pathId: PathId): boolean;
  findPathsByTrack(trackId: TrackId): TrackPath[];
}
