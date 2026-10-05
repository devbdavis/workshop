import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { writeHookSettings, buildClaudeLauncher, buildCodexLauncher } from '@infrastructure/terminal/launcher-builders';

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

  it('writes activity hooks with the right status arg', () => {
    const hooks = readSettings(writeHookSettings(testDir, 'session-a')).hooks as Record<
      string,
      { matcher?: string; hooks: { command: string }[] }[]
    >;
    const expected: [string, string, string | undefined][] = [
      ['UserPromptSubmit', 'working', undefined],
      ['Stop', 'idle', undefined],
      ['Notification', 'needs-input', 'permission_prompt|elicitation_dialog'],
      ['PreToolUse', 'needs-input', 'AskUserQuestion'],
      ['PostToolUse', 'working', 'AskUserQuestion'],
    ];
    for (const [event, status, matcher] of expected) {
      expect(hooks[event][0].matcher).toBe(matcher);
      expect(hooks[event][0].hooks[0].command).toMatch(
        new RegExp(`session-activity-hook\\.sh ${status}$`),
      );
    }
  });

  it('omits activity hooks for --print runs', () => {
    const hooks = readSettings(writeHookSettings(testDir, 'session-p', { skipActivityHooks: true }))
      .hooks as Record<string, unknown>;
    expect(hooks.Stop).toBeUndefined();
    expect(hooks.SessionEnd).toBeDefined();
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

  it('attaches the Workshop MCP server via --mcp-config before --settings', () => {
    const script = launch({ initialPrompt: 'go' });
    expect(script).toMatch(/--mcp-config "[^"]*mcp\.json" --settings /);
    const config = JSON.parse(fs.readFileSync(path.join(testDir, 'mcp.json'), 'utf-8'));
    expect(config.mcpServers.workshop.args[0]).toMatch(/src\/mcp\/server\.ts$/);
  });

  it('omits --print when resuming a background session', () => {
    const script = launch({ background: true, claudeResumeId: 'abc-123' });
    expect(script).not.toContain('--print');
  });
});

describe('buildCodexLauncher activity hooks', () => {
  it('wires activity hooks with a session-independent command for interactive sessions', () => {
    const lines: string[] = [];
    buildCodexLauncher(lines, 'sess-x', testDir, '/tmp/cwd');
    expect(lines[0]).toContain('WORKSHOP_SESSION_ID=sess-x');
    const exec = lines[1];
    for (const [event, status] of [['UserPromptSubmit', 'working'], ['Stop', 'idle'], ['Interrupt', 'idle'], ['PermissionRequest', 'needs-input']]) {
      expect(exec).toMatch(new RegExp(`hooks\\.${event}=.*session-activity-hook\\.sh ${status}"`));
    }
    // Codex trusts hooks by command hash — a per-session ID in the command would force re-review every launch.
    expect(exec).not.toContain('sess-x');
  });

  it('adds no hooks to codex exec (background), which never runs them', () => {
    const lines: string[] = [];
    buildCodexLauncher(lines, 'sess-y', testDir, '/tmp/cwd', { background: true, initialPrompt: 'hi' });
    expect(lines.join('\n')).not.toContain('hooks.');
  });
});
