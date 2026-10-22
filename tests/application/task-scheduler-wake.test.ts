import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTaskScheduler, type TaskSchedulerDeps } from '@application/scheduler/task-scheduler';
import type { ScheduledTask, ScheduledTaskId } from '@foundation/types';

afterEach(() => vi.useRealTimers());

function setup() {
  const task = {
    id: 'task-1' as ScheduledTaskId, name: 'Diary', cronExpression: '0 7 * * *', provider: 'claude',
    taskPrompt: 'do it', enabled: true, runCount: 0, createdAt: '2026-10-01T00:00:00',
    lastRunAt: new Date('2026-10-21T07:00:05').toISOString(),
  } as ScheduledTask;
  const createSession = vi.fn(async () => ({ id: 's1', trackId: 'tr', tmuxSession: 'x', state: 'ok' }));
  const deps = {
    tasks: { findEnabled: () => [task], findById: () => task, update: vi.fn() },
    runs: { create: (r: object) => ({ id: 'r', ...r }) },
    tracks: { findAll: () => [{ id: 'tr', name: '_Scheduled Tasks' }], findById: () => null },
    terminal: { createSession },
    broadcast: () => {},
  } as unknown as TaskSchedulerDeps;
  return { scheduler: createTaskScheduler(deps), createSession };
}

describe('task scheduler wake catch-up', () => {
  it('fires an occurrence that fell inside a system sleep once the wall clock jumps', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-21T23:00:00'));
    const { scheduler, createSession } = setup();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(createSession).not.toHaveBeenCalled();

    // Asleep overnight: timers freeze, wall clock moves past 07:00.
    vi.setSystemTime(new Date('2026-10-22T09:00:00'));
    await vi.advanceTimersByTimeAsync(70_000);
    expect(createSession).toHaveBeenCalledOnce();
    scheduler.stop();
  });
});
