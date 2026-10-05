import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { createSessionHistoryScanner } from '@infrastructure/usage/session-history';

const testDir = path.join(os.tmpdir(), `workshop-test-session-history-${randomUUID()}`);

describe('createSessionHistoryScanner', () => {
  beforeEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(testDir, 'project-a'), { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  function writeFixture(relPath: string, lines: string[]): string {
    const full = path.join(testDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, lines.join('\n') + '\n');
    return full;
  }

  it('extracts fields, applies title precedence, and skips command/meta/tool-result-only text for the preview', async () => {
    const sessionId = randomUUID();
    writeFixture(`project-a/${sessionId}.jsonl`, [
      JSON.stringify({ type: 'user', timestamp: '2026-07-01T00:00:00.000Z', cwd: '/repo/a', gitBranch: 'main', isMeta: true, message: { role: 'user', content: '<command-name>foo</command-name>' } }),
      JSON.stringify({ type: 'user', timestamp: '2026-07-01T00:00:01.000Z', cwd: '/repo/a', gitBranch: 'main', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }),
      'not valid json {{{',
      JSON.stringify({ type: 'user', timestamp: '2026-07-01T00:00:02.000Z', cwd: '/repo/a', gitBranch: 'feature-x', message: { role: 'user', content: '  Hello   world  ' } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-07-01T00:00:03.000Z', message: { model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'Hi there' }] } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-07-01T00:00:04.000Z', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'Read', input: {} }] } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-07-01T00:00:05.000Z', message: { model: '<synthetic>', content: [{ type: 'thinking', thinking: 'hmm' }] } }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'First AI title', sessionId }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Last AI title', sessionId }),
      JSON.stringify({ type: 'summary', summary: 'A fallback summary' }),
      JSON.stringify({ type: 'custom-title', customTitle: 'User-set title' }),
    ]);

    const scanner = createSessionHistoryScanner({ projectsDir: testDir });
    const entries = await scanner.list();
    expect(entries).toHaveLength(1);
    const entry = entries[0];

    expect(entry.sessionId).toBe(sessionId);
    expect(entry.cwd).toBe('/repo/a');
    expect(entry.gitBranch).toBe('feature-x'); // last non-empty
    expect(entry.model).toBe('claude-opus-5-5'); // last non-synthetic assistant model
    expect(entry.title).toBe('User-set title'); // custom-title > ai-title > summary
    expect(entry.preview).toBe('Hello world'); // skips isMeta command and tool_result-only entries
    expect(entry.firstAt).toBe('2026-07-01T00:00:00.000Z');
    expect(entry.lastAt).toBe('2026-07-01T00:00:05.000Z');
    expect(entry.messageCount).toBe(6); // 3 user + 3 assistant; the malformed line is skipped entirely
  });

  it('excludes subagent transcripts nested under a session directory', async () => {
    const sessionId = randomUUID();
    writeFixture(`project-a/${sessionId}.jsonl`, [
      JSON.stringify({ type: 'user', timestamp: '2026-07-01T00:00:00.000Z', message: { role: 'user', content: 'hi' } }),
    ]);
    writeFixture(`project-a/${sessionId}/subagents/sub1.jsonl`, [
      JSON.stringify({ type: 'user', timestamp: '2026-07-01T00:00:00.000Z', message: { role: 'user', content: 'subagent chatter' } }),
    ]);

    const scanner = createSessionHistoryScanner({ projectsDir: testDir });
    const entries = await scanner.list();
    expect(entries.map((e) => e.sessionId)).toEqual([sessionId]);
  });

  it('skips sessions with zero user/assistant entries', async () => {
    writeFixture('project-a/empty.jsonl', [
      JSON.stringify({ type: 'file-history-snapshot', timestamp: '2026-07-01T00:00:00.000Z' }),
      JSON.stringify({ type: 'system', timestamp: '2026-07-01T00:00:01.000Z' }),
    ]);

    const scanner = createSessionHistoryScanner({ projectsDir: testDir });
    const entries = await scanner.list();
    expect(entries).toHaveLength(0);
  });

  it('sorts by lastAt descending', async () => {
    const older = randomUUID();
    const newer = randomUUID();
    writeFixture(`project-a/${older}.jsonl`, [
      JSON.stringify({ type: 'user', timestamp: '2026-07-01T00:00:00.000Z', message: { role: 'user', content: 'old' } }),
    ]);
    writeFixture(`project-a/${newer}.jsonl`, [
      JSON.stringify({ type: 'user', timestamp: '2026-07-02T00:00:00.000Z', message: { role: 'user', content: 'new' } }),
    ]);

    const scanner = createSessionHistoryScanner({ projectsDir: testDir });
    const entries = await scanner.list();
    expect(entries.map((e) => e.sessionId)).toEqual([newer, older]);
  });

  it('re-parses a file once it changes and drops entries for deleted files', async () => {
    const sessionId = randomUUID();
    const file = writeFixture(`project-a/${sessionId}.jsonl`, [
      JSON.stringify({ type: 'user', timestamp: '2026-07-01T00:00:00.000Z', message: { role: 'user', content: 'v1' } }),
    ]);

    const scanner = createSessionHistoryScanner({ projectsDir: testDir });
    const first = await scanner.list();
    expect(first[0].messageCount).toBe(1);

    fs.appendFileSync(file, JSON.stringify({ type: 'assistant', timestamp: '2026-07-01T00:00:01.000Z', message: { content: [{ type: 'text', text: 'v2' }] } }) + '\n');
    const second = await scanner.list();
    expect(second[0].messageCount).toBe(2);

    fs.rmSync(file);
    const third = await scanner.list();
    expect(third).toHaveLength(0);
  });

  it('readTranscript renders text + tool_use, skips tool-result-only and thinking, and returns null for unknown sessions', async () => {
    const sessionId = randomUUID();
    writeFixture(`project-a/${sessionId}.jsonl`, [
      JSON.stringify({ type: 'user', timestamp: '2026-07-01T00:00:00.000Z', isMeta: true, message: { role: 'user', content: '<local-command-stdout>ignored</local-command-stdout>' } }),
      JSON.stringify({ type: 'user', timestamp: '2026-07-01T00:00:01.000Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }),
      JSON.stringify({ type: 'user', timestamp: '2026-07-01T00:00:02.000Z', message: { role: 'user', content: 'What does this do?' } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-07-01T00:00:03.000Z', message: { content: [{ type: 'thinking', thinking: 'let me check' }, { type: 'tool_use', name: 'Read', input: {} }] } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-07-01T00:00:04.000Z', message: { content: [{ type: 'text', text: 'It reads a file.' }] } }),
    ]);

    const scanner = createSessionHistoryScanner({ projectsDir: testDir });
    const messages = await scanner.readTranscript(sessionId);
    expect(messages).toEqual([
      { role: 'user', text: 'What does this do?', timestamp: '2026-07-01T00:00:02.000Z' },
      { role: 'assistant', text: '[tool: Read]', timestamp: '2026-07-01T00:00:03.000Z' },
      { role: 'assistant', text: 'It reads a file.', timestamp: '2026-07-01T00:00:04.000Z' },
    ]);

    expect(await scanner.readTranscript(randomUUID())).toBeNull();
  });
});
