import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

const testDbPath = path.join(os.tmpdir(), `workshop-test-dep-resolver-${randomUUID()}.db`);
process.env.WORKSHOP_DB_PATH = testDbPath;

import {
  createWorkflowTicketRepository,
} from '@infrastructure/persistence/workflow-repository';
import { createTicketDependencyRepository } from '@infrastructure/persistence/workflow-dependency-repository';
import { createDependencyResolver } from '@application/workflow/dependency-resolver';
import { resetDatabase } from '@infrastructure/persistence/database';
import type { WorkflowTicketId } from '@foundation/types';

describe('DependencyResolver', () => {
  const tickets = createWorkflowTicketRepository();
  const dependencies = createTicketDependencyRepository();
  const resolver = createDependencyResolver({ tickets, dependencies });

  afterAll(() => {
    resetDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  function createEpic(title = 'Test Epic') {
    return tickets.create({
      type: 'epic',
      title,
      description: 'Test',
      state: 'in-progress',
      provider: 'claude',
      priority: 'medium',
      sortOrder: 0,
    });
  }

  function createTask(parentId: WorkflowTicketId, title: string, state = 'ready' as const) {
    return tickets.create({
      type: 'task',
      title,
      description: 'Test task',
      state,
      parentId,
      provider: 'claude',
      priority: 'medium',
      sortOrder: 0,
    });
  }

  describe('allResolved', () => {
    it('should return true when no dependencies exist', () => {
      const epic = createEpic();
      const task = createTask(epic.id, 'No deps');
      expect(resolver.allResolved(task.id)).toBe(true);
    });

    it('should return false when unresolved dependencies exist', () => {
      const epic = createEpic();
      const t1 = createTask(epic.id, 'Dep A');
      const t2 = createTask(epic.id, 'Depends on A', 'blocked');
      dependencies.create(t2.id, t1.id);

      expect(resolver.allResolved(t2.id)).toBe(false);
    });

    it('should return true after all dependencies are resolved', () => {
      const epic = createEpic();
      const t1 = createTask(epic.id, 'Dep X');
      const t2 = createTask(epic.id, 'Depends on X', 'blocked');
      dependencies.create(t2.id, t1.id);

      // Resolve the dependency
      dependencies.resolve(t2.id, t1.id);

      expect(resolver.allResolved(t2.id)).toBe(true);
    });

    it('should return false when only some dependencies are resolved', () => {
      const epic = createEpic();
      const t1 = createTask(epic.id, 'First');
      const t2 = createTask(epic.id, 'Second');
      const t3 = createTask(epic.id, 'Both', 'blocked');
      dependencies.create(t3.id, t1.id);
      dependencies.create(t3.id, t2.id);

      // Resolve only one
      dependencies.resolve(t3.id, t1.id);

      expect(resolver.allResolved(t3.id)).toBe(false);
    });
  });

  describe('resolveAndUnblock', () => {
    it('should return empty array when no dependents exist', () => {
      const epic = createEpic();
      const task = createTask(epic.id, 'Standalone');

      const unblocked = resolver.resolveAndUnblock(task.id);
      expect(unblocked).toEqual([]);
    });

    it('should return unblocked ticket when single dependency is resolved', () => {
      const epic = createEpic();
      const t1 = createTask(epic.id, 'Dep');
      const t2 = createTask(epic.id, 'Blocked', 'blocked');
      dependencies.create(t2.id, t1.id);

      const unblocked = resolver.resolveAndUnblock(t1.id);
      expect(unblocked).toContain(t2.id);
    });

    it('should not return ticket that is not in blocked state', () => {
      const epic = createEpic();
      const t1 = createTask(epic.id, 'Dep R');
      const t2 = createTask(epic.id, 'Ready', 'ready'); // Not blocked!
      dependencies.create(t2.id, t1.id);

      const unblocked = resolver.resolveAndUnblock(t1.id);
      expect(unblocked).not.toContain(t2.id);
    });

    it('should not unblock when other dependencies remain', () => {
      const epic = createEpic();
      const t1 = createTask(epic.id, 'A');
      const t2 = createTask(epic.id, 'B');
      const t3 = createTask(epic.id, 'Multi-dep', 'blocked');
      dependencies.create(t3.id, t1.id);
      dependencies.create(t3.id, t2.id);

      // Complete only t1
      const unblocked = resolver.resolveAndUnblock(t1.id);
      expect(unblocked).not.toContain(t3.id);
    });

    it('should unblock after all dependencies are resolved sequentially', () => {
      const epic = createEpic();
      const t1 = createTask(epic.id, 'First dep');
      const t2 = createTask(epic.id, 'Second dep');
      const t3 = createTask(epic.id, 'Waits for both', 'blocked');
      dependencies.create(t3.id, t1.id);
      dependencies.create(t3.id, t2.id);

      const firstUnblock = resolver.resolveAndUnblock(t1.id);
      expect(firstUnblock).not.toContain(t3.id);

      const secondUnblock = resolver.resolveAndUnblock(t2.id);
      expect(secondUnblock).toContain(t3.id);
    });

    it('should unblock multiple dependents from a single completion', () => {
      const epic = createEpic();
      const blocker = createTask(epic.id, 'Shared blocker');
      const dep1 = createTask(epic.id, 'Waiter 1', 'blocked');
      const dep2 = createTask(epic.id, 'Waiter 2', 'blocked');
      dependencies.create(dep1.id, blocker.id);
      dependencies.create(dep2.id, blocker.id);

      const unblocked = resolver.resolveAndUnblock(blocker.id);
      expect(unblocked).toContain(dep1.id);
      expect(unblocked).toContain(dep2.id);
    });
  });

  describe('allChildrenDone', () => {
    it('should return false when epic has no children', () => {
      const epic = createEpic('Empty epic');
      expect(resolver.allChildrenDone(epic.id)).toBe(false);
    });

    it('should return true when all children are done', () => {
      const epic = createEpic('All done');
      createTask(epic.id, 'Done 1', 'done' as any);
      createTask(epic.id, 'Done 2', 'done' as any);

      expect(resolver.allChildrenDone(epic.id)).toBe(true);
    });

    it('should return true when children are mix of done and cancelled', () => {
      const epic = createEpic('Mix');
      createTask(epic.id, 'Done', 'done' as any);
      createTask(epic.id, 'Cancelled', 'cancelled' as any);

      expect(resolver.allChildrenDone(epic.id)).toBe(true);
    });

    it('should return false when some children are still in-progress', () => {
      const epic = createEpic('Partial');
      createTask(epic.id, 'Done', 'done' as any);
      createTask(epic.id, 'Still going', 'in-progress' as any);

      expect(resolver.allChildrenDone(epic.id)).toBe(false);
    });

    it('should return false when some children are blocked', () => {
      const epic = createEpic('Blocked child');
      createTask(epic.id, 'Done', 'done' as any);
      createTask(epic.id, 'Waiting', 'blocked');

      expect(resolver.allChildrenDone(epic.id)).toBe(false);
    });

    it('should return false when some children are ready but not started', () => {
      const epic = createEpic('Ready child');
      createTask(epic.id, 'Done', 'done' as any);
      createTask(epic.id, 'Ready', 'ready');

      expect(resolver.allChildrenDone(epic.id)).toBe(false);
    });
  });
});
