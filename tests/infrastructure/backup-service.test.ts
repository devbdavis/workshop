import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resetDatabase } from '@infrastructure/persistence/database';
import { runBackup, restoreBackup } from '@infrastructure/backup/backup-service';
import {
  listBackups,
  pruneBackups,
  buildBackupFileName,
  isWeeklyDay,
} from '@infrastructure/backup/retention';

describe('backup-service', () => {
  let workDir: string;
  let stageDir: string;
  let destinationDir: string;
  let previousDbPath: string | undefined;

  beforeAll(() => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'workshop-backup-test-'));
    previousDbPath = process.env.WORKSHOP_DB_PATH;
    // Point the singleton db at an isolated path for this test suite.
    process.env.WORKSHOP_DB_PATH = path.join(workDir, 'workshop.db');
  });

  afterAll(() => {
    resetDatabase();
    if (previousDbPath !== undefined) {
      process.env.WORKSHOP_DB_PATH = previousDbPath;
    } else {
      delete process.env.WORKSHOP_DB_PATH;
    }
    rmSync(workDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    stageDir = mkdtempSync(path.join(os.tmpdir(), 'workshop-backup-stage-'));
    destinationDir = mkdtempSync(path.join(os.tmpdir(), 'workshop-backup-dest-'));

    // Populate a fake claude dir under stageDir.
    const claudeDir = path.join(stageDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({ foo: 'bar' }));
    writeFileSync(path.join(claudeDir, 'hooks-config.toml'), '[audit]\nlevel = "all"\n');
  });

  afterEach(() => {
    rmSync(stageDir, { recursive: true, force: true });
    rmSync(destinationDir, { recursive: true, force: true });
  });

  it('encrypts and restores a backup round-trip', async () => {
    const result = await runBackup({
      destination: destinationDir,
      passphrase: 'correct-horse-battery-staple',
      sources: { claudeDir: path.join(stageDir, '.claude') },
      now: new Date('2026-04-18T03:00:00Z'), // Saturday → daily
    });

    expect(result.kind).toBe('daily');
    expect(result.bytes).toBeGreaterThan(0);
    expect(existsSync(result.filePath)).toBe(true);

    const restoreDir = mkdtempSync(path.join(os.tmpdir(), 'workshop-backup-restore-'));
    try {
      await restoreBackup({
        source: result.filePath,
        passphrase: 'correct-horse-battery-staple',
        destinationDir: restoreDir,
      });

      const settingsRestored = readFileSync(
        path.join(restoreDir, 'claude', 'settings.json'),
        'utf-8',
      );
      expect(JSON.parse(settingsRestored)).toEqual({ foo: 'bar' });

      const hooksRestored = readFileSync(
        path.join(restoreDir, 'claude', 'hooks-config.toml'),
        'utf-8',
      );
      expect(hooksRestored).toContain('[audit]');

      const manifest = JSON.parse(
        readFileSync(path.join(restoreDir, 'manifest.json'), 'utf-8'),
      ) as { files: Array<{ staged: string }> };
      const stagedNames = manifest.files.map((f) => f.staged);
      expect(stagedNames).toContain('workshop.db');
      expect(stagedNames).toContain('claude/settings.json');
      expect(stagedNames).toContain('claude/hooks-config.toml');
    } finally {
      rmSync(restoreDir, { recursive: true, force: true });
    }
  });

  it('refuses to decrypt with the wrong passphrase', async () => {
    const result = await runBackup({
      destination: destinationDir,
      passphrase: 'correct-horse-battery-staple',
      sources: { claudeDir: path.join(stageDir, '.claude') },
    });

    const restoreDir = mkdtempSync(path.join(os.tmpdir(), 'workshop-backup-bad-'));
    try {
      await expect(
        restoreBackup({
          source: result.filePath,
          passphrase: 'wrong-passphrase',
          destinationDir: restoreDir,
        }),
      ).rejects.toThrow();
    } finally {
      rmSync(restoreDir, { recursive: true, force: true });
    }
  });

  it('tags Sunday runs as weekly', async () => {
    // 2026-04-19 is a Sunday.
    const sunday = new Date('2026-04-19T03:00:00Z');
    expect(isWeeklyDay(sunday)).toBe(true);

    const result = await runBackup({
      destination: destinationDir,
      passphrase: 'pw',
      sources: { claudeDir: path.join(stageDir, '.claude') },
      now: sunday,
    });

    expect(result.kind).toBe('weekly');
    expect(result.filePath).toContain('-weekly.tar.br.enc');
  });
});

describe('retention', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'workshop-backup-retention-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function seed(kind: 'daily' | 'weekly', day: string): string {
    const name = buildBackupFileName(kind, new Date(day));
    writeFileSync(path.join(dir, name), 'stub');
    return name;
  }

  it('keeps the newest 3 dailies and 4 weeklies', () => {
    // Five dailies, six weeklies — oldest first.
    seed('daily', '2026-03-01T03:00:00Z');
    seed('daily', '2026-03-02T03:00:00Z');
    seed('daily', '2026-03-03T03:00:00Z');
    seed('daily', '2026-03-04T03:00:00Z');
    seed('daily', '2026-03-05T03:00:00Z');

    seed('weekly', '2026-02-01T03:00:00Z');
    seed('weekly', '2026-02-08T03:00:00Z');
    seed('weekly', '2026-02-15T03:00:00Z');
    seed('weekly', '2026-02-22T03:00:00Z');
    seed('weekly', '2026-03-01T03:00:00Z');
    seed('weekly', '2026-03-08T03:00:00Z');

    const result = pruneBackups(dir);
    expect(result.kept.length).toBe(3 + 4);
    expect(result.deleted.length).toBe(2 + 2); // 2 oldest dailies + 2 oldest weeklies

    const surviving = readdirSync(dir);
    const dailies = surviving.filter((n) => n.includes('-daily')).sort();
    const weeklies = surviving.filter((n) => n.includes('-weekly')).sort();
    expect(dailies).toHaveLength(3);
    expect(weeklies).toHaveLength(4);
  });

  it('listBackups orders newest first', () => {
    seed('daily', '2026-01-01T03:00:00Z');
    seed('daily', '2026-02-01T03:00:00Z');
    const listed = listBackups(dir);
    expect(listed).toHaveLength(2);
    expect(listed[0].timestamp.startsWith('2026-02-01')).toBe(true);
  });
});
