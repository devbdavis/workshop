import { Router } from 'express';
import type { ScheduledTaskId, TrackId, AgentId, SessionProvider } from '@foundation/types';
import type { ScheduledTaskRepository, ScheduledTaskRunRepository } from '@domain/scheduled-task/repository';
import type { TaskScheduler } from '@application/scheduler/task-scheduler.js';
import { scheduleConfigToCron, describeSchedule, validateScheduleConfig } from '@application/scheduler/cron-utils.js';
import { broadcast } from './events.js';

export interface ScheduledTaskRouterDeps {
  tasks: ScheduledTaskRepository;
  runs: ScheduledTaskRunRepository;
  scheduler: TaskScheduler;
}

export function createScheduledTaskRouter(deps: ScheduledTaskRouterDeps): Router {
  const router = Router();
  const { tasks, runs, scheduler } = deps;

  // --- List all scheduled tasks ---

  router.get('/scheduled-tasks', (req, res) => {
    const { trackId } = req.query;
    if (trackId) {
      res.json(tasks.findByTrack(trackId as TrackId));
      return;
    }
    res.json(tasks.findAll());
  });

  // --- Get single scheduled task ---

  router.get('/scheduled-tasks/:id', (req, res) => {
    const task = tasks.findById(req.params.id as ScheduledTaskId);
    if (!task) {
      res.status(404).json({ error: 'Scheduled task not found' });
      return;
    }
    res.json(task);
  });

  // --- Create scheduled task ---

  router.post('/scheduled-tasks', (req, res) => {
    const {
      name,
      description,
      scheduleConfig,
      trackId,
      agentId,
      provider,
      taskPrompt,
      systemPromptOverride,
      enabled,
    } = req.body;

    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (!taskPrompt || typeof taskPrompt !== 'string') {
      res.status(400).json({ error: 'taskPrompt is required' });
      return;
    }
    if (!scheduleConfig) {
      res.status(400).json({ error: 'scheduleConfig is required' });
      return;
    }

    const validationError = validateScheduleConfig(scheduleConfig);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const cronExpression = scheduleConfigToCron(scheduleConfig);
    const scheduleDescription = describeSchedule(scheduleConfig);

    const task = tasks.create({
      name,
      description,
      scheduleConfig,
      cronExpression,
      scheduleDescription,
      trackId: trackId ? (trackId as TrackId) : undefined,
      agentId: agentId ? (agentId as AgentId) : undefined,
      provider: (provider as SessionProvider) || 'claude',
      taskPrompt,
      systemPromptOverride,
      enabled: enabled !== undefined ? enabled : true,
    });

    // Register with scheduler if enabled
    if (task.enabled) {
      scheduler.scheduleTask(task.id);
    }

    broadcast('scheduled-task:created', task.id);
    res.status(201).json(task);
  });

  // --- Update scheduled task ---

  router.put('/scheduled-tasks/:id', (req, res) => {
    const taskId = req.params.id as ScheduledTaskId;
    const existing = tasks.findById(taskId);
    if (!existing) {
      res.status(404).json({ error: 'Scheduled task not found' });
      return;
    }

    const {
      name,
      description,
      scheduleConfig,
      trackId,
      agentId,
      provider,
      taskPrompt,
      systemPromptOverride,
      enabled,
    } = req.body;

    // If schedule config is changing, recompute cron
    let cronExpression: string | undefined;
    let scheduleDescription: string | undefined;
    if (scheduleConfig) {
      const validationError = validateScheduleConfig(scheduleConfig);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }
      cronExpression = scheduleConfigToCron(scheduleConfig);
      scheduleDescription = describeSchedule(scheduleConfig);
    }

    const updated = tasks.update(taskId, {
      name,
      description,
      scheduleConfig,
      cronExpression,
      scheduleDescription,
      trackId: trackId !== undefined ? (trackId || undefined) as TrackId : undefined,
      agentId: agentId !== undefined ? (agentId || undefined) as AgentId : undefined,
      provider: provider as SessionProvider,
      taskPrompt,
      systemPromptOverride,
      enabled,
    });

    if (!updated) {
      res.status(500).json({ error: 'Failed to update scheduled task' });
      return;
    }

    // Reschedule: remove old cron and add new if enabled
    scheduler.unscheduleTask(taskId);
    if (updated.enabled) {
      scheduler.scheduleTask(taskId);
    }

    broadcast('scheduled-task:updated', taskId);
    res.json(updated);
  });

  // --- Delete scheduled task ---

  router.delete('/scheduled-tasks/:id', (req, res) => {
    const taskId = req.params.id as ScheduledTaskId;
    scheduler.unscheduleTask(taskId);
    const deleted = tasks.delete(taskId);
    if (!deleted) {
      res.status(404).json({ error: 'Scheduled task not found' });
      return;
    }
    broadcast('scheduled-task:deleted', taskId);
    res.status(204).send();
  });

  // --- Toggle enable/disable ---

  router.post('/scheduled-tasks/:id/toggle', (req, res) => {
    const taskId = req.params.id as ScheduledTaskId;
    const existing = tasks.findById(taskId);
    if (!existing) {
      res.status(404).json({ error: 'Scheduled task not found' });
      return;
    }

    const newEnabled = !existing.enabled;
    const updated = tasks.update(taskId, { enabled: newEnabled });

    if (newEnabled) {
      scheduler.scheduleTask(taskId);
    } else {
      scheduler.unscheduleTask(taskId);
    }

    broadcast('scheduled-task:updated', taskId);
    res.json(updated);
  });

  // --- Trigger now ---

  router.post('/scheduled-tasks/:id/trigger', async (req, res) => {
    const taskId = req.params.id as ScheduledTaskId;
    const task = tasks.findById(taskId);
    if (!task) {
      res.status(404).json({ error: 'Scheduled task not found' });
      return;
    }

    try {
      const run = await scheduler.triggerNow(taskId);
      res.json(run);
    } catch (err) {
      console.error('Failed to trigger scheduled task:', err);
      res.status(500).json({ error: 'Failed to trigger scheduled task' });
    }
  });

  // --- Run history ---

  router.get('/scheduled-tasks/:id/runs', (req, res) => {
    const taskId = req.params.id as ScheduledTaskId;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const taskRuns = runs.findByTask(taskId, limit);
    res.json(taskRuns);
  });

  return router;
}
