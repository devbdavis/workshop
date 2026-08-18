import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { installScheduleScript } from '@application/scheduler/schedule-importer';

describe('installScheduleScript', () => {
  let projectRoot: string;
  let home: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(os.tmpdir(), 'ws-proj-'));
    home = mkdtempSync(path.join(os.tmpdir(), 'ws-home-'));
    originalHome = process.env.HOME;
    process.env.HOME = home;
    mkdirSync(path.join(projectRoot, 'scripts', 'schedules'), { recursive: true });
    writeFileSync(path.join(projectRoot, 'scripts', 'schedules', 'demo.sh'), '#!/usr/bin/env bash\necho hi\n');
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  const def = {
    name: 'Demo',
    scheduleConfig: { preset: 'daily' as const, time: '09:00' },
    taskPrompt: 'run it',
    scriptFile: 'scripts/schedules/demo.sh',
    scriptInstallPath: '~/.claude/scripts/demo.sh',
  };

  it('copies the script to its install path as executable', () => {
    const installed = installScheduleScript(projectRoot, def);
    expect(installed).toBe(path.join(home, '.claude/scripts/demo.sh'));
    expect(readFileSync(installed!, 'utf-8')).toContain('echo hi');
    expect(statSync(installed!).mode & 0o111).toBeTruthy();
  });

  it('returns undefined when the definition has no script', () => {
    expect(installScheduleScript(projectRoot, { ...def, scriptFile: undefined })).toBeUndefined();
  });

  it('returns undefined when the source script is missing', () => {
    expect(installScheduleScript(projectRoot, { ...def, scriptFile: 'scripts/schedules/nope.sh' })).toBeUndefined();
  });
});
