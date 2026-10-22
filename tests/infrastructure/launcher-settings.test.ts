import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { writeHookSettings, buildClaudeLauncher, buildCodexLauncher, buildGeminiLauncher } from '@infrastructure/terminal/launcher-builders';

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

  it('installs PermissionDenied and a catch-all PreToolUse hook, even for --print runs', () => {
    for (const skipActivityHooks of [false, true]) {
      const hooks = readSettings(writeHookSettings(testDir, 'session-perm', { skipActivityHooks }))
        .hooks as Record<string, { matcher?: string; hooks: { command: string; timeout: number }[] }[]>;
      const denied = hooks.PermissionDenied[0];
      expect(denied.hooks[0].command).toMatch(/WORKSHOP_SESSION_ID=session-perm .*permission-hook\.mjs"? claude-denied$/);
      expect(denied.hooks[0].timeout).toBe(600);
      const pre = hooks.PreToolUse.at(-1)!;
      expect(pre.matcher).toBeUndefined();
      expect(pre.hooks[0].command).toMatch(/permission-hook\.mjs"? claude-pretool$/);
      expect(pre.hooks[0].timeout).toBe(5);
    }
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

describe('permission hooks for codex and gemini', () => {
  it('runs both the activity hook and permission-hook for Codex PermissionRequest', () => {
    const lines: string[] = [];
    buildCodexLauncher(lines, 'sess-x', testDir, '/tmp/cwd');
    const arg = lines[1].match(/'hooks\.PermissionRequest=[^']*(?:'\\''[^']*)*'/)![0];
    expect(arg).toContain('session-activity-hook.sh needs-input');
    expect(arg).toMatch(/permission-hook\.mjs\\" codex-request.*timeout=600/);
  });

  it('writes a Gemini BeforeTool settings file and exports its path', () => {
    fs.mkdirSync(testDir, { recursive: true });
    const lines: string[] = [];
    buildGeminiLauncher(lines, 'sess-g', testDir, '/tmp/cwd');
    const file = path.join(testDir, 'gemini-settings.json');
    const cfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(cfg.hooks.BeforeTool[0].matcher).toBe('.*');
    expect(cfg.hooks.BeforeTool[0].hooks[0]).toMatchObject({ type: 'command', timeout: 5000 });
    expect(cfg.hooks.BeforeTool[0].hooks[0].command).toMatch(/permission-hook\.mjs"? gemini-before-tool$/);
    const script = lines.join('\n');
    expect(script).toContain(`export GEMINI_CLI_SYSTEM_SETTINGS_PATH=${JSON.stringify(file)}`);
    expect(script).toContain('WORKSHOP_SESSION_ID=sess-g');
  });
});
