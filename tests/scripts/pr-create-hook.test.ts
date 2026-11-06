import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const script = path.resolve(__dirname, '../../scripts/pr-create-hook.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-create-hook-'));
const withSkill = path.join(dir, 'with-skill');
const transcript = path.join(dir, 't.jsonl');

beforeAll(() => {
  fs.mkdirSync(path.join(withSkill, 'skills', 'submit-for-review'), { recursive: true });
  fs.writeFileSync(path.join(withSkill, 'skills', 'submit-for-review', 'SKILL.md'), '');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function run(
  command: string,
  transcriptText: string,
  configDir = withSkill,
  extra: Record<string, unknown> = {},
): string {
  fs.writeFileSync(transcript, transcriptText);
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command },
      transcript_path: transcript,
      ...extra,
    }),
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    encoding: 'utf-8',
  });
  expect(r.status).toBe(0);
  return r.stdout;
}

describe('pr-create-hook.mjs', () => {
  it('denies gh pr create before the skill was invoked', () => {
    const out = JSON.parse(run('git push -u origin x && gh pr create --title t', '{}'));
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    for (const cmd of ['gh -R o/r pr create', 'tea pr create']) {
      expect(JSON.parse(run(cmd, '{}')).hookSpecificOutput.permissionDecision).toBe('deny');
    }
  });

  it('allows once the skill was invoked via the Skill tool or slash command', () => {
    expect(
      run('gh pr create --draft', '{"name":"Skill","input":{"skill":"submit-for-review"}}'),
    ).toBe('');
    expect(run('tea pulls create', '<command-name>/submit-for-review</command-name>')).toBe('');
    expect(run('gh pr create', '{"skill":"workshop:submit-for-review"}')).toBe('');
  });

  it('ignores other commands and fails open when the skill is not installed', () => {
    expect(run('gh pr view 1', '{}')).toBe('');
    expect(run('gh pr create', '{}', path.join(dir, 'none'))).toBe('');
    expect(run('gh pr create', '{}', withSkill, { agent_id: 'a1' })).toBe('');
    expect(run('gh pr create', '{}', withSkill, { transcript_path: undefined })).toBe('');
  });
});
