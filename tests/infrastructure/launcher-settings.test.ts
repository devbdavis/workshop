import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { writeHookSettings, buildClaudeLauncher } from '@infrastructure/terminal/launcher-builders';

const testDir = path.join(os.tmpdir(), `workshop-test-launcher-${randomUUID()}`);

describe('writeHookSettings', () => {
  beforeEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  function readSettings(file: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  }

  it('always writes SessionStart and SessionEnd hooks', () => {
    const file = writeHookSettings(testDir, 'session-1');
    const settings = readSettings(file);
    const hooks = settings.hooks as Record<string, unknown>;
    expect(hooks.SessionStart).toBeDefined();
    expect(hooks.SessionEnd).toBeDefined();
    expect(settings.enabledPlugins).toBeUndefined();
  });

  it('writes the enabledPlugins map with explicit true and false entries', () => {
    const file = writeHookSettings(testDir, 'session-2', {
      enabledPlugins: { 'ponytail@ponytail': true, 'other@mp': false },
    });
    const settings = readSettings(file);
    expect(settings.enabledPlugins).toEqual({ 'ponytail@ponytail': true, 'other@mp': false });
  });

  it('omits enabledPlugins when the map is empty', () => {
    const file = writeHookSettings(testDir, 'session-3', { enabledPlugins: {} });
    expect(readSettings(file).enabledPlugins).toBeUndefined();
  });

  it('keeps mcpServers alongside enabledPlugins', () => {
    const file = writeHookSettings(testDir, 'session-4', {
      mcpServers: { workshop: { command: 'npx' } },
      enabledPlugins: { 'ponytail@ponytail': true },
    });
    const settings = readSettings(file);
    expect(settings.mcpServers).toEqual({ workshop: { command: 'npx' } });
    expect(settings.enabledPlugins).toEqual({ 'ponytail@ponytail': true });
  });
});

describe('buildClaudeLauncher print vs interactive', () => {
  beforeEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });
  });

  function launch(options: Record<string, unknown>): string {
    const lines: string[] = [];
    buildClaudeLauncher(lines, 'sess-1', testDir, 'tmux-1', testDir, options);
    return lines.join('\n');
  }

  it('adds --print for scheduled background sessions (no todoId, no interactive)', () => {
    const script = launch({ background: true, initialPrompt: 'go' });
    expect(script).toContain('--print');
  });

  it('omits --print and uses exec when interactive is set on a background session', () => {
    const script = launch({ background: true, interactive: true, initialPrompt: 'go' });
    expect(script).not.toContain('--print');
    expect(script).toContain('exec claude');
  });

  it('omits --print when resuming a background session', () => {
    const script = launch({ background: true, claudeResumeId: 'abc-123' });
    expect(script).not.toContain('--print');
  });
});
