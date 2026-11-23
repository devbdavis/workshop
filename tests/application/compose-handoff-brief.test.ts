import { describe, it, expect } from 'vitest';
import { composeHandoffBrief, MAX_BRIEF_CHARS } from '@application/handoff/compose-handoff-brief.js';
import type { TranscriptMessage } from '@infrastructure/usage/transcript.js';

const todo = { title: 'Fix login', description: 'Do it', status: 'in-progress', issueKey: 'ENG-1', pullRequests: [{ url: 'https://x/pr/1' }] };
const text = (role: 'user' | 'assistant', t: string): TranscriptMessage => ({ id: null, role, timestamp: null, blocks: [{ type: 'text', text: t }] });
const tool = (name: string, hint: string, isError = false): TranscriptMessage => ({
  id: null, role: 'assistant', timestamp: null, blocks: [{ type: 'tool', name, hint, input: '', result: null, isError }],
});
const compose = (messages: TranscriptMessage[] | null, git: string | null = 'on main') =>
  composeHandoffBrief({ todo, fromProvider: 'claude', fromSessionId: 's1', messages, git });

describe('composeHandoffBrief', () => {
  it('includes card, git and rules in order', () => {
    const out = compose([]);
    expect(out.indexOf('## Handoff')).toBeLessThan(out.indexOf('## Kanban card'));
    expect(out.indexOf('## Kanban card')).toBeLessThan(out.indexOf('## Repo state at handoff'));
    expect(out).toContain('ENG-1');
    expect(out).toContain('https://x/pr/1');
  });

  it('keeps last 15 user messages, last 3 assistant texts, skips notes', () => {
    const msgs = [
      ...Array.from({ length: 20 }, (_, i) => text('user', `user-${i}`)),
      ...Array.from({ length: 5 }, (_, i) => text('assistant', `asst-${i}`)),
      { ...text('user', 'NOTE-BODY'), note: 'compaction' },
    ];
    const out = compose(msgs);
    expect(out).not.toContain('user-4\n');
    expect(out).toContain('user-5');
    expect(out).toContain('user-19');
    expect(out).not.toContain('asst-1');
    expect(out).toContain('asst-2');
    expect(out).not.toContain('NOTE-BODY');
  });

  it('dedupes files touched and flags errored tool calls', () => {
    const out = compose([tool('Edit', 'a.ts'), tool('write_file', 'a.ts'), tool('Read', 'b.ts'), tool('Bash', 'npm test', true)]);
    expect(out.match(/- a\.ts/g)).toHaveLength(1);
    expect(out).not.toMatch(/Files touched:[\s\S]*- b\.ts[\s\S]*Last tool calls/);
    expect(out).toContain('- Bash: npm test (error)');
  });

  it('caps the output', () => {
    const out = compose(null, 'x'.repeat(50_000));
    expect(out.length).toBeLessThanOrEqual(MAX_BRIEF_CHARS);
  });

  it('notes an unavailable transcript', () => {
    expect(compose(null, null)).toContain('Transcript unavailable');
  });
});
