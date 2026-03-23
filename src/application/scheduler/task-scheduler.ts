import cron from 'node-cron';
import type {
  ScheduledTask,
  ScheduledTaskId,
  ScheduledTaskRun,
  SessionId,
  SessionProvider,
  TrackId,
} from '@foundation/types';
import type { ScheduledTaskRepository, ScheduledTaskRunRepository } from '@domain/scheduled-task/repository';
import type { TrackRepository } from '@domain/track/repository';
import type { SessionRepository } from '@domain/session/repository';
import type { SummaryRepository } from '@domain/summary/repository';
import type { TicketRepository } from '@domain/ticket/repository';
import type { PromptTemplateRepository } from '@domain/prompt-template/repository';
import type { AgentRepository } from '@domain/agent/repository';
import type { AgentScanner as FilesystemAgentScanner } from '@domain/agent/scanner.js';
import { interpolateTemplate } from '@application/track-management/prompt-interpolation.js';

export interface TaskSchedulerDeps {
  tasks: ScheduledTaskRepository;
  runs: ScheduledTaskRunRepository;
  tracks: TrackRepository;
  sessions: SessionRepository;
  summaries: SummaryRepository;
  tickets: TicketRepository;
  promptTemplates: PromptTemplateRepository;
  agents: AgentRepository;
  filesystemScanner: FilesystemAgentScanner;
  projectRoot: string;
  terminal: {
    createSession: (
      trackId: TrackId,
      opts?: {
        systemPrompt?: string;
        workingDirectory?: string;
        background?: boolean;
        initialPrompt?: string;
        provider?: SessionProvider;
      },
    ) => Promise<{ id: SessionId; trackId: TrackId; tmuxSession: string; state: string }>;
  };
  broadcast: (type: string, id: string) => void;
}

export interface TaskScheduler {
  start(): void;
  stop(): void;
  scheduleTask(taskId: ScheduledTaskId): void;
  unscheduleTask(taskId: ScheduledTaskId): void;
  triggerNow(taskId: ScheduledTaskId): Promise<ScheduledTaskRun>;
}

interface CronEntry {
  taskId: ScheduledTaskId;
  job: cron.ScheduledTask;
}

