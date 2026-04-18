import cron from 'node-cron';
import { runBackup, type BackupResult } from '@infrastructure/backup/backup-service.js';
import type { SettingsRepository } from '@domain/repo/repository';

export interface BackupSchedulerDeps {
  settings: SettingsRepository;
  /** Override for tests. */
  now?: () => Date;
  /** Override for tests — defaults to runBackup(). */
  runner?: typeof runBackup;
}

export interface BackupScheduler {
  start(): void;
  stop(): void;
  triggerNow(): Promise<BackupResult>;
}

const DEFAULT_DAILY_CRON = '0 3 * * *'; // 03:00 local every day — quiet hour, unlikely to overlap with usage.
const STARTUP_DELAY_MS = 10_000;
const CATCH_UP_THRESHOLD_MS = 24 * 60 * 60 * 1_000;
const WATCHDOG_INTERVAL_MS = 60 * 60 * 1_000; // Re-check hourly whether a catch-up is due.

export interface BackupConfig {
  enabled: boolean;
  destination: string;
  passphrase: string;
  cronExpression: string;
}

export function readBackupConfig(settings: SettingsRepository): BackupConfig {
  return {
    enabled: settings.get('backup_enabled') === 'true',
    destination: settings.get('backup_destination') ?? '',
    passphrase: settings.get('backup_passphrase') ?? '',
    cronExpression: settings.get('backup_cron') ?? DEFAULT_DAILY_CRON,
  };
}

export function createBackupScheduler(deps: BackupSchedulerDeps): BackupScheduler {
  const now = deps.now ?? (() => new Date());
  const runner = deps.runner ?? runBackup;
  let job: cron.ScheduledTask | null = null;
  let catchupTimer: NodeJS.Timeout | null = null;
  let watchdogTimer: NodeJS.Timeout | null = null;
  let catchupInFlight = false;

  async function executeBackup(): Promise<BackupResult> {
    const config = readBackupConfig(deps.settings);
    if (!config.enabled) {
      throw new Error('Backup is not enabled');
    }
    if (!config.destination) {
      throw new Error('Backup destination is not configured');
    }
    if (!config.passphrase) {
      throw new Error('Backup passphrase is not configured');
    }
    const startedAt = new Date().toISOString();
    deps.settings.set('backup_last_started_at', startedAt);
    try {
      const result = await runner({
        destination: config.destination,
        passphrase: config.passphrase,
        now: now(),
      });
      deps.settings.set('backup_last_completed_at', new Date().toISOString());
      deps.settings.set('backup_last_status', 'ok');
      deps.settings.set('backup_last_error', '');
      deps.settings.set('backup_last_file', result.filePath);
      deps.settings.set('backup_last_bytes', String(result.bytes));
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.settings.set('backup_last_status', 'error');
      deps.settings.set('backup_last_error', message);
      throw err;
    }
  }

  function applyCronJob(cronExpression: string): void {
    if (job) {
      job.stop();
      job = null;
    }
    if (!cron.validate(cronExpression)) {
      console.warn(`[backup] Invalid cron expression — falling back to default: ${DEFAULT_DAILY_CRON}`);
      cronExpression = DEFAULT_DAILY_CRON;
    }
    job = cron.schedule(cronExpression, () => {
      executeBackup().catch((err) => {
        console.error('[backup] Scheduled run failed:', err);
      });
    });
  }

  /**
   * Returns the age of the last successful backup in milliseconds, or Infinity
   * if there isn't one yet.
   */
  function lastBackupAge(): number {
    const lastCompleted = deps.settings.get('backup_last_completed_at');
    const lastMs = lastCompleted ? Date.parse(lastCompleted) : NaN;
    if (!Number.isFinite(lastMs)) return Infinity;
    return Date.now() - lastMs;
  }

  /**
   * Run a catch-up backup if the last completed one is older than the
   * threshold. Safe to call repeatedly — serialised via `catchupInFlight`,
   * and no-ops if backups are disabled or a run is already in progress.
   */
  function maybeCatchUp(reason: 'startup' | 'watchdog'): void {
    if (catchupInFlight) return;
    const config = readBackupConfig(deps.settings);
    if (!config.enabled) return;
    if (!config.destination || !config.passphrase) return;
    if (lastBackupAge() <= CATCH_UP_THRESHOLD_MS) return;

    catchupInFlight = true;
    console.log(`[backup] ${reason} catch-up: last run is stale, backing up now`);
    executeBackup()
      .catch((err) => {
        console.error(`[backup] ${reason} catch-up failed:`, err);
      })
      .finally(() => {
        catchupInFlight = false;
      });
  }

  return {
    start(): void {
      const config = readBackupConfig(deps.settings);
      if (!config.enabled) {
        console.log('[backup] Scheduler idle — backups are disabled');
        return;
      }
      applyCronJob(config.cronExpression);
      console.log(`[backup] Scheduler started with cron "${config.cronExpression}"`);

      // Catch-up #1 — startup: if the machine was off at the cron fire time,
      // run one shortly after startup. A small delay lets the server finish
      // coming up before we spend CPU on compression.
      if (lastBackupAge() > CATCH_UP_THRESHOLD_MS) {
        catchupTimer = setTimeout(() => maybeCatchUp('startup'), STARTUP_DELAY_MS);
      }

      // Catch-up #2 — watchdog: hourly check for the laptop-suspend case
      // where node-cron's internal timer may not fire reliably across sleep.
      // If we ever miss a day, the next hour tops us back up.
      watchdogTimer = setInterval(() => maybeCatchUp('watchdog'), WATCHDOG_INTERVAL_MS);
    },

    stop(): void {
      if (job) {
        job.stop();
        job = null;
      }
      if (catchupTimer) {
        clearTimeout(catchupTimer);
        catchupTimer = null;
      }
      if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
      }
    },

    triggerNow(): Promise<BackupResult> {
      return executeBackup();
    },
  };
}
