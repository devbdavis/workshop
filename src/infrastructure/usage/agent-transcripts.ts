// Transcript readers for non-Claude CLIs, built from community-documented formats (neither vendor publishes a schema).
// Unknown record types are skipped, so format drift degrades to missing turns rather than errors.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clip, toolHint, type TranscriptBlock, type TranscriptMessage } from './transcript.js';

type ToolBlock = Extract<TranscriptBlock, { type: 'tool' }>;
type Rec = Record<string, unknown>;

const rec = (v: unknown): Rec | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const parseJson = (v: string): unknown => { try { return JSON.parse(v); } catch { return null; } };
const jsonl = (content: string): unknown[] => content.split('\n').filter((l) => l.trim()).map(parseJson).filter(Boolean);

function tool(name: string, input: unknown, toolsById: Map<string, ToolBlock>, id: unknown): ToolBlock {
  const t: ToolBlock = { type: 'tool', name, hint: toolHint(rec(input)), input: clip(typeof input === 'string' ? input : JSON.stringify(input ?? {}, null, 2)), result: null, isError: false };
  if (typeof id === 'string') toolsById.set(id, t);
  return t;
}

/** Codex rollout JSONL: {timestamp, type, payload} envelopes. */
export function codexToTranscript(lines: unknown[]): TranscriptMessage[] {
  const out: TranscriptMessage[] = [];
  const toolsById = new Map<string, ToolBlock>();
  // Newer Codex logs the typed prompt as event_msg/user_message; response_item user messages then also carry injected context.
  const hasUserEvents = lines.some((l) => rec(rec(l)?.payload)?.type === 'user_message');
  const push = (role: 'user' | 'assistant', blocks: TranscriptBlock[], ts: unknown, note?: string) => {
    const last = out.at(-1);
    // Consecutive assistant items (text, then tool calls) read as one turn.
    if (!note && role === 'assistant' && last?.role === 'assistant' && !last.note) last.blocks.push(...blocks);
    else out.push({ id: null, role, blocks, timestamp: typeof ts === 'string' ? ts : null, ...(note ? { note } : {}) });
  };

  for (const raw of lines) {
    const e = rec(raw);
    const p = rec(e?.payload);
    if (!e || !p) continue;
    if (e.type === 'compacted') {
      push('user', str(p.message) ? [{ type: 'text', text: str(p.message) }] : [], e.timestamp, 'Conversation compacted');
    } else if (e.type === 'event_msg' && p.type === 'user_message' && str(p.message).trim()) {
      push('user', [{ type: 'text', text: str(p.message).trim() }], e.timestamp);
    } else if (e.type === 'response_item' && p.type === 'message') {
      if (p.role !== 'assistant' && (p.role !== 'user' || hasUserEvents)) continue;
      const text = (Array.isArray(p.content) ? p.content : []).map((c) => str(rec(c)?.text)).join('\n').trim();
      // Injected context (AGENTS.md, <environment_context>) arrives as user messages wrapped in tags.
      if (!text || (p.role === 'user' && (text.startsWith('<') || text.startsWith('# AGENTS.md')))) continue;
      push(p.role, [{ type: 'text', text }], e.timestamp);
    } else if (e.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call')) {
      const input = p.type === 'function_call' ? (parseJson(str(p.arguments)) ?? p.arguments) : (p.input ?? p.action);
      push('assistant', [tool(str(p.name) || 'shell', input, toolsById, p.call_id)], e.timestamp);
    } else if (e.type === 'response_item' && (p.type === 'function_call_output' || p.type === 'custom_tool_call_output')) {
      const t = toolsById.get(str(p.call_id));
      if (!t) continue;
      // output is plain text, or a JSON string {output, metadata: {exit_code}}.
      const parsed = rec(parseJson(str(p.output)));
      t.result = clip(parsed ? str(parsed.output) : str(p.output) || JSON.stringify(p.output ?? ''));
      t.isError = typeof rec(parsed?.metadata)?.exit_code === 'number' && rec(parsed?.metadata)?.exit_code !== 0;
    }
  }
  return out;
}

const partsText = (c: unknown): string =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : str(rec(x)?.text))).join('') : '';

