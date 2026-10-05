import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createTaskScheduler, type TaskSchedulerDeps } from '@application/scheduler/task-scheduler';
import type { ScheduledTask, ScheduledTaskId, ScheduledTaskRun } from '@foundation/types';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'precheck-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function writeScript(name: string, body: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, body);
  return p;
}

function setup(task: Partial<ScheduledTask>) {
  const full = {
    id: 'task-1' as ScheduledTaskId, name: 't', scheduleConfig: { preset: 'daily' }, cronExpression: '0 9 * * *',
    scheduleDescription: '', provider: 'claude', taskPrompt: 'do it', enabled: true, runCount: 0,
    createdAt: '', updatedAt: '', ...task,
  } as ScheduledTask;
  const runs: ScheduledTaskRun[] = [];
  const createSession = vi.fn(async () => ({ id: 's1', trackId: 'tr', tmuxSession: 'x', state: 'ok' }));
  const update = vi.fn();
  const deps = {
    tasks: { findById: () => full, update },
    runs: { create: (r: Omit<ScheduledTaskRun, 'id'>) => { const run = { id: 'r', ...r }; runs.push(run); return run; } },
    tracks: { findAll: () => [{ id: 'tr', name: '_Scheduled Tasks' }], findById: () => null },
    terminal: { createSession },
    broadcast: () => {},
  } as unknown as TaskSchedulerDeps;
  return { scheduler: createTaskScheduler(deps), runs, createSession, update };
}

describe('scheduled task precheck', () => {
  it('skips the run and records it when the script exits non-zero with skipOnNonZero', async () => {
    const { scheduler, createSession, update } = setup({
      scriptPath: writeScript('fail.sh', 'echo nothing >&2; exit 1'), skipOnNonZero: true,
    });
    const run = await scheduler.triggerNow('task-1' as ScheduledTaskId);
    expect(run.status).toBe('skipped');
    expect(run.error).toBe('precheck exit 1: nothing');
    expect(createSession).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith('task-1', expect.objectContaining({ lastRunStatus: 'skipped' }));
  });

  it('still dispatches on non-zero exit when skipOnNonZero is off', async () => {
    const { scheduler, createSession } = setup({ scriptPath: writeScript('fail2.sh', 'exit 3') });
    const run = await scheduler.triggerNow('task-1' as ScheduledTaskId);
    expect(run.status).toBe('running');
    expect(createSession).toHaveBeenCalledOnce();
  });

  it('dispatches with script output on zero exit', async () => {
    const { scheduler, createSession } = setup({
      scriptPath: writeScript('ok.sh', 'echo 3 items'), skipOnNonZero: true,
    });
    await scheduler.triggerNow('task-1' as ScheduledTaskId);
    expect(createSession.mock.calls[0][1]).toMatchObject({ initialPrompt: expect.stringContaining('3 items') });
  });
});
