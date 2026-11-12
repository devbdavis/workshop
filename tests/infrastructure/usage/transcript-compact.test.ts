import { describe, it, expect } from 'vitest';
import { toTranscript } from '../../../src/infrastructure/usage/transcript';

describe('toTranscript compaction', () => {
  it('flags the compact summary and leaves normal user turns alone', () => {
    const msgs = toTranscript([
      { type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' },
      { type: 'user', uuid: 'a', isCompactSummary: true, message: { content: 'This session is being continued…' } },
      { type: 'user', uuid: 'b', message: { content: 'hi' } },
    ]);
    expect(msgs.map((m) => [m.id, m.compact])).toEqual([['a', true], ['b', undefined]]);
  });
});
