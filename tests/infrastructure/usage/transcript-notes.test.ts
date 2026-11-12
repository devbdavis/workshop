import { describe, it, expect } from 'vitest';
import { toTranscript } from '../../../src/infrastructure/usage/transcript';

const user = (content: string, extra = {}) => ({ type: 'user', uuid: content.slice(0, 8), message: { content }, ...extra });

describe('toTranscript harness turns', () => {
  it('turns compaction, task notifications and interrupts into notes; slash commands into plain text', () => {
    const msgs = toTranscript([
      { type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' },
      user('This session is being continued…', { isCompactSummary: true }),
      user('<task-notification>\n<task-id>x</task-id>\n<summary>Agent "Review" finished</summary>\n<result>## clean</result>\n</task-notification>'),
      user('[Request interrupted by user for tool use]'),
      user('<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>PR 4</command-args>'),
      user('hi'),
    ]);
    expect(msgs.map((m) => [m.note, m.blocks.map((b) => (b.type === 'text' ? b.text : b.type))])).toEqual([
      ['Conversation compacted', ['This session is being continued…']],
      ['Agent "Review" finished', ['## clean']],
      ['Interrupted by user', []],
      [undefined, ['/review PR 4']],
      [undefined, ['hi']],
    ]);
  });
});
