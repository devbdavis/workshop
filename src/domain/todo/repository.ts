import type { Todo, TodoId, TodoStatus, TrackId, SessionId } from '@foundation/types';

export type TodoUpdateData = Partial<Pick<Todo, 'title' | 'description' | 'status' | 'priority' | 'refined' | 'sortOrder'>> & {
  /** Pass null to explicitly clear the session assignment. */
  sessionId?: Todo['sessionId'] | null;
  /** Pass null to explicitly clear the agent assignment. */
  agentId?: Todo['agentId'] | null;
};

export interface TodoRepository {
  findById(id: TodoId): Todo | null;
  findByTrack(trackId: TrackId): Todo[];
  findAll(): Todo[];
  findByStatus(status: TodoStatus): Todo[];
  findBySession(sessionId: SessionId): Todo | null;
  create(todo: Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>): Todo;
  update(id: TodoId, data: TodoUpdateData): Todo | null;
  delete(id: TodoId): boolean;
}
