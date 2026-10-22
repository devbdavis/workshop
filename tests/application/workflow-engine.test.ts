import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

const testDbPath = path.join(os.tmpdir(), `workshop-test-wf-engine-${randomUUID()}.db`);
process.env.WORKSHOP_DB_PATH = testDbPath;

import {
  createWorkflowIssueRepository,
  createWorkflowTransitionRepository,
} from '@infrastructure/persistence/workflow-repository';
import { createIssueDependencyRepository } from '@infrastructure/persistence/workflow-dependency-repository';
import { createWorkflowEngine } from '@application/workflow/engine';
import { resetDatabase } from '@infrastructure/persistence/database';
import type { WorkflowIssueId, WorkflowIssue } from '@foundation/types';
import type { TopologyLoader } from '@application/workflow/topology-loader';
import type { StageDefinition } from '@domain/workflow/types';

// ---------------------------------------------------------------------------
// Mock topology loader matching the old static EPIC_STAGES and TASK_STAGES
// ---------------------------------------------------------------------------

const EPIC_STAGES: StageDefinition[] = [
  { state: 'idea', semanticRole: 'entry', agentActionable: false, humanGate: false, validTransitions: [{ to: 'triaging', trigger: 'auto' }] },
  { state: 'triaging', semanticRole: 'processing', agentActionable: true, humanGate: false, agentRoleId: 'triage', validTransitions: [
    { to: 'needs-input', trigger: 'agent-complete' },
    { to: 'specced', trigger: 'agent-complete' },
    { to: 'cancelled', trigger: 'manual' },
  ]},
  { state: 'needs-input', semanticRole: 'waiting', agentActionable: false, humanGate: false, validTransitions: [
    { to: 'triaging', trigger: 'manual' },
    { to: 'cancelled', trigger: 'manual' },
  ]},
  { state: 'specced', semanticRole: 'processing', agentActionable: false, humanGate: false, validTransitions: [{ to: 'spec-review', trigger: 'auto' }] },
  { state: 'spec-review', semanticRole: 'human-gate', agentActionable: false, humanGate: true, validTransitions: [
    { to: 'planning', trigger: 'human-approve' },
    { to: 'triaging', trigger: 'human-reject' },
    { to: 'cancelled', trigger: 'manual' },
  ]},
  { state: 'planning', semanticRole: 'processing', agentActionable: true, humanGate: false, agentRoleId: 'planner', validTransitions: [
    { to: 'plan-critique', trigger: 'agent-complete' },
    { to: 'cancelled', trigger: 'manual' },
  ]},
  { state: 'plan-critique', semanticRole: 'processing', agentActionable: true, humanGate: false, agentRoleId: 'plan-critic', validTransitions: [
    { to: 'plan-review', trigger: 'agent-complete' },
    { to: 'planning', trigger: 'agent-complete' },
    { to: 'cancelled', trigger: 'manual' },
  ]},
  { state: 'plan-review', semanticRole: 'human-gate', agentActionable: false, humanGate: true, validTransitions: [
    { to: 'executing', trigger: 'human-approve' },
    { to: 'planning', trigger: 'human-reject' },
    { to: 'cancelled', trigger: 'manual' },
  ]},
  { state: 'executing', semanticRole: 'processing', agentActionable: true, humanGate: false, validTransitions: [
    { to: 'integration-review', trigger: 'execution-complete' },
    { to: 'execution-failed', trigger: 'execution-failed' },
    { to: 'cancelled', trigger: 'manual' },
  ]},
  { state: 'execution-failed', semanticRole: 'error', agentActionable: false, humanGate: false, validTransitions: [
    { to: 'executing', trigger: 'manual' },
    { to: 'planning', trigger: 'manual' },
    { to: 'cancelled', trigger: 'manual' },
  ]},
  { state: 'splitting', semanticRole: 'processing', agentActionable: true, humanGate: false, agentRoleId: 'splitter', validTransitions: [
    { to: 'in-progress', trigger: 'agent-complete' },
    { to: 'cancelled', trigger: 'manual' },
  ]},
  { state: 'in-progress', semanticRole: 'waiting', agentActionable: false, humanGate: false, validTransitions: [
    { to: 'integration-review', trigger: 'all-tasks-done' },
    { to: 'cancelled', trigger: 'manual' },
  ]},
  { state: 'integration-review', semanticRole: 'processing', agentActionable: true, humanGate: false, agentRoleId: 'integration-reviewer', validTransitions: [
    { to: 'final-review', trigger: 'agent-complete' },
    { to: 'integration-fix', trigger: 'agent-complete' },
    { to: 'cancelled', trigger: 'manual' },
  ]},
  { state: 'integration-fix', semanticRole: 'processing', agentActionable: true, humanGate: false, agentRoleId: 'fixer', validTransitions: [
    { to: 'integration-review', trigger: 'agent-complete' },
    { to: 'cancelled', trigger: 'manual' },
  ]},
  { state: 'final-review', semanticRole: 'human-gate', agentActionable: false, humanGate: true, validTransitions: [
    { to: 'approved', trigger: 'human-approve' },
    { to: 'integration-fix', trigger: 'human-reject' },
    { to: 'cancelled', trigger: 'manual' },
  ]},
  { state: 'approved', semanticRole: 'processing', agentActionable: false, humanGate: false, validTransitions: [{ to: 'merged', trigger: 'auto' }] },
  { state: 'merged', semanticRole: 'terminal', agentActionable: false, humanGate: false, validTransitions: [] },
  { state: 'cancelled', semanticRole: 'terminal', agentActionable: false, humanGate: false, validTransitions: [] },
];

