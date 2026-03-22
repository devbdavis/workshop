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
    syncSessionStates: vi.fn().mockReturnValue({ cleaned: [] }),
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
  const engine = createWorkflowEngine({ tickets, transitions, dependencies });

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
      });

      const epic = engine.createEpic({ title: 'Wrong state', description: 'X' });
      await expect(dispatcher.dispatch(epic.id)).rejects.toThrow(/not in 'executing' state/);
    });
  });
});
