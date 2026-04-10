import cron from 'node-cron';
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
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
import { getLastScheduledBefore } from './cron-utils.js';

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

        let templateHasRepos = false;
        if (track.defaultPromptTemplateId) {
          const template = deps.promptTemplates.findById(track.defaultPromptTemplateId);
          if (template) {
            templateHasRepos = template.content.includes('{{track.repos}}');
            track.tickets = deps.tickets.findByTrack(task.trackId);
            const interpolated = interpolateTemplate(template.content, { track });
            parts.push(interpolated);
          }
        }

        // Include repos unless the template already expanded {{track.repos}}
        const repos = deps.tracks.findReposByTrack(task.trackId);
        if (repos.length > 0 && !templateHasRepos) {
          const repoLines = repos
            .map((r) => `- ${r.path}${r.remoteUrl ? ` (${r.remoteUrl})` : ''}`)
            .join('\n');
          parts.push(`## Repositories\n\n${repoLines}`);
        }

        // Track Paths
        const trackPaths = deps.tracks.findPathsByTrack(task.trackId);
        if (trackPaths.length > 0) {
          const pathLines = trackPaths
            .map((p) => `- ${p.path}${p.label ? ` (${p.label})` : ''}`)
            .join('\n');
          parts.push(`## Track Paths\n\n${pathLines}`);
        }
      }
    }

    return parts.length > 0 ? parts.join('\n\n---\n\n') : '';
  }

  /** Run a script and return its stdout. Rejects if the script exits non-zero. */
  function runScript(scriptPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('bash', [scriptPath], { env: { ...process.env } });
      const out: Buffer[] = [];
      const err: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => err.push(chunk));

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Script timed out after 60s: ${scriptPath}`));
      }, 60_000);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          const errText = Buffer.concat(err).toString().trim();
          reject(new Error(`Script exited ${code}: ${errText || scriptPath}`));
        } else {
          resolve(Buffer.concat(out).toString());
        }
      });

      child.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
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

      // Run the attached script (if any) and prepend its stdout to the task prompt
      let effectivePrompt = task.taskPrompt;
      if (task.scriptPath) {
        try {
          const scriptOutput = await runScript(task.scriptPath);
          if (scriptOutput.trim()) {
            effectivePrompt = `## Script Output\n\n\`\`\`\n${scriptOutput.trim()}\n\`\`\`\n\n---\n\n${task.taskPrompt}`;
          }
        } catch (scriptErr) {
          // Non-fatal: log and proceed without script output
          console.warn(`Script failed for task "${task.name}" (${task.id}):`, scriptErr);
        }
      }

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

      // Default CWD to ~/.workshop/sessions so Claude Code doesn't trigger home-dir
      // workspace trust prompts — it already trusts the Workshop-managed directory.
      if (!workingDirectory) {
        workingDirectory = path.join(os.homedir(), '.workshop', 'sessions');
      }

      const session = await deps.terminal.createSession(dispatchTrackId, {
        systemPrompt: systemPrompt || undefined,
        workingDirectory,
        background: true,
        initialPrompt: effectivePrompt,
        provider: task.provider,
      });

      // Update task state — 'completed' means the session was successfully dispatched.
      deps.tasks.update(task.id, {
        lastRunAt: now,
        lastRunStatus: 'completed',
        lastSessionId: session.id as SessionId,
        runCount: task.runCount + 1,
      });

      // Leave the run in 'running' state. The SessionEnd hook will call
      // runs.complete() with the actual wall-clock end time, giving accurate
      // duration in the history panel. If the hook never fires (server crash,
      // etc.) the run record stays 'running' — acceptable for now.

      deps.broadcast('scheduled-task:triggered', task.id);
      if (task.trackId) {
        deps.broadcast('session:created', task.trackId);
      }

      return { ...run, sessionId: session.id as SessionId };
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
      const now = new Date();

      // Detect tasks that fired while the server was offline and schedule them
      // to run shortly after startup. We fire at most one catch-up run per task
      // (the most recent missed occurrence), staggered to avoid a thundering herd.
      const STARTUP_DELAY_MS = 5_000;
      const STAGGER_MS = 3_000;
      let missedCount = 0;

      for (const task of enabled) {
        addCronJob(task);

        const lastScheduled = getLastScheduledBefore(task.cronExpression, now);
        if (!lastScheduled) continue;

        // Reference point: last actual run, or task creation time if never run
        const reference = task.lastRunAt ? new Date(task.lastRunAt) : new Date(task.createdAt);

        if (lastScheduled > reference) {
          const delay = STARTUP_DELAY_MS + missedCount * STAGGER_MS;
          console.log(
            `Task "${task.name}" missed scheduled run at ${lastScheduled.toISOString()} — catching up in ${delay}ms`,
          );
          setTimeout(() => { void executeTask(task.id); }, delay);
          missedCount++;
        }
      }

      console.log(
        `Task scheduler started: ${enabled.length} task(s) loaded, ${missedCount} missed run(s) queued`,
      );
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
