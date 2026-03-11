import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Set up isolated test database before any imports that use it
const testDbPath = path.join(os.tmpdir(), `workshop-test-todo-${randomUUID()}.db`);
process.env.WORKSHOP_DB_PATH = testDbPath;

import { createTodoRepository } from '@infrastructure/persistence/todo-repository';
import { createTrackRepository } from '@infrastructure/persistence/track-repository';
import { createSessionRepository } from '@infrastructure/persistence/session-repository';
import { resetDatabase } from '@infrastructure/persistence/database';
import type { TodoId, SessionId } from '@foundation/types';

describe('Todo Repository', () => {
  const todoRepo = createTodoRepository();
  const trackRepo = createTrackRepository();
  const sessionRepo = createSessionRepository();

  function createParentTrack(name?: string) {
    return trackRepo.create({ name: name || `Track-${randomUUID()}`, status: 'active' });
  }

  afterAll(() => {
    resetDatabase();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('create', () => {
    it('should create a todo with required fields', () => {
      const track = createParentTrack();
      const todo = todoRepo.create({
        trackId: track.id,
        title: 'Fix the bug',
        status: 'backlog',
        priority: 'medium',
        refined: false,
        sortOrder: 0,
      });

      expect(todo).toBeDefined();
      expect(todo.id).toBeDefined();
      expect(todo.trackId).toBe(track.id);
      expect(todo.title).toBe('Fix the bug');
      expect(todo.status).toBe('backlog');
      expect(todo.priority).toBe('medium');
      expect(todo.refined).toBe(false);
      expect(todo.createdAt).toBeDefined();
      expect(todo.updatedAt).toBeDefined();
    });

    it('should create a todo with description', () => {
      const track = createParentTrack();
      const todo = todoRepo.create({
        trackId: track.id,
        title: 'Add feature',
        description: 'Implement the new dashboard widget',
        status: 'ready',
        priority: 'high',
        refined: true,
        sortOrder: 1,
      });

      expect(todo.description).toBe('Implement the new dashboard widget');
      expect(todo.priority).toBe('high');
      expect(todo.refined).toBe(true);
      expect(todo.sortOrder).toBe(1);
    });

    it('should generate unique IDs', () => {
      const track = createParentTrack();
      const t1 = todoRepo.create({
        trackId: track.id,
        title: 'Todo 1',
        status: 'backlog',
        priority: 'medium',
        refined: false,
        sortOrder: 0,
      });
      const t2 = todoRepo.create({
        trackId: track.id,
        title: 'Todo 2',
        status: 'backlog',
        priority: 'medium',
        refined: false,
        sortOrder: 0,
      });

      expect(t1.id).not.toBe(t2.id);
    });
  });

  describe('findById', () => {
    it('should find a todo by its ID', () => {
      const track = createParentTrack();
      const created = todoRepo.create({
        trackId: track.id,
        title: 'Find me',
        status: 'backlog',
        priority: 'low',
        refined: false,
        sortOrder: 0,
      });

      const found = todoRepo.findById(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.title).toBe('Find me');
    });

    it('should return null for non-existent todo', () => {
      const found = todoRepo.findById('non-existent' as TodoId);
      expect(found).toBeNull();
    });
  });

  describe('findByTrack', () => {
    it('should find all todos for a track', () => {
      const track = createParentTrack();
      todoRepo.create({
        trackId: track.id,
        title: 'Track Todo 1',
        status: 'backlog',
        priority: 'medium',
        refined: false,
        sortOrder: 0,
      });
      todoRepo.create({
        trackId: track.id,
        title: 'Track Todo 2',
        status: 'ready',
        priority: 'high',
        refined: true,
        sortOrder: 1,
      });

      const todos = todoRepo.findByTrack(track.id);
      expect(todos).toHaveLength(2);
      expect(todos.every((t) => t.trackId === track.id)).toBe(true);
    });

    it('should not include todos from other tracks', () => {
      const track1 = createParentTrack('Todo Track 1');
      const track2 = createParentTrack('Todo Track 2');
      todoRepo.create({
        trackId: track1.id,
        title: 'T1 Todo',
        status: 'backlog',
        priority: 'medium',
        refined: false,
        sortOrder: 0,
      });
      todoRepo.create({
        trackId: track2.id,
        title: 'T2 Todo',
        status: 'backlog',
        priority: 'medium',
        refined: false,
        sortOrder: 0,
      });

      const todos = todoRepo.findByTrack(track1.id);
      expect(todos).toHaveLength(1);
      expect(todos[0].trackId).toBe(track1.id);
    });
  });

  describe('findByStatus', () => {
    it('should find todos by status', () => {
      const track = createParentTrack();
      todoRepo.create({
        trackId: track.id,
        title: 'Status test ready',
        status: 'review',
        priority: 'medium',
        refined: false,
        sortOrder: 0,
      });

      const reviewTodos = todoRepo.findByStatus('review');
      expect(reviewTodos.length).toBeGreaterThanOrEqual(1);
      expect(reviewTodos.every((t) => t.status === 'review')).toBe(true);
    });
  });

  describe('findAll', () => {
    it('should return all todos', () => {
      const all = todoRepo.findAll();
      expect(all.length).toBeGreaterThan(0);
    });
  });

  describe('update', () => {
    it('should update todo title', () => {
      const track = createParentTrack();
      const todo = todoRepo.create({
        trackId: track.id,
        title: 'Original',
        status: 'backlog',
        priority: 'medium',
        refined: false,
        sortOrder: 0,
      });

      const updated = todoRepo.update(todo.id, { title: 'Updated' });

      expect(updated).not.toBeNull();
      expect(updated!.title).toBe('Updated');
      expect(updated!.updatedAt).not.toBe(todo.updatedAt);
    });

    it('should update todo status and priority', () => {
      const track = createParentTrack();
      const todo = todoRepo.create({
        trackId: track.id,
        title: 'Status test',
        status: 'backlog',
        priority: 'low',
        refined: false,
        sortOrder: 0,
      });

      const updated = todoRepo.update(todo.id, { status: 'in-progress', priority: 'high' });

      expect(updated!.status).toBe('in-progress');
      expect(updated!.priority).toBe('high');
    });

    it('should update refined flag', () => {
      const track = createParentTrack();
      const todo = todoRepo.create({
        trackId: track.id,
        title: 'Refine me',
        status: 'backlog',
        priority: 'medium',
        refined: false,
        sortOrder: 0,
      });

      const updated = todoRepo.update(todo.id, { refined: true });
      expect(updated!.refined).toBe(true);
    });

    it('should preserve existing fields when updating partially', () => {
      const track = createParentTrack();
      const todo = todoRepo.create({
        trackId: track.id,
        title: 'Partial update',
        description: 'Keep this',
        status: 'backlog',
        priority: 'high',
        refined: true,
        sortOrder: 5,
      });

      const updated = todoRepo.update(todo.id, { status: 'ready' });

      expect(updated!.title).toBe('Partial update');
      expect(updated!.description).toBe('Keep this');
      expect(updated!.priority).toBe('high');
      expect(updated!.refined).toBe(true);
      expect(updated!.sortOrder).toBe(5);
    });

    it('should return null when updating non-existent todo', () => {
      const result = todoRepo.update('non-existent' as TodoId, { title: 'Nope' });
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete a todo and return true', () => {
      const track = createParentTrack();
      const todo = todoRepo.create({
        trackId: track.id,
        title: 'Delete me',
        status: 'backlog',
        priority: 'medium',
        refined: false,
        sortOrder: 0,
      });

      const result = todoRepo.delete(todo.id);
      expect(result).toBe(true);
      expect(todoRepo.findById(todo.id)).toBeNull();
    });

    it('should return false when deleting non-existent todo', () => {
      const result = todoRepo.delete('non-existent' as TodoId);
      expect(result).toBe(false);
    });
  });

  describe('cascade delete', () => {
    it('should delete todos when parent track is deleted', () => {
      const track = createParentTrack('Cascade Track');
      const todo = todoRepo.create({
        trackId: track.id,
        title: 'Cascade todo',
        status: 'backlog',
        priority: 'medium',
        refined: false,
        sortOrder: 0,
      });

      trackRepo.delete(track.id);

      expect(todoRepo.findById(todo.id)).toBeNull();
    });
  });

  describe('session relationship', () => {
    it('should set session_id to null when session is deleted', () => {
      const track = createParentTrack('Session Track');
      const session = sessionRepo.create({
        trackId: track.id,
        tmuxSession: `test-session-${randomUUID()}`,
        state: 'active',
      });

      const todo = todoRepo.create({
        trackId: track.id,
        title: 'Session todo',
        status: 'in-progress',
        priority: 'medium',
        refined: true,
        sessionId: session.id,
        sortOrder: 0,
      });

      expect(todo.sessionId).toBe(session.id);

      sessionRepo.delete(session.id);

      const found = todoRepo.findById(todo.id);
      expect(found).not.toBeNull();
      expect(found!.sessionId).toBeUndefined();
    });

    it('should find a todo by session ID', () => {
      const track = createParentTrack('FindBySession Track');
      const session = sessionRepo.create({
        trackId: track.id,
        tmuxSession: `test-session-find-${randomUUID()}`,
        state: 'active',
      });

      todoRepo.create({
        trackId: track.id,
        title: 'Session find todo',
        status: 'in-progress',
        priority: 'medium',
        refined: true,
        sessionId: session.id,
        sortOrder: 0,
      });

      const found = todoRepo.findBySession(session.id);
      expect(found).not.toBeNull();
      expect(found!.sessionId).toBe(session.id);
    });

    it('should return null for non-existent session lookup', () => {
      const found = todoRepo.findBySession('non-existent' as SessionId);
      expect(found).toBeNull();
    });
  });
});
