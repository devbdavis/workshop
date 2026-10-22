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
  return { scheduler: createTaskScheduler(deps), createSession, task };
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

describe('task scheduler catch-up dedupe', () => {
  it('skips a queued catch-up once the occurrence has already run', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-22T09:00:00'));
    const { scheduler, createSession, task } = setup();
    scheduler.start(); // queues a catch-up for 07:00 in 5s
    task.lastRunAt = new Date('2026-10-22T09:00:01').toISOString(); // e.g. a cron fire landed first
    await vi.advanceTimersByTimeAsync(10_000);
    expect(createSession).not.toHaveBeenCalled();
    scheduler.stop();
  });
});
