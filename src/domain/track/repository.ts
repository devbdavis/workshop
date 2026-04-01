import type { Track, TrackId, TrackRepo, TrackPath, RepoId, PathId, AgentId, TemplateId, TerminalLayout, GlobalRepoId } from '@foundation/types';

export interface TrackRepository {
  findAll(): Track[];
  findById(id: TrackId): Track | null;
  findByMatrixRoomId(roomId: string): Track | null;
  create(track: Omit<Track, 'id' | 'createdAt' | 'updatedAt' | 'repos' | 'paths' | 'tickets'>): Track;
  update(id: TrackId, data: Partial<Pick<Track, 'name' | 'description' | 'context' | 'label' | 'matrixRoomId' | 'status' | 'worktreeMode' | 'defaultAgentId'>>): Track | null;
  delete(id: TrackId): boolean;

  // Prompt template association
  setDefaultPromptTemplate(trackId: TrackId, templateId: TemplateId | null): boolean;

  // Default agent association
  setDefaultAgent(trackId: TrackId, agentId: AgentId | null): boolean;

  // Terminal layout
  getTerminalLayout(trackId: TrackId): TerminalLayout | null;
  setTerminalLayout(trackId: TrackId, layout: TerminalLayout | null): boolean;

  // Repo associations
  addRepo(trackId: TrackId, path: string, remoteUrl?: string, repoId?: GlobalRepoId): TrackRepo;
  removeRepo(repoId: RepoId): boolean;
  findReposByTrack(trackId: TrackId): TrackRepo[];

  // Path associations
  addPath(trackId: TrackId, path: string, label?: string): TrackPath;
  removePath(pathId: PathId): boolean;
  findPathsByTrack(trackId: TrackId): TrackPath[];
}
