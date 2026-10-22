import { describe, it, expect } from 'vitest';
import { createUsagePacingPoller } from '../../src/application/usage/usage-pacing-poller.js';
import type { WorkflowIssue } from '../../src/foundation/types.js';
import type { WorkflowIssueRepository } from '../../src/domain/workflow/issue-repository.js';
import type { UsageTracker } from '../../src/infrastructure/usage/usage-tracker.js';
import type { DispatchCoordinator } from '../../src/application/workflow/dispatch-coordinator.js';

function epic(id: string, sd: Record<string, unknown>): WorkflowIssue {
  return { id, type: 'epic', title: id, description: '', state: 'execute', stateData: sd, provider: 'claude', priority: 'medium', sortOrder: 0, stateChangedAt: '', createdAt: '', updatedAt: '' } as WorkflowIssue;
}

function harness(epics: WorkflowIssue[], over: boolean, nowMs: number) {
  const dispatched: string[] = [];
  const updated: Array<{ id: string; sd: Record<string, unknown> }> = [];
  const issues = {
    findAll: () => epics,
    update: (id: string, data: { stateData?: Record<string, unknown> }) => { updated.push({ id, sd: data.stateData ?? {} }); return epics.find((e) => e.id === id) ?? null; },
  } as unknown as WorkflowIssueRepository;
  const usageTracker = { isOverThreshold: () => over } as unknown as UsageTracker;
  const dispatcher = { dispatchForCurrentState: async (id: string) => { dispatched.push(id); } } as unknown as DispatchCoordinator;
  const poller = createUsagePacingPoller({ issues, usageTracker, dispatcher, now: () => nowMs });
  return { poller, dispatched, updated };
}

const PAST = '2026-07-31T00:00:00Z';
const FUTURE = '2999-01-01T00:00:00Z';

describe('usage-pacing-poller', () => {
  it('resumes a paused autonomous epic when past the floor and under threshold', async () => {
    const { poller, dispatched, updated } = harness([epic('e1', { autonomous: true, paused: true, pausedUntil: PAST })], false, Date.parse('2026-07-31T02:00:00Z'));
    await poller.tick();
    expect(dispatched).toEqual(['e1']);
    expect(updated[0].sd.paused).toBe(false);
  });

  it('does not resume while still within the pause floor', async () => {
    const { poller, dispatched } = harness([epic('e1', { autonomous: true, paused: true, pausedUntil: FUTURE })], false, Date.parse('2026-07-31T02:00:00Z'));
    await poller.tick();
    expect(dispatched).toEqual([]);
  });

  it('does not resume while usage is still over threshold', async () => {
    const { poller, dispatched } = harness([epic('e1', { autonomous: true, paused: true, pausedUntil: PAST })], true, Date.parse('2026-07-31T02:00:00Z'));
    await poller.tick();
    expect(dispatched).toEqual([]);
  });

  it('ignores non-autonomous or non-paused epics', async () => {
    const { poller, dispatched } = harness([
      epic('e1', { autonomous: true, paused: false }),
      epic('e2', { paused: true, pausedUntil: PAST }),
    ], false, Date.parse('2026-07-31T02:00:00Z'));
    await poller.tick();
    expect(dispatched).toEqual([]);
  });
});
