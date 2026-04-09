import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { ScheduledTaskRepository } from '@domain/scheduled-task/repository';
import type { ScheduleConfig } from '@foundation/types';
import { scheduleConfigToCron, describeSchedule } from './cron-utils.js';

interface BundledScheduleDefinition {
  name: string;
  description?: string;
  scheduleConfig: ScheduleConfig;
  taskPrompt: string;
  enabled?: boolean;
  /** Path to a script in the repo (relative to projectRoot) to install on first import */
  scriptFile?: string;
  /** Destination path for the script — supports leading ~ */
  scriptInstallPath?: string;
}

/**
 * Reads schedules/*.json from the project root and imports any that don't
 * already exist in the DB (matched by name). Runs once at server startup.
 *
 * This is intentionally name-based and idempotent: once a task exists in the
 * DB (even if the user has customised it), it is never overwritten by this
 * importer. Delete the DB row to re-import with fresh defaults.
 */
export function importBundledSchedules(
  projectRoot: string,
  taskRepo: ScheduledTaskRepository,
): void {
  const schedulesDir = path.join(projectRoot, 'schedules');
  if (!existsSync(schedulesDir)) return;

  let files: string[];
  try {
    files = readdirSync(schedulesDir).filter((f) => f.endsWith('.json'));
  } catch {
    return;
  }
  if (files.length === 0) return;

  const existingNames = new Set(taskRepo.findAll().map((t) => t.name));

  for (const file of files) {
    try {
      const def = JSON.parse(
        readFileSync(path.join(schedulesDir, file), 'utf-8'),
      ) as BundledScheduleDefinition;

      if (!def.name || !def.scheduleConfig || !def.taskPrompt) {
        console.warn(`[schedule-import] Skipping ${file}: missing name, scheduleConfig, or taskPrompt`);
        continue;
      }

      if (existingNames.has(def.name)) continue; // Already in DB — respect user's version

      // Install the companion script if specified
      let scriptPath: string | undefined;
      if (def.scriptFile && def.scriptInstallPath) {
        const src = path.join(projectRoot, def.scriptFile);
        const dst = def.scriptInstallPath.replace(/^~/, process.env.HOME ?? '/tmp');
        if (existsSync(src)) {
          mkdirSync(path.dirname(dst), { recursive: true });
          writeFileSync(dst, readFileSync(src, 'utf-8'), { encoding: 'utf-8', mode: 0o755 });
          scriptPath = dst;
          console.log(`[schedule-import] Installed script: ${dst}`);
        } else {
          console.warn(`[schedule-import] Script source not found: ${src}`);
        }
      }

      taskRepo.create({
        name: def.name,
        description: def.description,
        scheduleConfig: def.scheduleConfig,
        cronExpression: scheduleConfigToCron(def.scheduleConfig),
        scheduleDescription: describeSchedule(def.scheduleConfig),
        taskPrompt: def.taskPrompt,
        scriptPath,
        enabled: def.enabled ?? true,
        provider: 'claude',
      });

      console.log(`[schedule-import] Imported schedule: "${def.name}"`);
    } catch (err) {
      console.warn(`[schedule-import] Failed to import ${file}:`, err instanceof Error ? err.message : err);
    }
  }
}
