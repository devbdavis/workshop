import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the modules that resolveClaudeBinary depends on. Must be hoisted
// before the import below — vi.mock calls are hoisted automatically by vitest.
vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));
vi.mock('os', () => ({
  default: { homedir: vi.fn() },
  homedir: vi.fn(),
}));

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import os from 'os';
import {
  resolveClaudeBinary,
  extractJson,
  ClaudeBinaryNotFoundError,
  _resetClaudeBinaryCache,
} from '@server/claude-cli';

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);
const mockHomedir = vi.mocked(os.homedir);

describe('resolveClaudeBinary', () => {
  beforeEach(() => {
    _resetClaudeBinaryCache();
    mockExecSync.mockReset();
    mockExistsSync.mockReset();
    mockHomedir.mockReset();
    mockHomedir.mockReturnValue('/home/user');
  });

  afterEach(() => {
    _resetClaudeBinaryCache();
  });

  it('returns the path from `command -v claude` when on PATH', () => {
    mockExecSync.mockReturnValue('/usr/bin/claude\n' as unknown as Buffer);
    mockExistsSync.mockReturnValue(true);

    expect(resolveClaudeBinary()).toBe('/usr/bin/claude');
  });

  it('falls back to ~/.local/bin/claude when not on PATH', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    mockExistsSync.mockImplementation((p) => p === '/home/user/.local/bin/claude');

    expect(resolveClaudeBinary()).toBe('/home/user/.local/bin/claude');
  });

  it('falls back to /opt/homebrew/bin/claude when no other candidate exists', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    mockExistsSync.mockImplementation((p) => p === '/opt/homebrew/bin/claude');

    expect(resolveClaudeBinary()).toBe('/opt/homebrew/bin/claude');
  });

  it('returns null when no candidate exists', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    mockExistsSync.mockReturnValue(false);

    expect(resolveClaudeBinary()).toBeNull();
  });

  it('caches the resolved path across calls', () => {
    mockExecSync.mockReturnValue('/usr/bin/claude\n' as unknown as Buffer);
    mockExistsSync.mockReturnValue(true);

    resolveClaudeBinary();
    resolveClaudeBinary();
    resolveClaudeBinary();

    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it('caches null results too (no point re-probing every request)', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    mockExistsSync.mockReturnValue(false);

    expect(resolveClaudeBinary()).toBeNull();
    expect(resolveClaudeBinary()).toBeNull();

    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });
});

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"name":"foo"}')).toEqual({ name: 'foo' });
  });

  it('extracts JSON from surrounding prose', () => {
    const text = 'Here is your result:\n\n{"name":"foo","value":42}\n\nLet me know if you need more.';
    expect(extractJson(text)).toEqual({ name: 'foo', value: 42 });
  });

  it('throws when no JSON object is present', () => {
    expect(() => extractJson('no json here')).toThrow(/No JSON object found/);
  });

  it('throws on malformed JSON', () => {
    expect(() => extractJson('{this is not json}')).toThrow();
  });
});

describe('ClaudeBinaryNotFoundError', () => {
  it('is identifiable by instanceof', () => {
    const err = new ClaudeBinaryNotFoundError();
    expect(err).toBeInstanceOf(ClaudeBinaryNotFoundError);
    expect(err).toBeInstanceOf(Error);
  });

  it('mentions Claude Code and PATH in the message', () => {
    const err = new ClaudeBinaryNotFoundError();
    expect(err.message).toMatch(/Claude Code/);
    expect(err.message).toMatch(/PATH/);
  });
});
