import { Router } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { ScheduledTaskId, TrackId, AgentId, SessionProvider } from '@foundation/types';
import type { ScheduledTaskRepository, ScheduledTaskRunRepository } from '@domain/scheduled-task/repository';
import type { TaskScheduler } from '@application/scheduler/task-scheduler.js';
import { scheduleConfigToCron, describeSchedule, validateScheduleConfig } from '@application/scheduler/cron-utils.js';
import { broadcast } from './events.js';

function callClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', prompt]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Claude CLI timed out after 120s'));
    }, 120_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(Buffer.concat(err).toString().trim() || `claude exited with code ${code}`));
      } else {
        resolve(Buffer.concat(out).toString());
      }
    });

    child.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in Claude response');
  return JSON.parse(match[0]);
}

/** Slug a task name to a safe filename: "Daily Action Items" → "daily-action-items" */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Resolve the scripts directory, creating it if needed. */
function getScriptsDir(): string {
  const dir = path.join(os.homedir(), '.workshop', 'schedule', 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Write script content to ~/.workshop/schedule/scripts/<slug>.sh and return
 * the absolute path. If content is empty the file is deleted and null returned.
 */
function saveScript(taskName: string, content: string): string {
  const dir = getScriptsDir();
  const filename = `${slugify(taskName)}.sh`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, { mode: 0o755 });
  return filePath;
}

function deleteScript(scriptPath: string): void {
  try { fs.unlinkSync(scriptPath); } catch { /* already gone */ }
}

export interface ScheduledTaskRouterDeps {
  tasks: ScheduledTaskRepository;
  runs: ScheduledTaskRunRepository;
  scheduler: TaskScheduler;
}

export function createScheduledTaskRouter(deps: ScheduledTaskRouterDeps): Router {
  const router = Router();
  const { tasks, runs, scheduler } = deps;

  // --- Generate scheduled task definition via Claude CLI ---

  router.post('/scheduled-tasks/generate', async (req, res) => {
    const { description } = req.body;
    if (!description || typeof description !== 'string') {
      res.status(400).json({ error: 'description is required' });
      return;
    }

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const prompt = `Generate a Workshop scheduled task definition based on this description:

${description}

Today is ${today}.

A Workshop scheduled task runs a detailed prompt against an AI agent (Claude) on a recurring schedule. The agent executes autonomously — it has no extra context beyond the task prompt and any system prompt. Be extremely prescriptive and script-like.

Return a JSON object with these fields:
- name: short task name (3-6 words, Title Case)
- description: one sentence describing what this scheduled task does
- scheduleConfig: infer the right schedule from the description. Use one of:
  - { "preset": "daily", "time": "HH:MM", "daysOfWeek": [1,2,3,4,5] }  (0=Sun…6=Sat)
  - { "preset": "weekly", "time": "HH:MM", "dayOfWeek": 1 }
  - { "preset": "interval", "intervalMinutes": 30 }
  - { "preset": "monthly", "time": "HH:MM", "monthRule": "day-of-month", "dayOfMonth": 1 }
  - { "preset": "cron", "cronExpression": "0 9 * * 1-5" }
- taskPrompt: detailed, step-by-step task prompt. Rules:
  - Written in imperative form as numbered steps
  - Each step specifies the exact tool or action (e.g. "Use the glean_search MCP tool with query X")
  - Include exact search queries, time ranges (e.g. "from yesterday"), and any relevant filters
  - Specify the exact output format (e.g. "Produce a markdown report with sections: Summary, Action Items, Links")
  - The agent should be able to execute this without any ambiguity or additional context
  - If the task involves external data sources (Slack, Linear, GitHub, etc.), name them explicitly
  - End with clear output/reporting instructions (where to write output, what format, etc.)
- suggestedScriptContent: a bash script to run before the agent if shell commands would help gather context (e.g. git log, curl, jq queries). Use null if a script adds no value. The script's stdout is prepended to the task prompt as context for the agent.

Return ONLY the JSON object, no other text or markdown.`;

    try {
      const output = await callClaude(prompt);
      res.json(extractJson(output));
    } catch (err) {
      console.error('Schedule generation failed:', err);
      res.status(500).json({ error: 'Schedule generation failed' });
    }
  });

  // --- Fetch script content for a scheduled task ---

  router.get('/scheduled-tasks/:id/script', (req, res) => {
    const task = tasks.findById(req.params.id as ScheduledTaskId);
    if (!task) {
      res.status(404).json({ error: 'Scheduled task not found' });
      return;
    }
    if (!task.scriptPath) {
      res.json({ content: null });
      return;
    }
    try {
      const content = fs.readFileSync(task.scriptPath, 'utf-8');
      res.json({ content });
    } catch {
      res.json({ content: null });
    }
  });

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
      scriptContent,
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

    let scriptPath: string | undefined;
    if (scriptContent && typeof scriptContent === 'string' && scriptContent.trim()) {
      try {
        scriptPath = saveScript(name, scriptContent.trim());
      } catch (err) {
        console.error('Failed to save script:', err);
        res.status(500).json({ error: 'Failed to save script file' });
        return;
      }
    }

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
      scriptPath,
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
      scriptContent,
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

    // Handle script updates.
    // scriptContent not present → leave scriptPath unchanged (pass undefined to repo)
    // scriptContent is non-empty string → write file, pass new path
    // scriptContent is empty string → clear script, delete file, pass '' (repo stores null)
    let updatedScriptPath: string | undefined;
    if (scriptContent !== undefined) {
      if (typeof scriptContent === 'string' && scriptContent.trim()) {
        const taskName = (typeof name === 'string' && name) ? name : existing.name;
        try {
          updatedScriptPath = saveScript(taskName, scriptContent.trim());
        } catch (err) {
          console.error('Failed to save script:', err);
          res.status(500).json({ error: 'Failed to save script file' });
          return;
        }
      } else {
        // Empty string: clear the script
        if (existing.scriptPath) {
          deleteScript(existing.scriptPath);
        }
        updatedScriptPath = '';
      }
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
      ...(scriptContent !== undefined ? { scriptPath: updatedScriptPath } : {}),
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