export function createTaskScheduler(deps: TaskSchedulerDeps): TaskScheduler {
  const cronJobs: CronEntry[] = [];
  let scheduledTrackId: TrackId | null = null;

  /** Get or create a system track for freeform scheduled tasks (no track binding). */
  function getOrCreateScheduledTrack(): TrackId {
    if (scheduledTrackId) {
      // Verify it still exists
      const existing = deps.tracks.findById(scheduledTrackId);
      if (existing) return scheduledTrackId;
    }

    // Look for existing system track
    const all = deps.tracks.findAll();
    const existing = all.find((t) => t.name === '_Scheduled Tasks');
    if (existing) {
      scheduledTrackId = existing.id;
      return existing.id;
    }

    // Create it
    const track = deps.tracks.create({
      name: '_Scheduled Tasks',
      description: 'System track for freeform scheduled task dispatches',
      label: 'system',
      status: 'active',
    });
    scheduledTrackId = track.id;
    return track.id;
  }

  function clearJobs(): void {
    for (const entry of cronJobs) {
      entry.job.stop();
    }
    cronJobs.length = 0;
  }

  function removeCronJob(taskId: ScheduledTaskId): void {
    const idx = cronJobs.findIndex((e) => e.taskId === taskId);
    if (idx !== -1) {
      cronJobs[idx].job.stop();
      cronJobs.splice(idx, 1);
    }
  }

  function addCronJob(task: ScheduledTask): void {
    if (!cron.validate(task.cronExpression)) {
      console.warn(`Scheduled task "${task.name}" (${task.id}) has invalid cron: ${task.cronExpression}`);
      return;
    }

    const job = cron.schedule(task.cronExpression, () => {
      void executeTask(task.id);
    });

    cronJobs.push({ taskId: task.id, job });
  }

  /**
   * Compose the system prompt for a scheduled task dispatch.
   * Mirrors the logic in todo-routes.ts dispatch endpoint.
   */
  function composeSystemPrompt(task: ScheduledTask): string {
    if (task.systemPromptOverride) {
      return task.systemPromptOverride;
    }

    const parts: string[] = [];

    // Agent system prompt
    if (task.agentId) {
      let agent = deps.agents.findById(task.agentId);
      if (!agent) {
        agent = deps.filesystemScanner.findById(task.agentId, deps.projectRoot);
      }
      if (agent) {
        parts.push(`## Agent: ${agent.name}\n\n${agent.systemPrompt}`);
      }
    }

    // Track context (if bound to a track)
    if (task.trackId) {
      const track = deps.tracks.findById(task.trackId);
      if (track) {
        if (track.context) {
          parts.push(track.context);
        }

        const summary = deps.summaries.findLatest(task.trackId);
        if (summary) {
          parts.push(`## Current Status\n\n${summary.content}`);
        }

        if (track.defaultPromptTemplateId) {
          const template = deps.promptTemplates.findById(track.defaultPromptTemplateId);
          if (template) {
            track.tickets = deps.tickets.findByTrack(task.trackId);
            const interpolated = interpolateTemplate(template.content, { track });
            parts.push(interpolated);
          }
        }
      }
    }

    return parts.length > 0 ? parts.join('\n\n---\n\n') : '';
  }

  async function executeTask(taskId: ScheduledTaskId): Promise<ScheduledTaskRun> {
    // Re-read from DB to get latest state
    const task = deps.tasks.findById(taskId);
    if (!task) {
      throw new Error(`Scheduled task not found: ${taskId}`);
    }

    const now = new Date().toISOString();

    // Create run record
    const run = deps.runs.create({
      taskId: task.id,
      status: 'running',
      startedAt: now,
    });

    try {
      const systemPrompt = composeSystemPrompt(task);

      // Determine working directory and dispatch track
      let workingDirectory: string | undefined;
      let dispatchTrackId: TrackId;

      if (task.trackId) {
        dispatchTrackId = task.trackId;
        const repos = deps.tracks.findReposByTrack(task.trackId);
        workingDirectory = repos[0]?.path;
      } else {
        // Freeform task: use or create a system track for scheduled dispatches
        dispatchTrackId = getOrCreateScheduledTrack();
      }

      const session = await deps.terminal.createSession(dispatchTrackId, {
        systemPrompt: systemPrompt || undefined,
        workingDirectory,
        background: true,
        initialPrompt: task.taskPrompt,
        provider: task.provider,
      });

      // Update task state
      deps.tasks.update(task.id, {
        lastRunAt: now,
        lastRunStatus: 'running',
        lastSessionId: session.id as SessionId,
        runCount: task.runCount + 1,
      });

      // Update run with session ID
      deps.runs.complete(run.id, 'completed');

      deps.broadcast('scheduled-task:triggered', task.id);
      if (task.trackId) {
        deps.broadcast('session:created', task.trackId);
      }

      return { ...run, sessionId: session.id as SessionId, status: 'completed' };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`Scheduled task "${task.name}" (${task.id}) failed:`, errorMsg);

      deps.runs.complete(run.id, 'failed', errorMsg);
      deps.tasks.update(task.id, {
        lastRunAt: now,
        lastRunStatus: 'failed',
      });

      deps.broadcast('scheduled-task:failed', task.id);

      return { ...run, status: 'failed', error: errorMsg };
    }
  }

  return {
    start(): void {
      const enabled = deps.tasks.findEnabled();
      for (const task of enabled) {
        addCronJob(task);
      }
      console.log(`Task scheduler started: ${enabled.length} scheduled task(s) loaded`);
    },

    stop(): void {
      clearJobs();
      console.log('Task scheduler stopped');
    },

    scheduleTask(taskId: ScheduledTaskId): void {
      removeCronJob(taskId);
      const task = deps.tasks.findById(taskId);
      if (task?.enabled) {
        addCronJob(task);
      }
    },

    unscheduleTask(taskId: ScheduledTaskId): void {
      removeCronJob(taskId);
    },

    async triggerNow(taskId: ScheduledTaskId): Promise<ScheduledTaskRun> {
      return executeTask(taskId);
    },
  };
}
