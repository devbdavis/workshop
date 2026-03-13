import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

const testDbPath = path.join(os.tmpdir(), `workshop-test-wf-engine-${randomUUID()}.db`);
process.env.WORKSHOP_DB_PATH = testDbPath;

import {
  createWorkflowTicketRepository,
  createWorkflowTransitionRepository,
} from '@infrastructure/persistence/workflow-repository';
import { createTicketDependencyRepository } from '@infrastructure/persistence/workflow-dependency-repository';
import { createWorkflowEngine } from '@application/workflow/engine';
import { resetDatabase } from '@infrastructure/persistence/database';
import type { WorkflowTicketId } from '@foundation/types';

describe('WorkflowEngine', () => {
  const tickets = createWorkflowTicketRepository();
  const transitions = createWorkflowTransitionRepository();
  const dependencies = createTicketDependencyRepository();
  const engine = createWorkflowEngine({ tickets, transitions, dependencies });

  afterAll(() => {
    resetDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  describe('createEpic', () => {
    it('should create an epic and auto-transition to triaging', () => {
      const epic = engine.createEpic({
        title: 'Test epic',
        description: 'A test',
      });

      expect(epic.type).toBe('epic');
      expect(epic.state).toBe('triaging');
      expect(epic.title).toBe('Test epic');
    });

    it('should record the auto-transition in audit log', () => {
      const epic = engine.createEpic({ title: 'Audit test', description: 'X' });
      const history = transitions.findByTicket(epic.id);
      expect(history.length).toBeGreaterThanOrEqual(1);
      const autoTransition = history.find(
        (t) => t.fromState === 'idea' && t.toState === 'triaging',
      );
      expect(autoTransition).toBeDefined();
      expect(autoTransition!.actor.type).toBe('system');
    });

    it('should use default provider and priority', () => {
      const epic = engine.createEpic({ title: 'Defaults', description: 'X' });
      expect(epic.provider).toBe('claude');
      expect(epic.priority).toBe('medium');
    });

    it('should accept custom provider and priority', () => {
      const epic = engine.createEpic({
        title: 'Custom',
        description: 'X',
        provider: 'codex',
        priority: 'critical',
      });
      expect(epic.provider).toBe('codex');
      expect(epic.priority).toBe('critical');
    });
  });

  describe('createTask', () => {
    it('should create a task in ready state when no deps', () => {
      const epic = engine.createEpic({ title: 'Parent', description: 'X' });
      const task = engine.createTask({
        title: 'Task 1',
        description: 'Implement it',
        parentId: epic.id,
      });

      expect(task.type).toBe('task');
      expect(task.state).toBe('ready');
      expect(task.parentId).toBe(epic.id);
    });

    it('should create a task in blocked state when deps exist', () => {
      const epic = engine.createEpic({ title: 'Parent', description: 'X' });
      const t1 = engine.createTask({
        title: 'Task A',
        description: 'First',
        parentId: epic.id,
      });
      const t2 = engine.createTask({
        title: 'Task B',
        description: 'Depends on A',
        parentId: epic.id,
        dependsOn: [t1.id],
      });

      expect(t2.state).toBe('blocked');
      const deps = dependencies.findByTicket(t2.id);
      expect(deps).toHaveLength(1);
      expect(deps[0].dependsOnId).toBe(t1.id);
    });
  });

  describe('transition', () => {
    it('should transition a ticket to a valid state', () => {
      const epic = engine.createEpic({ title: 'Trans test', description: 'X' });
      // epic is in triaging, transition to specced
      const updated = engine.transition(
        epic.id,
        'specced',
        { type: 'agent', agentId: 'triage-1' },
        'Spec complete',
      );
      expect(updated.state).toBe('specced');
    });

    it('should throw on invalid transition', () => {
      const epic = engine.createEpic({ title: 'Invalid', description: 'X' });
      expect(() =>
        engine.transition(epic.id, 'merged', { type: 'human' }),
      ).toThrow(/Invalid transition/);
    });

    it('should throw for non-existent ticket', () => {
      expect(() =>
        engine.transition('nonexistent' as WorkflowTicketId, 'triaging', { type: 'human' }),
      ).toThrow(/Ticket not found/);
    });

    it('should record transition in audit log', () => {
      const epic = engine.createEpic({ title: 'Audit', description: 'X' });
      engine.transition(epic.id, 'specced', { type: 'agent' }, 'Done');
      const history = transitions.findByTicket(epic.id);
      const specTransition = history.find((t) => t.toState === 'specced');
      expect(specTransition).toBeDefined();
      expect(specTransition!.comment).toBe('Done');
    });

    it('should allow cancellation from any non-terminal state', () => {
      const epic = engine.createEpic({ title: 'Cancel me', description: 'X' });
      const cancelled = engine.transition(
        epic.id,
        'cancelled',
        { type: 'human' },
        'Abandoned',
      );
      expect(cancelled.state).toBe('cancelled');
    });
  });

  describe('approve', () => {
    it('should approve at spec-review gate', () => {
      const epic = engine.createEpic({ title: 'Approve test', description: 'X' });
      engine.transition(epic.id, 'specced', { type: 'agent' });
      engine.transition(epic.id, 'spec-review', { type: 'system', reason: 'auto' });

      const approved = engine.approve(epic.id, 'Looks good');
      expect(approved.state).toBe('planning');
    });

    it('should approve at plan-review gate', () => {
      const epic = engine.createEpic({ title: 'Plan approve', description: 'X' });
      engine.transition(epic.id, 'specced', { type: 'agent' });
      engine.transition(epic.id, 'spec-review', { type: 'system', reason: 'auto' });
      engine.transition(epic.id, 'planning', { type: 'human' });
      engine.transition(epic.id, 'plan-critique', { type: 'agent' });
      engine.transition(epic.id, 'plan-review', { type: 'agent' });

      const approved = engine.approve(epic.id);
      expect(approved.state).toBe('splitting');
    });

    it('should throw when not at a human gate', () => {
      const epic = engine.createEpic({ title: 'Not gate', description: 'X' });
      expect(() => engine.approve(epic.id)).toThrow(/not at a human gate/);
    });
  });

  describe('reject', () => {
    it('should reject at spec-review and go back to triaging', () => {
      const epic = engine.createEpic({ title: 'Reject test', description: 'X' });
      engine.transition(epic.id, 'specced', { type: 'agent' });
      engine.transition(epic.id, 'spec-review', { type: 'system', reason: 'auto' });

      const rejected = engine.reject(epic.id, 'Needs more detail');
      expect(rejected.state).toBe('triaging');
    });

    it('should reject at plan-review and go back to planning', () => {
      const epic = engine.createEpic({ title: 'Plan reject', description: 'X' });
      engine.transition(epic.id, 'specced', { type: 'agent' });
      engine.transition(epic.id, 'spec-review', { type: 'system', reason: 'auto' });
      engine.transition(epic.id, 'planning', { type: 'human' });
      engine.transition(epic.id, 'plan-critique', { type: 'agent' });
      engine.transition(epic.id, 'plan-review', { type: 'agent' });

      const rejected = engine.reject(epic.id, 'Missing error handling');
      expect(rejected.state).toBe('planning');
    });

    it('should throw when not at a human gate', () => {
      const epic = engine.createEpic({ title: 'Not gate reject', description: 'X' });
      expect(() => engine.reject(epic.id)).toThrow(/not at a human gate/);
    });
  });

  describe('onTaskCompleted', () => {
    it('should resolve dependencies and unblock tasks', () => {
      const epic = engine.createEpic({ title: 'Dep test', description: 'X' });
      const t1 = engine.createTask({ title: 'A', description: 'First', parentId: epic.id });
      const t2 = engine.createTask({
        title: 'B',
        description: 'Depends on A',
        parentId: epic.id,
        dependsOn: [t1.id],
      });

      expect(t2.state).toBe('blocked');

      // Simulate t1 completing
      tickets.update(t1.id, { state: 'done' });
      engine.onTaskCompleted(t1.id);

      const updatedT2 = tickets.findById(t2.id);
      expect(updatedT2!.state).toBe('ready');
    });

    it('should not unblock when other deps still pending', () => {
      const epic = engine.createEpic({ title: 'Multi dep', description: 'X' });
      const t1 = engine.createTask({ title: 'A', description: 'X', parentId: epic.id });
      const t2 = engine.createTask({ title: 'B', description: 'X', parentId: epic.id });
      const t3 = engine.createTask({
        title: 'C',
        description: 'Depends on A and B',
        parentId: epic.id,
        dependsOn: [t1.id, t2.id],
      });

      expect(t3.state).toBe('blocked');

      // Complete only t1
      tickets.update(t1.id, { state: 'done' });
      engine.onTaskCompleted(t1.id);

      const stillBlocked = tickets.findById(t3.id);
      expect(stillBlocked!.state).toBe('blocked');

      // Complete t2
      tickets.update(t2.id, { state: 'done' });
      engine.onTaskCompleted(t2.id);

      const nowReady = tickets.findById(t3.id);
      expect(nowReady!.state).toBe('ready');
    });

    it('should advance epic to integration-review when all tasks done', () => {
      const epic = engine.createEpic({ title: 'All done', description: 'X' });
      // Move epic through the pipeline to in-progress
      engine.transition(epic.id, 'specced', { type: 'agent' });
      engine.transition(epic.id, 'spec-review', { type: 'system', reason: 'auto' });
      engine.transition(epic.id, 'planning', { type: 'human' });
      engine.transition(epic.id, 'plan-critique', { type: 'agent' });
      engine.transition(epic.id, 'plan-review', { type: 'agent' });
      engine.transition(epic.id, 'splitting', { type: 'human' });
      engine.transition(epic.id, 'in-progress', { type: 'agent' });

      const t1 = engine.createTask({ title: 'T1', description: 'X', parentId: epic.id });
      const t2 = engine.createTask({ title: 'T2', description: 'X', parentId: epic.id });

      // Complete both tasks
      tickets.update(t1.id, { state: 'done' });
      engine.onTaskCompleted(t1.id);

      // Epic should still be in-progress
      expect(tickets.findById(epic.id)!.state).toBe('in-progress');

      tickets.update(t2.id, { state: 'done' });
      engine.onTaskCompleted(t2.id);

      // Now epic should advance
      expect(tickets.findById(epic.id)!.state).toBe('integration-review');
    });

    it('should be a no-op for non-done tasks', () => {
      const epic = engine.createEpic({ title: 'No-op', description: 'X' });
      const task = engine.createTask({ title: 'WIP', description: 'X', parentId: epic.id });
      // Task is in 'ready', not 'done'
      engine.onTaskCompleted(task.id); // Should not throw
    });
  });
});
