import { describe, it, expect, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

const testDbPath = path.join(os.tmpdir(), `workshop-test-dispatch-coordinator-${randomUUID()}.db`);
process.env.WORKSHOP_DB_PATH = testDbPath;

import {
  createWorkflowIssueRepository,
  createWorkflowTransitionRepository,
} from '@infrastructure/persistence/workflow-repository';
import { createIssueDependencyRepository } from '@infrastructure/persistence/workflow-dependency-repository';
import { createWorkflowEngine } from '@application/workflow/engine';
import { createDispatchCoordinator } from '@application/workflow/dispatch-coordinator';
import { resetDatabase } from '@infrastructure/persistence/database';
import type { WorkflowIssue } from '@foundation/types';
import type { TopologyLoader } from '@application/workflow/topology-loader';
import type { StageDefinition } from '@domain/workflow/types';
import type { AgentDispatcher } from '@application/workflow/agent-dispatcher';
import type { ExecutionDispatcher } from '@application/workflow/execution-dispatcher';

// ---------------------------------------------------------------------------
// Mock topology: entry -> human-gate -> processing -> merge-gate (not auto-approvable)
// plus a human-gate whose approve target is terminal, for the "never into merged/done" guard.
// ---------------------------------------------------------------------------

const STAGES: StageDefinition[] = [
  { state: 'idea', semanticRole: 'entry', agentActionable: false, humanGate: false, validTransitions: [
    { to: 'review-a', trigger: 'manual' },
    { to: 'merge-gate', trigger: 'manual' },
    { to: 'terminal-gate', trigger: 'manual' },
  ]},
  { state: 'review-a', semanticRole: 'human-gate', agentActionable: false, humanGate: true, validTransitions: [
    { to: 'mid', trigger: 'human-approve' },
    { to: 'idea', trigger: 'human-reject' },
  ]},
  { state: 'mid', semanticRole: 'processing', agentActionable: false, humanGate: false, validTransitions: [
    { to: 'merge-gate', trigger: 'manual' },
  ]},
  { state: 'merge-gate', semanticRole: 'human-gate', agentActionable: false, humanGate: true, autoApprovable: false, validTransitions: [
    { to: 'merged', trigger: 'human-approve' },
  ]},
  { state: 'merged', semanticRole: 'terminal', agentActionable: false, humanGate: false, validTransitions: [] },
  { state: 'terminal-gate', semanticRole: 'human-gate', agentActionable: false, humanGate: true, validTransitions: [
    { to: 'done', trigger: 'human-approve' },
  ]},
  { state: 'done', semanticRole: 'terminal', agentActionable: false, humanGate: false, validTransitions: [] },
];

function createMockTopologyLoader(): TopologyLoader {
  return {
    loadForIssue(_issue: WorkflowIssue): StageDefinition[] {
      return STAGES;
    },
    loadByPlaybookRowId(_rowId: string): StageDefinition[] {
      return STAGES;
    },
    loadPlaybookForIssue(_issue: WorkflowIssue) {
      return null;
    },
    clearCache(): void {},
  };
}

function createMockAgentDispatcher(): AgentDispatcher {
  return { onTransition: vi.fn().mockResolvedValue(undefined) };
}

function createMockExecutionDispatcher(): ExecutionDispatcher {
  return {
    approveWithExecution: vi.fn(),
    dispatch: vi.fn(),
  } as unknown as ExecutionDispatcher;
}

describe('DispatchCoordinator — Dark Factory auto-advance', () => {
  const issues = createWorkflowIssueRepository();
  const transitions = createWorkflowTransitionRepository();
  const dependencies = createIssueDependencyRepository();
  const topologyLoader = createMockTopologyLoader();
  const engine = createWorkflowEngine({ issues, transitions, dependencies, topologyLoader });
  const coordinator = createDispatchCoordinator({
    engine,
    issues,
    executionDispatcher: createMockExecutionDispatcher(),
    agentDispatcher: createMockAgentDispatcher(),
    topologyLoader,
  });

  afterAll(() => {
    resetDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  function createAutonomousEpic(): WorkflowIssue {
    const epic = engine.createEpic({ title: 'Dark epic', description: 'x' });
    return issues.update(epic.id, { stateData: { ...(epic.stateData || {}), autonomous: true } })!;
  }

  it('auto-advances an autonomous issue past an auto-approvable human gate', async () => {
    const epic = createAutonomousEpic();
    engine.transition(epic.id, 'review-a', { type: 'human' });

    await coordinator.dispatchForCurrentState(epic.id);

    const final = issues.findById(epic.id)!;
    expect(final.state).toBe('mid');
  });

  it('does not auto-approve a merge gate marked autoApprovable:false', async () => {
    const epic = createAutonomousEpic();
    engine.transition(epic.id, 'merge-gate', { type: 'human' });

    await coordinator.dispatchForCurrentState(epic.id);

    const final = issues.findById(epic.id)!;
    expect(final.state).toBe('merge-gate');
  });

  it('does not auto-approve a gate whose approve-target is terminal', async () => {
    const epic = createAutonomousEpic();
    engine.transition(epic.id, 'terminal-gate', { type: 'human' });

    await coordinator.dispatchForCurrentState(epic.id);

    const final = issues.findById(epic.id)!;
    expect(final.state).toBe('terminal-gate');
  });

  it('does not auto-approve when needsHuman is true', async () => {
    const epic = createAutonomousEpic();
    engine.transition(epic.id, 'review-a', { type: 'human' });
    const current = issues.findById(epic.id)!;
    issues.update(epic.id, { stateData: { ...(current.stateData || {}), needsHuman: true } });

    await coordinator.dispatchForCurrentState(epic.id);

    const final = issues.findById(epic.id)!;
    expect(final.state).toBe('review-a');
  });

  it('leaves a non-autonomous issue untouched at a human gate (regression)', async () => {
    const epic = engine.createEpic({ title: 'Manual epic', description: 'x' });
    engine.transition(epic.id, 'review-a', { type: 'human' });

    await coordinator.dispatchForCurrentState(epic.id);

    const final = issues.findById(epic.id)!;
    expect(final.state).toBe('review-a');
  });

  // --- Usage pacing gate (separate coordinator wired with a usageGate) ---

  const gate = { over: true };
  const onPaused = vi.fn().mockResolvedValue(undefined);
  const pacingCoordinator = createDispatchCoordinator({
    engine,
    issues,
    executionDispatcher: createMockExecutionDispatcher(),
    agentDispatcher: createMockAgentDispatcher(),
    topologyLoader,
    usageGate: () => ({ over: gate.over, resumeAt: '2999-01-01T00:00:00Z' }),
    onPaused,
  });

  function autonomousEpic(): WorkflowIssue {
    // Stays at 'idea' (entry, non-gate) — the usage gate fires for any autonomous issue.
    const epic = engine.createEpic({ title: 'Dark epic', description: 'x' });
    return issues.update(epic.id, { stateData: { ...(epic.stateData || {}), autonomous: true } })!;
  }

  it('pauses an over-threshold autonomous issue instead of dispatching', async () => {
    gate.over = true;
    onPaused.mockClear();
    const epic = autonomousEpic();

    await pacingCoordinator.dispatchForCurrentState(epic.id);

    const final = issues.findById(epic.id)!;
    expect(final.stateData?.paused).toBe(true);
    expect(final.stateData?.pausedUntil).toBe('2999-01-01T00:00:00Z');
    expect(onPaused).toHaveBeenCalledWith(epic.id, '2999-01-01T00:00:00Z');
  });

  it('does not pause an autonomous issue when under threshold', async () => {
    gate.over = false;
    const epic = autonomousEpic();

    await pacingCoordinator.dispatchForCurrentState(epic.id);

    expect(issues.findById(epic.id)!.stateData?.paused).not.toBe(true);
  });

  it('never pauses a non-autonomous issue even when over threshold', async () => {
    gate.over = true;
    const epic = engine.createEpic({ title: 'Manual epic', description: 'x' });

    await pacingCoordinator.dispatchForCurrentState(epic.id);

    expect(issues.findById(epic.id)!.stateData?.paused).not.toBe(true);
  });
});
