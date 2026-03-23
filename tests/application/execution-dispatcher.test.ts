import { describe, it, expect, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

const testDbPath = path.join(os.tmpdir(), `workshop-test-exec-dispatch-${randomUUID()}.db`);
process.env.WORKSHOP_DB_PATH = testDbPath;

import {
  createWorkflowTicketRepository,
  createWorkflowTransitionRepository,
} from '@infrastructure/persistence/workflow-repository';
import { createTicketDependencyRepository } from '@infrastructure/persistence/workflow-dependency-repository';
import { createTrackRepository } from '@infrastructure/persistence/track-repository';
import { createWorkflowEngine } from '@application/workflow/engine';
import { createExecutionDispatcher } from '@application/workflow/execution-dispatcher';
import { resetDatabase } from '@infrastructure/persistence/database';
import type { WorkflowTicket, SessionId, TrackId, Session } from '@foundation/types';
import type { TerminalManager } from '@infrastructure/terminal/manager';
import type { TrackRepository } from '@domain/track/repository';
import type { SummaryRepository } from '@domain/summary/repository';
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
    loadForTicket(ticket: WorkflowTicket): StageDefinition[] {
      if (ticket.type === 'epic') return EPIC_STAGES;
      return TASK_STAGES;
    },
    loadByTemplateRowId(_rowId: string): StageDefinition[] {
      return EPIC_STAGES; // default to epic for template loads
    },
    loadTemplateForTicket(_ticket: WorkflowTicket) {
      return null;
    },
    clearCache() {},
  };
}

function createMockTerminal(): TerminalManager {
  return {
    createSession: vi.fn().mockResolvedValue({
      id: `session-${randomUUID()}` as SessionId,
      trackId: 'track-1' as TrackId,
      tmuxSession: 'mock-tmux',
      state: 'active',
      provider: 'claude',
      background: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies Session),
    destroySession: vi.fn(),
    isSessionAlive: vi.fn().mockReturnValue(true),
    syncSessionStates: vi.fn().mockReturnValue({ cleaned: [], suspended: [], dying: [], activityChanged: [] }),
    resumeSuspendedSessions: vi.fn().mockResolvedValue([]),
    getLastActivityAt: vi.fn().mockReturnValue(undefined),
    isDying: vi.fn().mockReturnValue(false),
  };
}

function createMockTracks(): TrackRepository {
  return {
    findById: vi.fn().mockReturnValue({
      id: 'track-1' as TrackId,
      name: 'Test Track',
      context: 'Test project context',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    findReposByTrack: vi.fn().mockReturnValue([
      { id: 'repo-1', trackId: 'track-1', path: '/tmp/test-repo', createdAt: new Date().toISOString() },
    ]),
    findAll: vi.fn().mockReturnValue([]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    addRepo: vi.fn(),
    removeRepo: vi.fn(),
    findPathsByTrack: vi.fn().mockReturnValue([]),
    addPath: vi.fn(),
    removePath: vi.fn(),
    getTerminalLayout: vi.fn(),
    setTerminalLayout: vi.fn(),
    setDefaultPromptTemplate: vi.fn(),
  } as unknown as TrackRepository;
}

function createMockSummaries(): SummaryRepository {
  return {
    findLatest: vi.fn().mockReturnValue(null),
    findAll: vi.fn().mockReturnValue([]),
    create: vi.fn(),
  } as unknown as SummaryRepository;
}

describe('ExecutionDispatcher', () => {
  const trackRepo = createTrackRepository();
  const tickets = createWorkflowTicketRepository();
  const transitions = createWorkflowTransitionRepository();
  const dependencies = createTicketDependencyRepository();
  const topologyLoader = createMockTopologyLoader();
  const engine = createWorkflowEngine({ tickets, transitions, dependencies, topologyLoader });

  // Create a real track so FK constraints pass
  let testTrackId: TrackId;
  const track = trackRepo.create({ name: 'exec-test', status: 'active' });
  testTrackId = track.id;

  afterAll(() => {
    resetDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  function createEpicAtPlanReview(): WorkflowTicket {
    const epic = engine.createEpic({
      title: 'Test Execution',
      description: 'Test spec',
      trackId: testTrackId,
    });
    // specced auto-transitions to spec-review
    engine.transition(epic.id, 'specced', { type: 'agent' });
    engine.approve(epic.id); // spec-review -> planning
    engine.transition(epic.id, 'plan-critique', { type: 'agent' });
    engine.transition(epic.id, 'plan-review', { type: 'agent' });
    return tickets.findById(epic.id)!;
  }

  describe('approveWithExecution', () => {
    it('should approve and dispatch execution, binding session to ticket', async () => {
      const mockTerminal = createMockTerminal();
      const dispatcher = createExecutionDispatcher({
        engine,
        tickets,
        tracks: createMockTracks(),
        summaries: createMockSummaries(),
        terminal: mockTerminal,
        topologyLoader,
      });

      const epic = createEpicAtPlanReview();
      const result = await dispatcher.approveWithExecution(epic.id);

      expect(result.state).toBe('executing');
      expect(result.executionSessionId).toBeDefined();
      expect(mockTerminal.createSession).toHaveBeenCalledOnce();
    });

    it('should transition to execution-failed when dispatch fails', async () => {
      const mockTerminal = createMockTerminal();
      (mockTerminal.createSession as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('tmux not available'),
      );

      const dispatcher = createExecutionDispatcher({
        engine,
        tickets,
        tracks: createMockTracks(),
        summaries: createMockSummaries(),
        terminal: mockTerminal,
        topologyLoader,
      });

      const epic = createEpicAtPlanReview();
      const result = await dispatcher.approveWithExecution(epic.id);

      expect(result.state).toBe('execution-failed');
    });

    it('should pass through non-execution approvals unchanged', async () => {
      const dispatcher = createExecutionDispatcher({
        engine,
        tickets,
        tracks: createMockTracks(),
        summaries: createMockSummaries(),
        terminal: createMockTerminal(),
        topologyLoader,
      });

      // Create epic at spec-review (specced auto-transitions to spec-review)
      const epic = engine.createEpic({ title: 'Spec gate', description: 'X' });
      engine.transition(epic.id, 'specced', { type: 'agent' });

      const result = await dispatcher.approveWithExecution(epic.id);
      expect(result.state).toBe('planning');
    });

    it('should throw when no repos configured on track', async () => {
      const mockTracks = createMockTracks();
      (mockTracks.findReposByTrack as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const dispatcher = createExecutionDispatcher({
        engine,
        tickets,
        tracks: mockTracks,
        summaries: createMockSummaries(),
        terminal: createMockTerminal(),
        topologyLoader,
      });

      const epic = createEpicAtPlanReview();
      const result = await dispatcher.approveWithExecution(epic.id);

      // Should fail gracefully to execution-failed
      expect(result.state).toBe('execution-failed');
    });
  });

  describe('dispatch', () => {
    it('should throw if ticket is not in executing state', async () => {
      const dispatcher = createExecutionDispatcher({
        engine,
        tickets,
        tracks: createMockTracks(),
        summaries: createMockSummaries(),
        terminal: createMockTerminal(),
        topologyLoader,
      });

      const epic = engine.createEpic({ title: 'Wrong state', description: 'X' });
      await expect(dispatcher.dispatch(epic.id)).rejects.toThrow(/not in an execution stage/);
    });
  });
});
