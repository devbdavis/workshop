import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Set up isolated test database before any imports that use it
const testDbPath = path.join(os.tmpdir(), `workshop-test-scheduled-task-${randomUUID()}.db`);
process.env.WORKSHOP_DB_PATH = testDbPath;

import {
  createScheduledTaskRepository,
  createScheduledTaskRunRepository,
} from '@infrastructure/persistence/scheduled-task-repository';
import { createTrackRepository } from '@infrastructure/persistence/track-repository';
import { resetDatabase } from '@infrastructure/persistence/database';
import type { ScheduledTaskId, ScheduleConfig } from '@foundation/types';

describe('Scheduled Task Repository', () => {
  const taskRepo = createScheduledTaskRepository();
  const runRepo = createScheduledTaskRunRepository();
  const trackRepo = createTrackRepository();

  function createTrack(name?: string) {
    return trackRepo.create({ name: name || `Track-${randomUUID()}`, status: 'active' });
  }

  const dailyConfig: ScheduleConfig = {
    preset: 'daily',
    time: '09:00',
    daysOfWeek: [1, 2, 3, 4, 5],
  };

  afterAll(() => {
    resetDatabase();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('create', () => {
    it('should create a task with required fields', () => {
      const task = taskRepo.create({
        name: 'Daily standup',
        scheduleConfig: dailyConfig,
        cronExpression: '0 9 * * 1,2,3,4,5',
        scheduleDescription: 'Weekdays at 09:00',
        provider: 'claude',
        taskPrompt: 'Summarize recent changes',
        enabled: true,
      });

      expect(task).toBeDefined();
      expect(task.id).toBeDefined();
      expect(task.name).toBe('Daily standup');
      expect(task.cronExpression).toBe('0 9 * * 1,2,3,4,5');
      expect(task.scheduleDescription).toBe('Weekdays at 09:00');
      expect(task.provider).toBe('claude');
      expect(task.taskPrompt).toBe('Summarize recent changes');
      expect(task.enabled).toBe(true);
      expect(task.runCount).toBe(0);
      expect(task.trackId).toBeUndefined();
      expect(task.agentId).toBeUndefined();
      expect(task.createdAt).toBeDefined();
    });

    it('should create a task bound to a track', () => {
      const track = createTrack();
      const task = taskRepo.create({
        name: 'Track-bound task',
        scheduleConfig: dailyConfig,
        cronExpression: '0 9 * * 1,2,3,4,5',
        scheduleDescription: 'Weekdays at 09:00',
        trackId: track.id,
        provider: 'claude',
        taskPrompt: 'Check track progress',
        enabled: true,
      });

      expect(task.trackId).toBe(track.id);
    });

    it('should create a task with all optional fields', () => {
      const track = createTrack();
      const task = taskRepo.create({
        name: 'Full task',
        description: 'A complete task',
        scheduleConfig: { preset: 'cron', cronExpression: '*/5 * * * *' },
        cronExpression: '*/5 * * * *',
        scheduleDescription: 'Cron: */5 * * * *',
        trackId: track.id,
        agentId: 'test-agent' as any,
        provider: 'codex',
        taskPrompt: 'Do the thing',
        systemPromptOverride: 'Custom prompt',
        enabled: false,
      });

      expect(task.description).toBe('A complete task');
      expect(task.agentId).toBe('test-agent');
      expect(task.provider).toBe('codex');
      expect(task.systemPromptOverride).toBe('Custom prompt');
      expect(task.enabled).toBe(false);
    });

    it('should generate unique IDs', () => {
      const t1 = taskRepo.create({
        name: 'Task 1',
        scheduleConfig: dailyConfig,
        cronExpression: '0 9 * * *',
        scheduleDescription: 'Daily at 09:00',
        provider: 'claude',
        taskPrompt: 'Prompt 1',
        enabled: true,
      });
      const t2 = taskRepo.create({
        name: 'Task 2',
        scheduleConfig: dailyConfig,
        cronExpression: '0 9 * * *',
        scheduleDescription: 'Daily at 09:00',
        provider: 'claude',
        taskPrompt: 'Prompt 2',
        enabled: true,
      });

      expect(t1.id).not.toBe(t2.id);
    });
  });

  describe('findById', () => {
    it('should find a task by ID', () => {
      const created = taskRepo.create({
        name: 'Findable',
        scheduleConfig: dailyConfig,
        cronExpression: '0 9 * * *',
        scheduleDescription: 'Daily at 09:00',
        provider: 'claude',
        taskPrompt: 'Test',
        enabled: true,
      });

      const found = taskRepo.findById(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe('Findable');
      expect(found!.scheduleConfig).toEqual(dailyConfig);
    });

    it('should return null for non-existent ID', () => {
      expect(taskRepo.findById('nope' as ScheduledTaskId)).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all tasks', () => {
      const all = taskRepo.findAll();
      expect(all.length).toBeGreaterThan(0);
    });
  });

  describe('findEnabled', () => {
    it('should only return enabled tasks', () => {
      const enabled = taskRepo.findEnabled();
      expect(enabled.every((t) => t.enabled)).toBe(true);
    });
  });

  describe('findByTrack', () => {
    it('should find tasks for a specific track', () => {
      const track = createTrack('Scheduled Track');
      taskRepo.create({
        name: 'Track task',
        scheduleConfig: dailyConfig,
        cronExpression: '0 9 * * *',
        scheduleDescription: 'Daily',
        trackId: track.id,
        provider: 'claude',
        taskPrompt: 'Test',
        enabled: true,
      });

      const found = taskRepo.findByTrack(track.id);
      expect(found.length).toBeGreaterThanOrEqual(1);
      expect(found.every((t) => t.trackId === track.id)).toBe(true);
    });

    it('should return empty for track with no tasks', () => {
      const track = createTrack('Empty track');
      expect(taskRepo.findByTrack(track.id)).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('should update task name', () => {
      const task = taskRepo.create({
        name: 'Original name',
        scheduleConfig: dailyConfig,
        cronExpression: '0 9 * * *',
        scheduleDescription: 'Daily',
        provider: 'claude',
        taskPrompt: 'Test',
        enabled: true,
      });

      const updated = taskRepo.update(task.id, { name: 'New name' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('New name');
      expect(updated!.taskPrompt).toBe('Test'); // preserved
    });

    it('should update enabled flag', () => {
      const task = taskRepo.create({
        name: 'Toggle me',
        scheduleConfig: dailyConfig,
        cronExpression: '0 9 * * *',
        scheduleDescription: 'Daily',
        provider: 'claude',
        taskPrompt: 'Test',
        enabled: true,
      });

      const updated = taskRepo.update(task.id, { enabled: false });
      expect(updated!.enabled).toBe(false);
    });

    it('should update schedule config and cron expression', () => {
      const task = taskRepo.create({
        name: 'Reschedule me',
        scheduleConfig: dailyConfig,
        cronExpression: '0 9 * * 1,2,3,4,5',
        scheduleDescription: 'Weekdays at 09:00',
        provider: 'claude',
        taskPrompt: 'Test',
        enabled: true,
      });

      const newConfig: ScheduleConfig = { preset: 'interval', intervalMinutes: 60 };
      const updated = taskRepo.update(task.id, {
        scheduleConfig: newConfig,
        cronExpression: '0 */1 * * *',
        scheduleDescription: 'Every hour',
      });

      expect(updated!.scheduleConfig).toEqual(newConfig);
      expect(updated!.cronExpression).toBe('0 */1 * * *');
      expect(updated!.scheduleDescription).toBe('Every hour');
    });

    it('should update run state fields', () => {
      const task = taskRepo.create({
        name: 'Run state test',
        scheduleConfig: dailyConfig,
        cronExpression: '0 9 * * *',
        scheduleDescription: 'Daily',
        provider: 'claude',
        taskPrompt: 'Test',
        enabled: true,
      });

      const now = new Date().toISOString();
      const updated = taskRepo.update(task.id, {
        lastRunAt: now,
        lastRunStatus: 'completed',
        runCount: 5,
      });

      expect(updated!.lastRunAt).toBe(now);
      expect(updated!.lastRunStatus).toBe('completed');
      expect(updated!.runCount).toBe(5);
    });

    it('should return null for non-existent task', () => {
      expect(taskRepo.update('nope' as ScheduledTaskId, { name: 'X' })).toBeNull();
    });

    it('should preserve existing fields on partial update', () => {
      const track = createTrack();
      const task = taskRepo.create({
        name: 'Partial',
        description: 'Keep me',
        scheduleConfig: dailyConfig,
        cronExpression: '0 9 * * *',
        scheduleDescription: 'Daily',
        trackId: track.id,
        provider: 'codex',
        taskPrompt: 'Original prompt',
        enabled: true,
      });

      const updated = taskRepo.update(task.id, { name: 'Updated partial' });

      expect(updated!.description).toBe('Keep me');
      expect(updated!.trackId).toBe(track.id);
      expect(updated!.provider).toBe('codex');
      expect(updated!.taskPrompt).toBe('Original prompt');
    });
  });

  describe('delete', () => {
    it('should delete a task', () => {
      const task = taskRepo.create({
        name: 'Delete me',
        scheduleConfig: dailyConfig,
        cronExpression: '0 9 * * *',
        scheduleDescription: 'Daily',
        provider: 'claude',
        taskPrompt: 'Test',
        enabled: true,
      });

      expect(taskRepo.delete(task.id)).toBe(true);
      expect(taskRepo.findById(task.id)).toBeNull();
    });

    it('should return false for non-existent task', () => {
      expect(taskRepo.delete('nope' as ScheduledTaskId)).toBe(false);
    });
  });

  describe('track relationship', () => {
    it('should set track_id to null when track is deleted (ON DELETE SET NULL)', () => {
      const track = createTrack('Deletable track');
      const task = taskRepo.create({
        name: 'Track-bound',
        scheduleConfig: dailyConfig,
        cronExpression: '0 9 * * *',
        scheduleDescription: 'Daily',
        trackId: track.id,
        provider: 'claude',
        taskPrompt: 'Test',
        enabled: true,
      });

      expect(task.trackId).toBe(track.id);

      trackRepo.delete(track.id);

      const found = taskRepo.findById(task.id);
      expect(found).not.toBeNull();
      expect(found!.trackId).toBeUndefined(); // SET NULL, mapped to undefined
    });
  });

  describe('ScheduledTaskRunRepository', () => {
    it('should create a run record', () => {
      const task = taskRepo.create({
        name: 'Run test',
        scheduleConfig: dailyConfig,
        cronExpression: '0 9 * * *',
        scheduleDescription: 'Daily',
        provider: 'claude',
        taskPrompt: 'Test',
        enabled: true,
      });

      const run = runRepo.create({
        taskId: task.id,
        status: 'running',
        startedAt: new Date().toISOString(),
      });

      expect(run.id).toBeDefined();
      expect(run.taskId).toBe(task.id);
      expect(run.status).toBe('running');
    });

    it('should complete a run', () => {
      const task = taskRepo.create({
        name: 'Complete test',
        scheduleConfig: dailyConfig,
        cronExpression: '0 9 * * *',
        scheduleDescription: 'Daily',
        provider: 'claude',
        taskPrompt: 'Test',
        enabled: true,
      });

      const run = runRepo.create({
        taskId: task.id,
        status: 'running',
        startedAt: new Date().toISOString(),
      });

      const completed = runRepo.complete(run.id, 'completed');
      expect(completed).not.toBeNull();
      expect(completed!.status).toBe('completed');
      expect(completed!.completedAt).toBeDefined();
    });

    it('should complete a run with error', () => {
      const task = taskRepo.create({
        name: 'Fail test',
        scheduleConfig: dailyConfig,
        cronExpression: '0 9 * * *',
        scheduleDescription: 'Daily',
        provider: 'claude',
        taskPrompt: 'Test',
        enabled: true,
      });

      const run = runRepo.create({
        taskId: task.id,
        status: 'running',
        startedAt: new Date().toISOString(),
      });

      const failed = runRepo.complete(run.id, 'failed', 'Something broke');
      expect(failed!.status).toBe('failed');
      expect(failed!.error).toBe('Something broke');
    });

    it('should find runs by task', () => {
      const task = taskRepo.create({
        name: 'Multi-run test',
        scheduleConfig: dailyConfig,
        cronExpression: '0 9 * * *',
        scheduleDescription: 'Daily',
        provider: 'claude',
        taskPrompt: 'Test',
        enabled: true,
      });

      runRepo.create({ taskId: task.id, status: 'completed', startedAt: '2026-01-01T09:00:00Z' });
      runRepo.create({ taskId: task.id, status: 'completed', startedAt: '2026-01-02T09:00:00Z' });
      runRepo.create({ taskId: task.id, status: 'failed', startedAt: '2026-01-03T09:00:00Z' });

      const runs = runRepo.findByTask(task.id);
      expect(runs).toHaveLength(3);
      // Ordered by started_at DESC
      expect(runs[0].startedAt).toBe('2026-01-03T09:00:00Z');
    });

    it('should respect limit parameter', () => {
      const task = taskRepo.create({
        name: 'Limit test',
        scheduleConfig: dailyConfig,
        cronExpression: '0 9 * * *',
        scheduleDescription: 'Daily',
        provider: 'claude',
        taskPrompt: 'Test',
        enabled: true,
      });

      runRepo.create({ taskId: task.id, status: 'completed', startedAt: '2026-01-01T00:00:00Z' });
      runRepo.create({ taskId: task.id, status: 'completed', startedAt: '2026-01-02T00:00:00Z' });
      runRepo.create({ taskId: task.id, status: 'completed', startedAt: '2026-01-03T00:00:00Z' });

      const limited = runRepo.findByTask(task.id, 2);
      expect(limited).toHaveLength(2);
    });

    it('should cascade delete runs when task is deleted', () => {
      const task = taskRepo.create({
        name: 'Cascade run test',
        scheduleConfig: dailyConfig,
        cronExpression: '0 9 * * *',
        scheduleDescription: 'Daily',
        provider: 'claude',
        taskPrompt: 'Test',
        enabled: true,
      });

      runRepo.create({ taskId: task.id, status: 'completed', startedAt: new Date().toISOString() });
      runRepo.create({ taskId: task.id, status: 'completed', startedAt: new Date().toISOString() });

      expect(runRepo.findByTask(task.id)).toHaveLength(2);

      taskRepo.delete(task.id);

      expect(runRepo.findByTask(task.id)).toHaveLength(0);
    });

    it('should return null when completing non-existent run', () => {
      expect(runRepo.complete('nope', 'completed')).toBeNull();
    });
  });
});
