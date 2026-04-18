import { Router } from 'express';
import { homedir } from 'node:os';
import path from 'node:path';
import type { SettingsRepository } from '@domain/repo/repository';
import type { BackupScheduler } from '@application/backup/backup-scheduler.js';
import { readBackupConfig } from '@application/backup/backup-scheduler.js';
import { listBackups } from '@infrastructure/backup/backup-service.js';

export interface BackupRouterDeps {
  settings: SettingsRepository;
  scheduler: BackupScheduler;
}

interface BackupSettingsPayload {
  enabled?: unknown;
  destination?: unknown;
  passphrase?: unknown;
  cronExpression?: unknown;
}

function expandHome(p: string): string {
  if (p.startsWith('~/')) return path.join(homedir(), p.slice(2));
  return p;
}

export function createBackupRouter(deps: BackupRouterDeps): Router {
  const router = Router();
  const { settings, scheduler } = deps;

  // GET — echoes config without the passphrase. A boolean flag tells the UI
  // whether a passphrase is already stored so it doesn't force the user to
  // re-enter it when touching other fields.
  router.get('/settings/backup', (_req, res) => {
    const config = readBackupConfig(settings);
    const lastStatus = settings.get('backup_last_status');
    const lastCompletedAt = settings.get('backup_last_completed_at');
    const lastStartedAt = settings.get('backup_last_started_at');
    const lastError = settings.get('backup_last_error');
    const lastFile = settings.get('backup_last_file');
    const lastBytes = settings.get('backup_last_bytes');

    let recentBackups: Array<{ fileName: string; kind: string; timestamp: string }> = [];
    if (config.destination) {
      try {
        recentBackups = listBackups(expandHome(config.destination)).slice(0, 10).map((e) => ({
          fileName: e.fileName,
          kind: e.kind,
          timestamp: e.timestamp,
        }));
      } catch {
        // Non-fatal — destination might not exist yet.
      }
    }

    res.json({
      enabled: config.enabled,
      destination: config.destination,
      cronExpression: config.cronExpression,
      passphraseConfigured: config.passphrase.length > 0,
      lastStatus,
      lastCompletedAt,
      lastStartedAt,
      lastError,
      lastFile,
      lastBytes: lastBytes ? Number(lastBytes) : null,
      recentBackups,
    });
  });

  router.put('/settings/backup', (req, res) => {
    const body = req.body as BackupSettingsPayload;

    if (typeof body.enabled === 'boolean') {
      settings.set('backup_enabled', body.enabled ? 'true' : 'false');
    }
    if (typeof body.destination === 'string') {
      settings.set('backup_destination', expandHome(body.destination.trim()));
    }
    if (typeof body.cronExpression === 'string' && body.cronExpression.trim().length > 0) {
      settings.set('backup_cron', body.cronExpression.trim());
    }
    // Empty string clears the passphrase; undefined leaves it alone so other
    // fields can be saved without re-entering the secret.
    if (typeof body.passphrase === 'string') {
      settings.set('backup_passphrase', body.passphrase);
    }

    // Restart the scheduler so cron / enabled changes take effect immediately.
    scheduler.stop();
    scheduler.start();

    const config = readBackupConfig(settings);
    res.json({
      enabled: config.enabled,
      destination: config.destination,
      cronExpression: config.cronExpression,
      passphraseConfigured: config.passphrase.length > 0,
    });
  });

  router.post('/settings/backup/run', async (_req, res) => {
    try {
      const result = await scheduler.triggerNow();
      res.json({
        ok: true,
        filePath: result.filePath,
        kind: result.kind,
        bytes: result.bytes,
        uncompressedBytes: result.uncompressedBytes,
        ratio: result.ratio,
        durationMs: result.durationMs,
        pruned: result.prune.deleted.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Backup failed';
      res.status(500).json({ ok: false, error: message });
    }
  });

  return router;
}