const TASK_STAGES: StageDefinition[] = [
  { state: 'blocked', semanticRole: 'waiting', agentActionable: false, humanGate: false, validTransitions: [
    { to: 'ready', trigger: 'all-deps-resolved' },
    { to: 'cancelled', trigger: 'manual' },
  ]},
  { state: 'ready', semanticRole: 'processing', agentActionable: true, humanGate: false, agentRoleId: 'implementer', validTransitions: [{ to: 'in-progress', trigger: 'auto' }] },
  { state: 'in-progress', semanticRole: 'processing', agentActionable: true, humanGate: false, agentRoleId: 'implementer', validTransitions: [
    { to: 'code-review', trigger: 'agent-complete' },
    { to: 'cancelled', trigger: 'manual' },
  ]},
  { state: 'code-review', semanticRole: 'processing', agentActionable: true, humanGate: false, agentRoleId: 'code-reviewer', validTransitions: [
    { to: 'done', trigger: 'agent-complete' },
    { to: 'changes-requested', trigger: 'agent-complete' },
    { to: 'cancelled', trigger: 'manual' },
  ]},
  { state: 'changes-requested', semanticRole: 'processing', agentActionable: true, humanGate: false, agentRoleId: 'implementer', validTransitions: [{ to: 'in-progress', trigger: 'auto' }] },
  { state: 'done', semanticRole: 'terminal', agentActionable: false, humanGate: false, validTransitions: [] },
  { state: 'cancelled', semanticRole: 'terminal', agentActionable: false, humanGate: false, validTransitions: [] },
];

function createMockTopologyLoader(): TopologyLoader {
  return {
    loadForIssue(issue: WorkflowIssue): StageDefinition[] {
      if (issue.type === 'epic') return EPIC_STAGES;
      return TASK_STAGES;
    },
    loadByTemplateRowId(_rowId: string): StageDefinition[] {
      return EPIC_STAGES; // default to epic for template loads
    },
    loadTemplateForIssue(_issue: WorkflowIssue) {
      return null;
    },
    clearCache() {},
  };
}

