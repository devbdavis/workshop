import type { Todo, TodoId, TodoStatus, TrackId, SessionId } from '@foundation/types';

export interface TodoRepository {
  findById(id: TodoId): Todo | null;
  findByTrack(trackId: TrackId): Todo[];
  findAll(): Todo[];
  findByStatus(status: TodoStatus): Todo[];
  findBySession(sessionId: SessionId): Todo | null;
  create(todo: Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>): Todo;
  update(
    id: TodoId,
    data: Partial<Pick<Todo, 'title' | 'description' | 'status' | 'priority' | 'refined' | 'sessionId' | 'agentId' | 'sortOrder'>>,
  ): Todo | null;
  delete(id: TodoId): boolean;
}
