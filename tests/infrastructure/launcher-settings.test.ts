import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { writeHookSettings } from '@infrastructure/terminal/launcher-builders';

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
