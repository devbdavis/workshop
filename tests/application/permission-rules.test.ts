import { describe, it, expect } from 'vitest';
import {
  normalizeTool,
  suggestPattern,
  ruleMatches,
  summarize,
} from '@application/permissions/rules';

const rule = (pattern: string | null, toolName = 'shell') => ({ toolName, pattern });
const sh = (command: string) => ({ command });

describe('permission rules', () => {
  it('normalizes shell tool names only', () => {
    for (const t of ['Bash', 'run_shell_command', 'shell', 'exec_command', 'local_shell']) {
      expect(normalizeTool(t)).toBe('shell');
    }
    expect(normalizeTool('Write')).toBe('Write');
  });

  it('suggests up to 3 leading tokens, stopping at flags and quotes', () => {
    expect(suggestPattern('Bash', sh('gh pr create --title x'))).toBe('gh pr create');
    expect(suggestPattern('Bash', sh('git commit -m "x"'))).toBe('git commit');
    expect(suggestPattern('Bash', sh('npm run build extra'))).toBe('npm run build');
    expect(suggestPattern('Write', { file_path: '/a' })).toBeNull();
  });

  it('summarizes shell and file tools', () => {
    expect(summarize('Bash', sh('ls'))).toBe('ls');
    expect(summarize('Write', { file_path: '/a/b' })).toBe('/a/b');
    expect(summarize('Other', { x: 'y'.repeat(400) })).toHaveLength(300);
  });

  it('matches prefix on word boundary and rejects chaining', () => {
    const r = rule('gh pr create');
    expect(ruleMatches(r, 'Bash', sh('gh pr create'))).toBe(true);
    expect(ruleMatches(r, 'Bash', sh('gh pr create --draft'))).toBe(true);
    expect(ruleMatches(r, 'Bash', sh('gh pr createx'))).toBe(false);
    expect(ruleMatches(r, 'Bash', sh('gh pr create && rm -rf x'))).toBe(false);
    for (const c of [
      'gh pr create; ls',
      'gh pr create | cat',
      'gh pr create `x`',
      'gh pr create $(x)',
      'gh pr create > f',
      'gh pr create\nls',
    ]) {
      expect(ruleMatches(r, 'Bash', sh(c))).toBe(false);
    }
  });

  it('null pattern matches any input of the same tool only', () => {
    expect(ruleMatches(rule(null, 'Write'), 'Write', { file_path: '/x' })).toBe(true);
    expect(ruleMatches(rule(null, 'Write'), 'Edit', {})).toBe(false);
  });
});
