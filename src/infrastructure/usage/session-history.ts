import fs from 'fs';
import path from 'path';

import { DEFAULT_PROJECTS_DIR, listJsonlFiles, parseJsonlLines } from './jsonl.js';

export interface SessionHistoryEntry {
  sessionId: string;
  filePath: string;
  cwd: string | null;
  gitBranch: string | null;
  model: string | null;
  title: string | null;
  preview: string | null;
  firstAt: string | null;
  lastAt: string | null;
  messageCount: number;
}

export interface TranscriptMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string | null;
}

export interface SessionHistoryScanner {
  list(): Promise<SessionHistoryEntry[]>;
  readTranscript(sessionId: string): Promise<TranscriptMessage[] | null>;
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  entry: SessionHistoryEntry | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** First human-authored text in a user message's content, or null if it's a command/meta block. */
function extractPromptText(content: unknown): string | null {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed && !trimmed.startsWith('<') ? trimmed : null;
  }
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const raw of content) {
    const block = asRecord(raw);
    if (!block || block.type !== 'text' || typeof block.text !== 'string') continue;
    const trimmed = block.text.trim();
    if (trimmed && !trimmed.startsWith('<')) parts.push(trimmed);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

/** Renders a transcript message's content: text blocks joined, tool_use as "[tool: name]", thinking/tool_result/image skipped. */
function extractTranscriptText(content: unknown): string | null {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed || null;
  }
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const raw of content) {
    const block = asRecord(raw);
    if (!block) continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      const trimmed = block.text.trim();
      if (trimmed) parts.push(trimmed);
    } else if (block.type === 'tool_use' && typeof block.name === 'string') {
      parts.push(`[tool: ${block.name}]`);
    }
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

function buildEntry(lines: unknown[], sessionId: string, filePath: string, mtimeIso: string): SessionHistoryEntry | null {
  let cwd: string | null = null;
  let gitBranch: string | null = null;
  let model: string | null = null;
  let customTitle: string | null = null;
  let aiTitle: string | null = null;
  let summary: string | null = null;
  let preview: string | null = null;
  let firstAt: string | null = null;
  let firstAtMs = Infinity;
  let lastAt: string | null = null;
  let lastAtMs = -Infinity;
  let messageCount = 0;

  for (const raw of lines) {
    const entry = asRecord(raw);
    if (!entry) continue;

    if (cwd === null && typeof entry.cwd === 'string') cwd = entry.cwd;
    if (typeof entry.gitBranch === 'string' && entry.gitBranch) gitBranch = entry.gitBranch;

    if (typeof entry.timestamp === 'string') {
      const ms = Date.parse(entry.timestamp);
      if (!Number.isNaN(ms)) {
        if (ms < firstAtMs) { firstAtMs = ms; firstAt = entry.timestamp; }
        if (ms > lastAtMs) { lastAtMs = ms; lastAt = entry.timestamp; }
      }
    }

    if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') customTitle = entry.customTitle;
    if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string') aiTitle = entry.aiTitle;
    if (entry.type === 'summary' && typeof entry.summary === 'string') summary = entry.summary;

    if (entry.type === 'user' || entry.type === 'assistant') messageCount += 1;

    if (entry.type === 'assistant') {
      const message = asRecord(entry.message);
      if (message && typeof message.model === 'string' && message.model !== '<synthetic>') {
        model = message.model;
      }
    }

    if (entry.type === 'user' && preview === null && entry.isMeta !== true) {
      const message = asRecord(entry.message);
      const text = message ? extractPromptText(message.content) : null;
      if (text) preview = collapseWhitespace(text).slice(0, 200);
    }
  }

  if (messageCount === 0) return null;

  return {
    sessionId,
    filePath,
    cwd,
    gitBranch,
    model,
    title: customTitle ?? aiTitle ?? summary ?? null,
    preview,
    firstAt,
    lastAt: lastAt ?? mtimeIso,
    messageCount,
  };
}

function toTranscript(lines: unknown[]): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  for (const raw of lines) {
    const entry = asRecord(raw);
    if (!entry) continue;
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    if (entry.isMeta === true) continue;
    const message = asRecord(entry.message);
    const text = message ? extractTranscriptText(message.content) : null;
    if (!text) continue;
    messages.push({
      role: entry.type as 'user' | 'assistant',
      text,
      timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : null,
    });
  }
  return messages;
}

/** Scans `~/.claude/projects` for top-level Claude Code session transcripts (excludes subagent sub-transcripts). */
export function createSessionHistoryScanner(deps: { projectsDir?: string } = {}): SessionHistoryScanner {
  const projectsDir = deps.projectsDir ?? DEFAULT_PROJECTS_DIR;
  const cache = new Map<string, CacheEntry>();

  async function list(): Promise<SessionHistoryEntry[]> {
    // Sessions sit exactly at <projectsDir>/<project>/<id>.jsonl; deeper files are subagent/tool sidecars.
    const files = listJsonlFiles(projectsDir).filter((file) => path.dirname(path.dirname(file)) === path.resolve(projectsDir));
    const seen = new Set<string>();
    const entries: SessionHistoryEntry[] = [];

    for (const file of files) {
      seen.add(file);
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(file);
      } catch {
        continue;
      }

      const cached = cache.get(file);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        if (cached.entry) entries.push(cached.entry);
        continue;
      }

      let content: string;
      try {
        content = await fs.promises.readFile(file, 'utf-8');
      } catch {
        continue;
      }
      const sessionId = path.basename(file, '.jsonl');
      const entry = buildEntry(parseJsonlLines(content), sessionId, file, stat.mtime.toISOString());
      cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, entry });
      if (entry) entries.push(entry);
    }

    for (const key of cache.keys()) {
      if (!seen.has(key)) cache.delete(key);
    }

    entries.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
    return entries;
  }

  async function readTranscript(sessionId: string): Promise<TranscriptMessage[] | null> {
    await list(); // refresh the cache so a just-renamed/updated file resolves correctly
    const cached = [...cache.values()].find((c) => c.entry?.sessionId === sessionId);
    if (!cached?.entry) return null;

    let content: string;
    try {
      content = await fs.promises.readFile(cached.entry.filePath, 'utf-8');
    } catch {
      return null;
    }
    return toTranscript(parseJsonlLines(content));
  }

  return { list, readTranscript };
}
