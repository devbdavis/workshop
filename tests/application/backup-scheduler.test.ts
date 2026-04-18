import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBackupScheduler } from '@application/backup/backup-scheduler';
import type { SettingsRepository } from '@domain/repo/repository';
import type { BackupResult } from '@infrastructure/backup/backup-service';

function makeSettings(initial: Record<string, string> = {}): SettingsRepository {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: (key) => store.get(key) ?? null,
    set: (key, value) => { store.set(key, value); },
  };
}

function makeRunner(): {
  runner: (...args: unknown[]) => Promise<BackupResult>;
  callCount: () => number;
} {
  let calls = 0;
  return {
    callCount: () => calls,
    runner: async () => {
      calls += 1;
      return {
        filePath: '/tmp/fake.tar.br.enc',
        kind: 'daily',
        bytes: 100,
        uncompressedBytes: 1000,
        ratio: 0.1,
        durationMs: 10,
        prune: { deleted: [], kept: [] },
      };
    },
  };
}

describe('backup-scheduler catch-up', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('fires a startup catch-up when the last backup is >24h old', async () => {
    const settings = makeSettings({
      backup_enabled: 'true',
      backup_destination: '/tmp/backups',
      backup_passphrase: 'pw',
      backup_last_completed_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });
    const { runner, callCount } = makeRunner();
    const scheduler = createBackupScheduler({ settings, runner });

    scheduler.start();
    expect(callCount()).toBe(0);

    // startup delay is 10s
    await vi.advanceTimersByTimeAsync(11_000);
    expect(callCount()).toBe(1);

    scheduler.stop();
  });

  it('skips startup catch-up when the last backup is recent', async () => {
    const settings = makeSettings({
      backup_enabled: 'true',
      backup_destination: '/tmp/backups',
      backup_passphrase: 'pw',
      backup_last_completed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const { runner, callCount } = makeRunner();
    const scheduler = createBackupScheduler({ settings, runner });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(callCount()).toBe(0);

    scheduler.stop();
  });

  it('hourly watchdog catches up when the last backup becomes stale', async () => {
    const settings = makeSettings({
      backup_enabled: 'true',
      backup_destination: '/tmp/backups',
      backup_passphrase: 'pw',
      backup_last_completed_at: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
    });
    const { runner, callCount } = makeRunner();
    const scheduler = createBackupScheduler({ settings, runner });

    scheduler.start();
    // Advance 30 minutes past the startup delay — still within threshold.
    await vi.advanceTimersByTimeAsync(11_000 + 30 * 60 * 1000);
    expect(callCount()).toBe(0);

    // Advance another 2h so the last successful run is now ~25h stale.
    // The watchdog ticks hourly, so the next tick should trigger a catch-up.
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(callCount()).toBeGreaterThanOrEqual(1);

    scheduler.stop();
  });

  it('skips catch-up when backups are disabled', async () => {
    const settings = makeSettings({
      backup_enabled: 'false',
      backup_destination: '/tmp/backups',
      backup_passphrase: 'pw',
      backup_last_completed_at: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
    });
    const { runner, callCount } = makeRunner();
    const scheduler = createBackupScheduler({ settings, runner });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(11_000 + 60 * 60 * 1000);
    expect(callCount()).toBe(0);

    scheduler.stop();
  });
});
