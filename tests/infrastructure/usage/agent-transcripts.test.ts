import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codexToTranscript, geminiToTranscript, findCodexRollout, findGeminiChat } from '../../../src/infrastructure/usage/agent-transcripts';

const shape = (msgs: ReturnType<typeof codexToTranscript>) =>
  msgs.map((m) => [m.role, m.note ?? null, m.blocks.map((b) => (b.type === 'text' ? b.text : `${b.name}:${b.result}:${b.isError}`))]);

describe('codexToTranscript', () => {
  const ri = (payload: object) => ({ timestamp: 't', type: 'response_item', payload });
  it('prefers user_message events, folds tool output into calls, and skips injected context', () => {
    const msgs = codexToTranscript([
      { type: 'session_meta', payload: { id: 'x', cwd: '/w' } },
      ri({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>…' }] }),
      ri({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix it' }] }),
      { type: 'event_msg', payload: { type: 'user_message', message: 'fix it' } },
      ri({ type: 'reasoning', summary: [] }),
      ri({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'On it' }] }),
      ri({ type: 'function_call', name: 'shell', arguments: '{"command":["ls"]}', call_id: 'c1' }),
      ri({ type: 'function_call_output', call_id: 'c1', output: '{"output":"boom","metadata":{"exit_code":1}}' }),
      { type: 'compacted', payload: { message: 'summary' } },
    ]);
    expect(shape(msgs)).toEqual([
      ['user', null, ['fix it']],
      ['assistant', null, ['On it', 'shell:boom:true']],
      ['user', 'Conversation compacted', ['summary']],
    ]);
  });

  it('falls back to response_item user messages on older logs', () => {
    const msgs = codexToTranscript([ri({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] })]);
    expect(shape(msgs)).toEqual([['user', null, ['hello']]]);
  });
});

describe('geminiToTranscript', () => {
  const messages = [
    { id: 'a', type: 'user', content: [{ text: 'hi' }] },
    { id: 'b', type: 'gemini', content: 'Reading', toolCalls: [{ name: 'read_file', args: { file_path: 'x' }, status: 'success', resultDisplay: 'ok' }] },
    { id: 'i', type: 'info', content: 'noise' },
  ];
  it('reads the legacy single-JSON file', () => {
    expect(shape(geminiToTranscript(JSON.stringify({ sessionId: 's', messages }, null, 2)))).toEqual([
      ['user', null, ['hi']],
      ['assistant', null, ['Reading', 'read_file:ok:false']],
    ]);
  });
  it('reads JSONL, letting a later line with the same id update the message', () => {
    const lines = [{ sessionId: 's', projectHash: 'h' }, ...messages, { id: 'b', type: 'gemini', content: 'Read it' }];
    expect(shape(geminiToTranscript(lines.map((l) => JSON.stringify(l)).join('\n')))[1][2][0]).toBe('Read it');
  });
});

describe('finders', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tx-'));
  const write = (f: string, body: string) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
  it('finds the Codex rollout whose session_meta cwd matches', () => {
    const now = new Date();
    const day = path.join(tmp, 'codex/sessions', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'));
    write(path.join(day, 'rollout-a.jsonl'), JSON.stringify({ type: 'session_meta', payload: { cwd: '/other' } }));
    write(path.join(day, 'rollout-b.jsonl'), JSON.stringify({ type: 'session_meta', payload: { cwd: '/w "q"' } }));
    expect(findCodexRollout('/w "q"', Date.now() - 60_000, path.join(tmp, 'codex'))).toBe(path.join(day, 'rollout-b.jsonl'));
    expect(findCodexRollout('/w "q"', Date.now() + 60_000, path.join(tmp, 'codex'))).toBeNull();
  });
  it('finds the Gemini chat under the sha256(cwd) project dir', () => {
    const hash = createHash('sha256').update('/w').digest('hex');
    write(path.join(tmp, 'gemini/tmp', hash, 'chats/session-1.json'), '{}');
    expect(findGeminiChat('/w', Date.now() - 60_000, path.join(tmp, 'gemini'))).toBe(path.join(tmp, 'gemini/tmp', hash, 'chats/session-1.json'));
    expect(findGeminiChat('/nope', Date.now() - 60_000, path.join(tmp, 'gemini'))).toBeNull();
  });
});