describe('WorkflowEngine', () => {
  const issues = createWorkflowIssueRepository();
  const transitions = createWorkflowTransitionRepository();
  const dependencies = createIssueDependencyRepository();
  const topologyLoader = createMockTopologyLoader();
  const engine = createWorkflowEngine({ issues, transitions, dependencies, topologyLoader });

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
      const history = transitions.findByIssue(epic.id);
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
      const deps = dependencies.findByIssue(t2.id);
      expect(deps).toHaveLength(1);
      expect(deps[0].dependsOnId).toBe(t1.id);
    });
  });

  describe('transition', () => {
    it('should transition an issue to a valid state', () => {
      const epic = engine.createEpic({ title: 'Trans test', description: 'X' });
      // epic is in triaging, transition to specced (auto-transitions to spec-review)
      const updated = engine.transition(
        epic.id,
        'specced',
        { type: 'agent', agentId: 'triage-1' },
        'Spec complete',
      );
      expect(updated.state).toBe('spec-review');
    });

    it('should throw on invalid transition', () => {
      const epic = engine.createEpic({ title: 'Invalid', description: 'X' });
      expect(() =>
        engine.transition(epic.id, 'merged', { type: 'human' }),
      ).toThrow(/Invalid transition/);
    });

    it('should throw for non-existent issue', () => {
      expect(() =>
        engine.transition('nonexistent' as WorkflowIssueId, 'triaging', { type: 'human' }),
      ).toThrow(/Issue not found/);
    });

    it('should record transition in audit log', () => {
      const epic = engine.createEpic({ title: 'Audit', description: 'X' });
      engine.transition(epic.id, 'specced', { type: 'agent' }, 'Done');
      const history = transitions.findByIssue(epic.id);
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
      // specced auto-transitions to spec-review
      engine.transition(epic.id, 'specced', { type: 'agent' });

      const approved = engine.approve(epic.id, 'Looks good');
      expect(approved.state).toBe('planning');
    });

    it('should approve at plan-review gate', () => {
      const epic = engine.createEpic({ title: 'Plan approve', description: 'X' });
      // specced auto-transitions to spec-review
      engine.transition(epic.id, 'specced', { type: 'agent' });
      engine.approve(epic.id); // spec-review -> planning
      engine.transition(epic.id, 'plan-critique', { type: 'agent' });
      engine.transition(epic.id, 'plan-review', { type: 'agent' });

      const approved = engine.approve(epic.id);
      expect(approved.state).toBe('executing');
    });

    it('should throw when not at a human gate', () => {
      const epic = engine.createEpic({ title: 'Not gate', description: 'X' });
      expect(() => engine.approve(epic.id)).toThrow(/not at a human gate/);
    });
  });

  describe('reject', () => {
    it('should reject at spec-review and go back to triaging', () => {
      const epic = engine.createEpic({ title: 'Reject test', description: 'X' });
      // specced auto-transitions to spec-review
      engine.transition(epic.id, 'specced', { type: 'agent' });

      const rejected = engine.reject(epic.id, 'Needs more detail');
      expect(rejected.state).toBe('triaging');
    });

    it('should reject at plan-review and go back to planning', () => {
      const epic = engine.createEpic({ title: 'Plan reject', description: 'X' });
      // specced auto-transitions to spec-review
      engine.transition(epic.id, 'specced', { type: 'agent' });
      engine.approve(epic.id); // spec-review -> planning
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
      issues.update(t1.id, { state: 'done' });
      engine.onTaskCompleted(t1.id);

      // ready auto-transitions to in-progress
      const updatedT2 = issues.findById(t2.id);
      expect(updatedT2!.state).toBe('in-progress');
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
      issues.update(t1.id, { state: 'done' });
      engine.onTaskCompleted(t1.id);

      const stillBlocked = issues.findById(t3.id);
      expect(stillBlocked!.state).toBe('blocked');

      // Complete t2
      issues.update(t2.id, { state: 'done' });
      engine.onTaskCompleted(t2.id);

      // ready auto-transitions to in-progress
      const nowReady = issues.findById(t3.id);
      expect(nowReady!.state).toBe('in-progress');
    });

    it('should advance epic to integration-review when all tasks done', () => {
      const epic = engine.createEpic({ title: 'All done', description: 'X' });
      // Move epic through the pipeline to in-progress
      // specced auto-transitions to spec-review
      engine.transition(epic.id, 'specced', { type: 'agent' });
      engine.approve(epic.id); // spec-review -> planning
      engine.transition(epic.id, 'plan-critique', { type: 'agent' });
      engine.transition(epic.id, 'plan-review', { type: 'agent' });
      engine.approve(epic.id); // plan-review -> executing
      // Place epic directly into in-progress (execution dispatcher handles this in prod)
      issues.update(epic.id, { state: 'in-progress' });

      const t1 = engine.createTask({ title: 'T1', description: 'X', parentId: epic.id });
      const t2 = engine.createTask({ title: 'T2', description: 'X', parentId: epic.id });

      // Complete both tasks
      issues.update(t1.id, { state: 'done' });
      engine.onTaskCompleted(t1.id);

      // Epic should still be in-progress
      expect(issues.findById(epic.id)!.state).toBe('in-progress');

      issues.update(t2.id, { state: 'done' });
      engine.onTaskCompleted(t2.id);

      // Now epic should advance
      expect(issues.findById(epic.id)!.state).toBe('integration-review');
    });

    it('should be a no-op for non-done tasks', () => {
      const epic = engine.createEpic({ title: 'No-op', description: 'X' });
      const task = engine.createTask({ title: 'WIP', description: 'X', parentId: epic.id });
      // Task is in 'ready', not 'done'
      engine.onTaskCompleted(task.id); // Should not throw
    });
  });
});
