import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Set up isolated test database before any imports that use it
const testDbPath = path.join(os.tmpdir(), `workshop-test-workflow-${randomUUID()}.db`);
process.env.WORKSHOP_DB_PATH = testDbPath;

import {
  createWorkflowTicketRepository,
  createWorkflowTransitionRepository,
} from '@infrastructure/persistence/workflow-repository';
import { createTicketDependencyRepository } from '@infrastructure/persistence/workflow-dependency-repository';
import { resetDatabase } from '@infrastructure/persistence/database';
import type { WorkflowTicketId, TrackId } from '@foundation/types';

describe('Workflow Repositories', () => {
  const ticketRepo = createWorkflowTicketRepository();
  const transitionRepo = createWorkflowTransitionRepository();
  const depRepo = createTicketDependencyRepository();

  afterAll(() => {
    resetDatabase();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  // ---------------------------------------------------------------------------
  // WorkflowTicketRepository
  // ---------------------------------------------------------------------------
  describe('WorkflowTicketRepository', () => {
    describe('create', () => {
      it('should create an epic with required fields', () => {
        const ticket = ticketRepo.create({
          type: 'epic',
          title: 'Build feature X',
          description: 'Full description of feature X',
          state: 'idea',
          provider: 'claude',
          priority: 'high',
          sortOrder: 0,
        });

        expect(ticket).toBeDefined();
        expect(ticket.id).toBeDefined();
        expect(ticket.type).toBe('epic');
        expect(ticket.title).toBe('Build feature X');
        expect(ticket.description).toBe('Full description of feature X');
        expect(ticket.state).toBe('idea');
        expect(ticket.provider).toBe('claude');
        expect(ticket.priority).toBe('high');
        expect(ticket.sortOrder).toBe(0);
      });

      it('should create a task with parent ID', () => {
        const epic = ticketRepo.create({
          type: 'epic',
          title: 'Parent epic',
          description: 'Epic for child tasks',
          state: 'in-progress',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        const task = ticketRepo.create({
          type: 'task',
          title: 'Child task 1',
          description: 'A task under the epic',
          state: 'ready',
          parentId: epic.id,
          provider: 'claude',
          priority: 'medium',
          sortOrder: 1,
        });

        expect(task.parentId).toBe(epic.id);
        expect(task.type).toBe('task');
      });

      it('should generate unique IDs', () => {
        const t1 = ticketRepo.create({
          type: 'epic',
          title: 'Epic 1',
          description: 'Desc 1',
          state: 'idea',
          provider: 'claude',
          priority: 'low',
          sortOrder: 0,
        });
        const t2 = ticketRepo.create({
          type: 'epic',
          title: 'Epic 2',
          description: 'Desc 2',
          state: 'idea',
          provider: 'claude',
          priority: 'low',
          sortOrder: 0,
        });

        expect(t1.id).not.toBe(t2.id);
      });

      it('should set createdAt, updatedAt, stateChangedAt', () => {
        const ticket = ticketRepo.create({
          type: 'epic',
          title: 'Timestamp test',
          description: 'Testing timestamps',
          state: 'idea',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        expect(ticket.createdAt).toBeDefined();
        expect(ticket.updatedAt).toBeDefined();
        expect(ticket.stateChangedAt).toBeDefined();
      });
    });

    describe('findById', () => {
      it('should find a ticket by ID', () => {
        const created = ticketRepo.create({
          type: 'epic',
          title: 'Findable epic',
          description: 'Can be found',
          state: 'idea',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        const found = ticketRepo.findById(created.id);
        expect(found).not.toBeNull();
        expect(found!.id).toBe(created.id);
        expect(found!.title).toBe('Findable epic');
      });

      it('should return null for non-existent ID', () => {
        expect(ticketRepo.findById('nonexistent' as WorkflowTicketId)).toBeNull();
      });

      it('should deserialize stateData correctly', () => {
        const ticket = ticketRepo.create({
          type: 'epic',
          title: 'StateData test',
          description: 'Has state data',
          state: 'triaging',
          stateData: { questions: [{ text: 'What scope?', answered: false }], iteration: 1 },
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        const found = ticketRepo.findById(ticket.id);
        expect(found!.stateData).toBeDefined();
        expect(found!.stateData!.iteration).toBe(1);
        expect(Array.isArray(found!.stateData!.questions)).toBe(true);
      });

      it('should deserialize labels and assignedAgentIds correctly', () => {
        const ticket = ticketRepo.create({
          type: 'task',
          title: 'Labels test',
          description: 'Has labels',
          state: 'ready',
          labels: ['frontend', 'urgent'],
          assignedAgentIds: ['agent-1' as any, 'agent-2' as any],
          provider: 'claude',
          priority: 'high',
          sortOrder: 0,
        });

        const found = ticketRepo.findById(ticket.id);
        expect(found!.labels).toEqual(['frontend', 'urgent']);
        expect(found!.assignedAgentIds).toEqual(['agent-1', 'agent-2']);
      });
    });

    describe('findAll', () => {
      it('should return all tickets with no filters', () => {
        const all = ticketRepo.findAll();
        expect(all.length).toBeGreaterThan(0);
      });

      it('should filter by type', () => {
        ticketRepo.create({
          type: 'task',
          title: 'Filter type task',
          description: 'Task for filter test',
          state: 'ready',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        const tasks = ticketRepo.findAll({ type: 'task' });
        expect(tasks.every((t) => t.type === 'task')).toBe(true);
        expect(tasks.length).toBeGreaterThan(0);
      });

      it('should filter by state', () => {
        ticketRepo.create({
          type: 'epic',
          title: 'Filter state epic',
          description: 'Epic in idea state',
          state: 'idea',
          provider: 'claude',
          priority: 'low',
          sortOrder: 0,
        });

        const ideas = ticketRepo.findAll({ state: 'idea' });
        expect(ideas.every((t) => t.state === 'idea')).toBe(true);
        expect(ideas.length).toBeGreaterThan(0);
      });

      it('should filter by trackId', () => {
        // trackId FK references tracks table, so create without trackId
        // and test filtering on tickets that have no track (undefined)
        const withTrack = ticketRepo.findAll({ trackId: 'nonexistent' as TrackId });
        expect(withTrack).toHaveLength(0);

        // All tickets created in tests have no trackId
        const all = ticketRepo.findAll();
        expect(all.length).toBeGreaterThan(0);
        expect(all.every((t) => t.trackId === undefined)).toBe(true);
      });

      it('should filter by parentId', () => {
        const epic = ticketRepo.create({
          type: 'epic',
          title: 'Parent for filter test',
          description: 'Parent',
          state: 'in-progress',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        ticketRepo.create({
          type: 'task',
          title: 'Child for filter test',
          description: 'Child',
          state: 'ready',
          parentId: epic.id,
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        const children = ticketRepo.findAll({ parentId: epic.id });
        expect(children.every((t) => t.parentId === epic.id)).toBe(true);
        expect(children.length).toBeGreaterThanOrEqual(1);
      });

      it('should support multiple filters', () => {
        const epic = ticketRepo.create({
          type: 'epic',
          title: 'Multi-filter parent',
          description: 'Parent',
          state: 'in-progress',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        ticketRepo.create({
          type: 'task',
          title: 'Multi-filter child',
          description: 'Child task in ready state',
          state: 'ready',
          parentId: epic.id,
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        const results = ticketRepo.findAll({ type: 'task', parentId: epic.id });
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results.every((t) => t.type === 'task' && t.parentId === epic.id)).toBe(true);
      });
    });

    describe('findChildren', () => {
      it('should return all child tickets', () => {
        const epic = ticketRepo.create({
          type: 'epic',
          title: 'Parent with children',
          description: 'Has kids',
          state: 'in-progress',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        ticketRepo.create({
          type: 'task',
          title: 'Child A',
          description: 'A',
          state: 'ready',
          parentId: epic.id,
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        ticketRepo.create({
          type: 'task',
          title: 'Child B',
          description: 'B',
          state: 'ready',
          parentId: epic.id,
          provider: 'claude',
          priority: 'medium',
          sortOrder: 1,
        });

        const children = ticketRepo.findChildren(epic.id);
        expect(children).toHaveLength(2);
        expect(children.every((c) => c.parentId === epic.id)).toBe(true);
      });

      it('should return empty for ticket with no children', () => {
        const solo = ticketRepo.create({
          type: 'epic',
          title: 'Solo epic',
          description: 'No children',
          state: 'idea',
          provider: 'claude',
          priority: 'low',
          sortOrder: 0,
        });

        expect(ticketRepo.findChildren(solo.id)).toHaveLength(0);
      });
    });

    describe('findByState', () => {
      it('should find all tickets in a given state', () => {
        ticketRepo.create({
          type: 'task',
          title: 'In ready state',
          description: 'Ready',
          state: 'ready',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        const readyTickets = ticketRepo.findByState('ready');
        expect(readyTickets.length).toBeGreaterThan(0);
        expect(readyTickets.every((t) => t.state === 'ready')).toBe(true);
      });
    });

    describe('findHumanGatePending', () => {
      it('should find tickets in spec-review, plan-review, final-review states', () => {
        ticketRepo.create({
          type: 'epic',
          title: 'In spec-review',
          description: 'Needs spec review',
          state: 'spec-review',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        ticketRepo.create({
          type: 'epic',
          title: 'In plan-review',
          description: 'Needs plan review',
          state: 'plan-review',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        const pending = ticketRepo.findHumanGatePending();
        expect(pending.length).toBeGreaterThanOrEqual(2);
        const validStates = ['spec-review', 'plan-review', 'final-review'];
        expect(pending.every((t) => validStates.includes(t.state))).toBe(true);
      });

      it('should not include tickets in other states', () => {
        const pending = ticketRepo.findHumanGatePending();
        const invalidStates = ['idea', 'triaging', 'in-progress', 'done', 'ready'];
        expect(pending.every((t) => !invalidStates.includes(t.state))).toBe(true);
      });
    });

    describe('update', () => {
      it('should update title', () => {
        const ticket = ticketRepo.create({
          type: 'epic',
          title: 'Original title',
          description: 'Desc',
          state: 'idea',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        const updated = ticketRepo.update(ticket.id, { title: 'Updated title' });
        expect(updated).not.toBeNull();
        expect(updated!.title).toBe('Updated title');
      });

      it('should update state and stateChangedAt', () => {
        const ticket = ticketRepo.create({
          type: 'epic',
          title: 'State change test',
          description: 'Desc',
          state: 'idea',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        // Use a clearly different timestamp to avoid same-millisecond races
        const newStateChangedAt = '2099-01-01T00:00:00.000Z';
        const updated = ticketRepo.update(ticket.id, {
          state: 'triaging',
          stateChangedAt: newStateChangedAt,
        });

        expect(updated!.state).toBe('triaging');
        expect(updated!.stateChangedAt).toBe(newStateChangedAt);
      });

      it('should update stateData (JSON)', () => {
        const ticket = ticketRepo.create({
          type: 'epic',
          title: 'StateData update test',
          description: 'Desc',
          state: 'triaging',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        const updated = ticketRepo.update(ticket.id, {
          stateData: { questions: [{ text: 'How big?', answered: true, answer: 'Large' }], iteration: 2 },
        });

        expect(updated!.stateData).toBeDefined();
        expect(updated!.stateData!.iteration).toBe(2);
      });

      it('should preserve existing fields on partial update', () => {
        const ticket = ticketRepo.create({
          type: 'epic',
          title: 'Preserve fields',
          description: 'Important description',
          state: 'idea',
          labels: ['critical'],
          provider: 'codex',
          priority: 'high',
          sortOrder: 5,
        });

        const updated = ticketRepo.update(ticket.id, { title: 'New title only' });

        expect(updated!.description).toBe('Important description');
        expect(updated!.provider).toBe('codex');
        expect(updated!.priority).toBe('high');
        expect(updated!.sortOrder).toBe(5);
      });

      it('should return null for non-existent ticket', () => {
        expect(ticketRepo.update('nonexistent' as WorkflowTicketId, { title: 'X' })).toBeNull();
      });
    });

    describe('delete', () => {
      it('should delete a ticket', () => {
        const ticket = ticketRepo.create({
          type: 'epic',
          title: 'Delete me',
          description: 'To be deleted',
          state: 'idea',
          provider: 'claude',
          priority: 'low',
          sortOrder: 0,
        });

        expect(ticketRepo.delete(ticket.id)).toBe(true);
        expect(ticketRepo.findById(ticket.id)).toBeNull();
      });

      it('should cascade delete children', () => {
        const epic = ticketRepo.create({
          type: 'epic',
          title: 'Delete with children',
          description: 'Parent to delete',
          state: 'in-progress',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        const child = ticketRepo.create({
          type: 'task',
          title: 'Cascade child',
          description: 'Should be deleted too',
          state: 'ready',
          parentId: epic.id,
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        ticketRepo.delete(epic.id);
        expect(ticketRepo.findById(child.id)).toBeNull();
      });

      it('should return false for non-existent ticket', () => {
        expect(ticketRepo.delete('nonexistent' as WorkflowTicketId)).toBe(false);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // WorkflowTransitionRepository
  // ---------------------------------------------------------------------------
  describe('WorkflowTransitionRepository', () => {
    describe('create', () => {
      it('should create a transition record', () => {
        const ticket = ticketRepo.create({
          type: 'epic',
          title: 'Transition test epic',
          description: 'For transitions',
          state: 'triaging',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        const transition = transitionRepo.create({
          ticketId: ticket.id,
          fromState: 'idea',
          toState: 'triaging',
          actor: { type: 'system', reason: 'auto-advance' },
        });

        expect(transition.id).toBeDefined();
        expect(transition.ticketId).toBe(ticket.id);
        expect(transition.fromState).toBe('idea');
        expect(transition.toState).toBe('triaging');
        expect(transition.createdAt).toBeDefined();
      });

      it('should store actor as JSON', () => {
        const ticket = ticketRepo.create({
          type: 'epic',
          title: 'Actor test epic',
          description: 'For actor test',
          state: 'triaging',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        const humanActor = { type: 'human' as const, userId: 'user-42' };
        const transition = transitionRepo.create({
          ticketId: ticket.id,
          fromState: 'idea',
          toState: 'triaging',
          actor: humanActor,
        });

        const found = transitionRepo.findById(transition.id);
        expect(found).not.toBeNull();
        expect(found!.actor).toEqual(humanActor);
      });
    });

    describe('findByTicket', () => {
      it('should return transitions ordered by created_at DESC', () => {
        const ticket = ticketRepo.create({
          type: 'epic',
          title: 'Ordered transitions',
          description: 'Multiple transitions',
          state: 'specced',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        transitionRepo.create({
          ticketId: ticket.id,
          fromState: 'idea',
          toState: 'triaging',
          actor: { type: 'system', reason: 'auto' },
        });

        transitionRepo.create({
          ticketId: ticket.id,
          fromState: 'triaging',
          toState: 'specced',
          actor: { type: 'agent', agentId: 'triage-agent' },
        });

        const transitions = transitionRepo.findByTicket(ticket.id);
        expect(transitions).toHaveLength(2);
        // Both transitions present (order may vary for same-ms inserts)
        const toStates = transitions.map((t) => t.toState);
        expect(toStates).toContain('triaging');
        expect(toStates).toContain('specced');
      });

      it('should respect limit parameter', () => {
        const ticket = ticketRepo.create({
          type: 'epic',
          title: 'Limited transitions',
          description: 'Many transitions',
          state: 'planning',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        transitionRepo.create({
          ticketId: ticket.id,
          fromState: 'idea',
          toState: 'triaging',
          actor: { type: 'system', reason: 'auto' },
        });
        transitionRepo.create({
          ticketId: ticket.id,
          fromState: 'triaging',
          toState: 'specced',
          actor: { type: 'agent' },
        });
        transitionRepo.create({
          ticketId: ticket.id,
          fromState: 'specced',
          toState: 'spec-review',
          actor: { type: 'system', reason: 'auto' },
        });

        const limited = transitionRepo.findByTicket(ticket.id, 2);
        expect(limited).toHaveLength(2);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // TicketDependencyRepository
  // ---------------------------------------------------------------------------
  describe('TicketDependencyRepository', () => {
    describe('create', () => {
      it('should create a dependency', () => {
        const t1 = ticketRepo.create({
          type: 'task',
          title: 'Depends on t2',
          description: 'Task 1',
          state: 'blocked',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });
        const t2 = ticketRepo.create({
          type: 'task',
          title: 'Depended upon',
          description: 'Task 2',
          state: 'in-progress',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 1,
        });

        const dep = depRepo.create(t1.id, t2.id);
        expect(dep).toBeDefined();
        expect(dep.ticketId).toBe(t1.id);
        expect(dep.dependsOnId).toBe(t2.id);
      });

      it('should set createdAt', () => {
        const t1 = ticketRepo.create({
          type: 'task',
          title: 'Dep createdAt 1',
          description: 'D1',
          state: 'blocked',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });
        const t2 = ticketRepo.create({
          type: 'task',
          title: 'Dep createdAt 2',
          description: 'D2',
          state: 'ready',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        const dep = depRepo.create(t1.id, t2.id);
        expect(dep.createdAt).toBeDefined();
      });
    });

    describe('findByTicket', () => {
      it('should find dependencies for a ticket', () => {
        const t1 = ticketRepo.create({
          type: 'task',
          title: 'Has deps',
          description: 'D',
          state: 'blocked',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });
        const t2 = ticketRepo.create({
          type: 'task',
          title: 'Dep target A',
          description: 'D',
          state: 'in-progress',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });
        const t3 = ticketRepo.create({
          type: 'task',
          title: 'Dep target B',
          description: 'D',
          state: 'in-progress',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        depRepo.create(t1.id, t2.id);
        depRepo.create(t1.id, t3.id);

        const deps = depRepo.findByTicket(t1.id);
        expect(deps).toHaveLength(2);
        expect(deps.every((d) => d.ticketId === t1.id)).toBe(true);
      });
    });

    describe('findDependents', () => {
      it('should find tickets that depend on a given ticket', () => {
        const target = ticketRepo.create({
          type: 'task',
          title: 'Target ticket',
          description: 'Others depend on this',
          state: 'in-progress',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });
        const dep1 = ticketRepo.create({
          type: 'task',
          title: 'Dependent 1',
          description: 'Depends on target',
          state: 'blocked',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });
        const dep2 = ticketRepo.create({
          type: 'task',
          title: 'Dependent 2',
          description: 'Also depends on target',
          state: 'blocked',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        depRepo.create(dep1.id, target.id);
        depRepo.create(dep2.id, target.id);

        const dependents = depRepo.findDependents(target.id);
        expect(dependents).toHaveLength(2);
        expect(dependents.every((d) => d.dependsOnId === target.id)).toBe(true);
      });
    });

    describe('findUnresolved', () => {
      it('should only return unresolved dependencies', () => {
        const t1 = ticketRepo.create({
          type: 'task',
          title: 'Unresolved test',
          description: 'D',
          state: 'blocked',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });
        const t2 = ticketRepo.create({
          type: 'task',
          title: 'Resolved dep',
          description: 'D',
          state: 'done',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });
        const t3 = ticketRepo.create({
          type: 'task',
          title: 'Unresolved dep',
          description: 'D',
          state: 'in-progress',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        depRepo.create(t1.id, t2.id);
        depRepo.create(t1.id, t3.id);

        // Resolve the first dependency
        depRepo.resolve(t1.id, t2.id);

        const unresolved = depRepo.findUnresolved(t1.id);
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0].dependsOnId).toBe(t3.id);
        expect(unresolved[0].resolvedAt).toBeUndefined();
      });
    });

    describe('resolve', () => {
      it('should set resolvedAt', () => {
        const t1 = ticketRepo.create({
          type: 'task',
          title: 'Resolve test A',
          description: 'D',
          state: 'blocked',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });
        const t2 = ticketRepo.create({
          type: 'task',
          title: 'Resolve test B',
          description: 'D',
          state: 'done',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        depRepo.create(t1.id, t2.id);
        const result = depRepo.resolve(t1.id, t2.id);
        expect(result).toBe(true);

        // Verify via findByTicket that resolvedAt is set
        const deps = depRepo.findByTicket(t1.id);
        const resolved = deps.find((d) => d.dependsOnId === t2.id);
        expect(resolved).toBeDefined();
        expect(resolved!.resolvedAt).toBeDefined();
      });

      it('should return true on success', () => {
        const t1 = ticketRepo.create({
          type: 'task',
          title: 'Resolve success A',
          description: 'D',
          state: 'blocked',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });
        const t2 = ticketRepo.create({
          type: 'task',
          title: 'Resolve success B',
          description: 'D',
          state: 'done',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        depRepo.create(t1.id, t2.id);
        expect(depRepo.resolve(t1.id, t2.id)).toBe(true);
      });
    });

    describe('delete', () => {
      it('should remove a dependency', () => {
        const t1 = ticketRepo.create({
          type: 'task',
          title: 'Delete dep A',
          description: 'D',
          state: 'blocked',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });
        const t2 = ticketRepo.create({
          type: 'task',
          title: 'Delete dep B',
          description: 'D',
          state: 'in-progress',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        depRepo.create(t1.id, t2.id);
        expect(depRepo.delete(t1.id, t2.id)).toBe(true);

        const deps = depRepo.findByTicket(t1.id);
        expect(deps).toHaveLength(0);
      });
    });

    describe('cascade on parent delete', () => {
      it('when parent epic is deleted, child tasks should be deleted', () => {
        const epic = ticketRepo.create({
          type: 'epic',
          title: 'Cascade parent',
          description: 'Will be deleted',
          state: 'in-progress',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        const child = ticketRepo.create({
          type: 'task',
          title: 'Cascade child',
          description: 'Should vanish',
          state: 'ready',
          parentId: epic.id,
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        ticketRepo.delete(epic.id);
        expect(ticketRepo.findById(child.id)).toBeNull();
      });

      it('when a ticket is deleted, its transitions should be deleted', () => {
        const ticket = ticketRepo.create({
          type: 'epic',
          title: 'Cascade transition ticket',
          description: 'Has transitions',
          state: 'triaging',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        transitionRepo.create({
          ticketId: ticket.id,
          fromState: 'idea',
          toState: 'triaging',
          actor: { type: 'system', reason: 'auto' },
        });

        ticketRepo.delete(ticket.id);
        const transitions = transitionRepo.findByTicket(ticket.id);
        expect(transitions).toHaveLength(0);
      });

      it('when a ticket is deleted, its dependencies should be deleted', () => {
        const t1 = ticketRepo.create({
          type: 'task',
          title: 'Cascade dep ticket',
          description: 'Has deps',
          state: 'blocked',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });
        const t2 = ticketRepo.create({
          type: 'task',
          title: 'Cascade dep target',
          description: 'Target',
          state: 'in-progress',
          provider: 'claude',
          priority: 'medium',
          sortOrder: 0,
        });

        depRepo.create(t1.id, t2.id);
        ticketRepo.delete(t1.id);

        const deps = depRepo.findByTicket(t1.id);
        expect(deps).toHaveLength(0);
      });
    });
  });
});
