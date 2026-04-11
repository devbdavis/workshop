import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type {
  ScheduledTaskRepository,
  ScheduledTaskRunRepository,
} from '@domain/scheduled-task/repository';
import type {
  ScheduledTask,
  ScheduledTaskId,
  ScheduledTaskRun,
  TrackId,
  SessionId,
  AgentId,
  SessionProvider,
  ScheduleConfig,
} from '@foundation/types';

// --- Task Repository ---

export function createScheduledTaskRepository(): ScheduledTaskRepository {
  const db = getDatabase();

  // Prepare statements once
  const findByIdStmt = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?');
  const findAllStmt = db.prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC');
  const findEnabledStmt = db.prepare('SELECT * FROM scheduled_tasks WHERE enabled = 1 ORDER BY created_at DESC');
  const findByTrackStmt = db.prepare('SELECT * FROM scheduled_tasks WHERE track_id = ? ORDER BY created_at DESC');
  const insertStmt = db.prepare(
    `INSERT INTO scheduled_tasks
     (id, name, description, schedule_config, cron_expression, schedule_description,
      track_id, agent_id, provider, task_prompt, system_prompt_override, script_path,
      template_name, enabled, run_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  );
  const updateStmt = db.prepare(
    `UPDATE scheduled_tasks SET
       name = ?, description = ?, schedule_config = ?, cron_expression = ?,
       schedule_description = ?, track_id = ?, agent_id = ?, provider = ?,
       task_prompt = ?, system_prompt_override = ?, script_path = ?, template_name = ?,
       enabled = ?, last_run_at = ?, last_run_status = ?, last_session_id = ?,
       run_count = ?, updated_at = ?
     WHERE id = ?`,
  );
  const deleteStmt = db.prepare('DELETE FROM scheduled_tasks WHERE id = ?');

  return {
    findById(id: ScheduledTaskId): ScheduledTask | null {
      const row = findByIdStmt.get(id) as TaskRow | undefined;
      return row ? rowToTask(row) : null;
    },

    findAll(): ScheduledTask[] {
      const rows = findAllStmt.all() as TaskRow[];
      return rows.map(rowToTask);
    },

    findEnabled(): ScheduledTask[] {
      const rows = findEnabledStmt.all() as TaskRow[];
      return rows.map(rowToTask);
    },

    findByTrack(trackId: TrackId): ScheduledTask[] {
      const rows = findByTrackStmt.all(trackId) as TaskRow[];
      return rows.map(rowToTask);
    },

    create(data): ScheduledTask {
      const id = uuid() as ScheduledTaskId;
      const now = new Date().toISOString();

      insertStmt.run(
        id,
        data.name,
        data.description || null,
        JSON.stringify(data.scheduleConfig),
        data.cronExpression,
        data.scheduleDescription || '',
        data.trackId || null,
        data.agentId || null,
        data.provider || 'claude',
        data.taskPrompt,
        data.systemPromptOverride || null,
        data.scriptPath || null,
        data.templateName || null,
        data.enabled ? 1 : 0,
        now,
        now,
      );

      return {
        id,
        name: data.name,
        description: data.description,
        scheduleConfig: data.scheduleConfig,
        cronExpression: data.cronExpression,
        scheduleDescription: data.scheduleDescription,
        trackId: data.trackId,
        agentId: data.agentId,
        provider: data.provider || 'claude',
        taskPrompt: data.taskPrompt,
        systemPromptOverride: data.systemPromptOverride,
        scriptPath: data.scriptPath,
        enabled: data.enabled,
        runCount: 0,
        createdAt: now,
        updatedAt: now,
      };
    },

    update(id, data): ScheduledTask | null {
      const existing = this.findById(id);
      if (!existing) return null;

      const now = new Date().toISOString();
      const merged = {
        name: data.name ?? existing.name,
        description: data.description !== undefined ? data.description : existing.description,
        scheduleConfig: data.scheduleConfig ?? existing.scheduleConfig,
        cronExpression: data.cronExpression ?? existing.cronExpression,
        scheduleDescription: data.scheduleDescription ?? existing.scheduleDescription,
        trackId: data.trackId !== undefined ? data.trackId : existing.trackId,
        agentId: data.agentId !== undefined ? data.agentId : existing.agentId,
        provider: data.provider ?? existing.provider,
        taskPrompt: data.taskPrompt ?? existing.taskPrompt,
        systemPromptOverride: data.systemPromptOverride !== undefined
          ? data.systemPromptOverride
          : existing.systemPromptOverride,
        scriptPath: data.scriptPath !== undefined ? data.scriptPath : existing.scriptPath,
        templateName: data.templateName !== undefined ? data.templateName : existing.templateName,
        enabled: data.enabled !== undefined ? data.enabled : existing.enabled,
        lastRunAt: data.lastRunAt !== undefined ? data.lastRunAt : existing.lastRunAt,
        lastRunStatus: data.lastRunStatus !== undefined ? data.lastRunStatus : existing.lastRunStatus,
        lastSessionId: data.lastSessionId !== undefined ? data.lastSessionId : existing.lastSessionId,
        runCount: data.runCount !== undefined ? data.runCount : existing.runCount,
      };

      updateStmt.run(
        merged.name,
        merged.description || null,
        JSON.stringify(merged.scheduleConfig),
        merged.cronExpression,
        merged.scheduleDescription,
        merged.trackId || null,
        merged.agentId || null,
        merged.provider,
        merged.taskPrompt,
        merged.systemPromptOverride || null,
        merged.scriptPath || null,
        merged.templateName || null,
        merged.enabled ? 1 : 0,
        merged.lastRunAt || null,
        merged.lastRunStatus || null,
        merged.lastSessionId || null,
        merged.runCount,
        now,
        id,
      );

      return { ...existing, ...merged, updatedAt: now };
    },

    delete(id: ScheduledTaskId): boolean {
      const result = deleteStmt.run(id);
      return result.changes > 0;
    },
  };
}

// --- Run Repository ---

export function createScheduledTaskRunRepository(): ScheduledTaskRunRepository {
  const db = getDatabase();

  // Prepare statements once
  const findByTaskStmt = db.prepare('SELECT * FROM scheduled_task_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?');
  const insertStmt = db.prepare(
    `INSERT INTO scheduled_task_runs (id, task_id, session_id, status, error, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const completeStmt = db.prepare(
    'UPDATE scheduled_task_runs SET status = ?, error = ?, completed_at = ? WHERE id = ?',
  );
  const findRunByIdStmt = db.prepare('SELECT * FROM scheduled_task_runs WHERE id = ?');

  return {
    findByTask(taskId: ScheduledTaskId, limit = 50): ScheduledTaskRun[] {
      const rows = findByTaskStmt.all(taskId, limit) as RunRow[];
      return rows.map(rowToRun);
    },

    create(data): ScheduledTaskRun {
      const id = uuid();

      insertStmt.run(
        id,
        data.taskId,
        data.sessionId || null,
        data.status,
        data.error || null,
        data.startedAt,
        data.completedAt || null,
      );

      return { id, ...data };
    },

    complete(id, status, error): ScheduledTaskRun | null {
      const now = new Date().toISOString();

      const result = completeStmt.run(status, error || null, now, id);

      if (result.changes === 0) return null;

      const row = findRunByIdStmt.get(id) as RunRow | undefined;
      return row ? rowToRun(row) : null;
    },
  };
}

// --- Row types and mappers ---

interface TaskRow {
  id: string;
  name: string;
  description: string | null;
  schedule_config: string;
  cron_expression: string;
  schedule_description: string;
  track_id: string | null;
  agent_id: string | null;
  provider: string;
  task_prompt: string;
  system_prompt_override: string | null;
  script_path: string | null;
  template_name: string | null;
  enabled: number;
  last_run_at: string | null;
  last_run_status: string | null;
  last_session_id: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  task_id: string;
  session_id: string | null;
  status: string;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

function rowToTask(row: TaskRow): ScheduledTask {
  return {
    id: row.id as ScheduledTaskId,
    name: row.name,
    description: row.description || undefined,
    scheduleConfig: JSON.parse(row.schedule_config) as ScheduleConfig,
    cronExpression: row.cron_expression,
    scheduleDescription: row.schedule_description,
    trackId: (row.track_id as TrackId) || undefined,
    agentId: (row.agent_id as AgentId) || undefined,
    provider: (row.provider as SessionProvider) || 'claude',
    taskPrompt: row.task_prompt,
    systemPromptOverride: row.system_prompt_override || undefined,
    scriptPath: row.script_path || undefined,
    templateName: row.template_name || undefined,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at || undefined,
    lastRunStatus: row.last_run_status as ScheduledTask['lastRunStatus'],
    lastSessionId: (row.last_session_id as SessionId) || undefined,
    runCount: row.run_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRun(row: RunRow): ScheduledTaskRun {
  return {
    id: row.id,
    taskId: row.task_id as ScheduledTaskId,
    sessionId: (row.session_id as SessionId) || undefined,
    status: row.status as ScheduledTaskRun['status'],
    error: row.error || undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at || undefined,
  };
}