/** Gemini CLI chat file: legacy single JSON {messages: [...]}, or JSONL where a later line with the same id replaces the earlier one. */
export function geminiToTranscript(content: string): TranscriptMessage[] {
  const legacy = rec(parseJson(content)); // JSONL with 2+ lines never parses whole
  const records = Array.isArray(legacy?.messages) ? legacy.messages : jsonl(content);
  const byId = new Map<string, Rec>();
  const ordered: Rec[] = [];
  for (const r of records.map(rec)) {
    if (!r || (r.type !== 'user' && r.type !== 'gemini')) continue;
    const id = str(r.id);
    const prev = id ? byId.get(id) : undefined;
    if (prev) Object.assign(prev, r);
    else { ordered.push(r); if (id) byId.set(id, r); }
  }
  return ordered.flatMap((m): TranscriptMessage[] => {
    const blocks: TranscriptBlock[] = [];
    const text = partsText(m.content).trim();
    if (text) blocks.push({ type: 'text', text });
    for (const c of Array.isArray(m.toolCalls) ? m.toolCalls.map(rec) : []) {
      if (!c) continue;
      const t = tool(str(c.displayName) || str(c.name) || 'tool', c.args, new Map(), null);
      const response = rec(rec(rec((Array.isArray(c.result) ? c.result : [])[0])?.functionResponse)?.response);
      const result = str(c.resultDisplay) || str(response?.output) || str(response?.error);
      if (c.status !== 'executing' && c.status !== 'scheduled') t.result = clip(result);
      t.isError = c.status === 'error' || c.status === 'cancelled';
      blocks.push(t);
    }
    if (blocks.length === 0) return [];
    return [{ id: str(m.id) || null, role: m.type === 'user' ? 'user' : 'assistant', blocks, timestamp: str(m.timestamp) || null }];
  });
}

function newestFile(files: string[], sinceMs: number): string | null {
  let best: { file: string; mtime: number } | null = null;
  for (const file of files) {
    try {
      const mtime = fs.statSync(file).mtimeMs;
      if (mtime >= sinceMs && (!best || mtime > best.mtime)) best = { file, mtime };
    } catch { /* vanished */ }
  }
  return best?.file ?? null;
}

const listDir = (dir: string): string[] => { try { return fs.readdirSync(dir).map((n) => path.join(dir, n)); } catch { return []; } };

const rolloutCwd = new Map<string, string>(); // a rollout's cwd never changes, so read each header once

// shortcut: matches on cwd + "modified since the session started", so two same-cwd sessions of one CLI can cross;
// capture the CLI's own session id (as Claude's SessionStart hook does) if that bites.
export function findCodexRollout(cwd: string, sinceMs: number, home = process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex')): string | null {
  const day = new Date(sinceMs - 86_400_000); // day dirs are local time; a day of slack covers TZ skew
  const files: string[] = [];
  for (const y of listDir(path.join(home, 'sessions'))) for (const m of listDir(y)) for (const d of listDir(m)) {
    const [yy, mm, dd] = path.relative(path.join(home, 'sessions'), d).split(path.sep).map(Number);
    if (new Date(yy, mm - 1, dd) < day) continue;
    for (const f of listDir(d)) {
      if (!f.endsWith('.jsonl')) continue;
      const known = rolloutCwd.get(f);
      if (known !== undefined) { if (known === cwd) files.push(f); continue; }
      try {
        const fd = fs.openSync(f, 'r');
        const buf = Buffer.alloc(64 * 1024);
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        // session_meta lines can be big (they embed instructions), so look for the cwd field rather than parse the line.
        const found = buf.toString('utf8', 0, n).match(/"cwd":("(?:[^"\\]|\\.)*")/)?.[1];
        if (!found) continue; // header not written yet; retry next poll
        rolloutCwd.set(f, JSON.parse(found) as string);
        if (rolloutCwd.get(f) === cwd) files.push(f);
      } catch { /* unreadable */ }
    }
  }
  return newestFile(files, sinceMs);
}

export function findGeminiChat(cwd: string, sinceMs: number, home = path.join(os.homedir(), '.gemini')): string | null {
  const hash = createHash('sha256').update(cwd).digest('hex');
  const projectDirs = listDir(path.join(home, 'tmp')).filter((dir) => {
    if (path.basename(dir) === hash) return true;
    try { return fs.readFileSync(path.join(dir, '.project_root'), 'utf8').trim() === cwd; } catch { return false; }
  });
  return newestFile(projectDirs.flatMap((d) => listDir(path.join(d, 'chats')).filter((f) => /\.jsonl?$/.test(f))), sinceMs);
}

/** Locates and parses a Codex/Gemini session's transcript; null when the CLI isn't supported or nothing matches. */
export function readAgentTranscript(provider: string, cwd: string, sinceMs: number): { file: string; read: () => TranscriptMessage[] } | null {
  const file = provider === 'codex' ? findCodexRollout(cwd, sinceMs) : provider === 'gemini' ? findGeminiChat(cwd, sinceMs) : null;
  if (!file) return null;
  return {
    file,
    read: () => {
      const content = fs.readFileSync(file, 'utf8');
      return provider === 'codex' ? codexToTranscript(jsonl(content)) : geminiToTranscript(content);
    },
  };
}
