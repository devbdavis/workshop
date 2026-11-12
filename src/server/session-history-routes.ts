import { existsSync, statSync } from 'fs';
import { Router } from 'express';
import type { SessionId, TrackId } from '@foundation/types';
import type { SessionRepository } from '@domain/session/repository';
import type { TrackRepository } from '@domain/track/repository';
import type { TerminalManager } from '@infrastructure/terminal/manager.js';
import type { SessionHistoryEntry, SessionHistoryScanner } from '@infrastructure/usage/session-history.js';
import { readAgentTranscript } from '@infrastructure/usage/agent-transcripts.js';
import { broadcast } from './events.js';

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_INPUT_CHARS = 20000;
const MAX_KEYS = 10;
// Trust boundary: only these tmux key names may reach send-keys.
const KEY_RE = /^(?:[1-9]|Escape|Enter|Up|Down|Left|Right)$/;

export interface SessionHistoryRouterDeps {
  scanner: SessionHistoryScanner;
  sessions: SessionRepository;
  tracks: TrackRepository;
  terminal: TerminalManager;
}

interface PrefixMatch {
  prefix: string;
  trackId: TrackId;
}

/** Builds a longest-prefix-first lookup of filesystem paths -> track, from both
 *  known session cwds (incl. soft-deleted) and track repo paths. */
function buildPrefixIndex(deps: SessionHistoryRouterDeps): PrefixMatch[] {
  const matches: PrefixMatch[] = [];
  for (const session of [...deps.sessions.findAll(), ...deps.sessions.findAllDeleted()]) {
    if (session.worktreeRoot) matches.push({ prefix: session.worktreeRoot, trackId: session.trackId });
    if (session.workingDirectory) matches.push({ prefix: session.workingDirectory, trackId: session.trackId });
  }
  for (const track of deps.tracks.findAll()) {
    for (const repo of deps.tracks.findReposByTrack(track.id)) {
      matches.push({ prefix: repo.path, trackId: track.id });
    }
  }
  return matches.sort((a, b) => b.prefix.length - a.prefix.length);
}

function matchTrack(cwd: string, index: PrefixMatch[]): TrackId | null {
  for (const { prefix, trackId } of index) {
    if (cwd === prefix || cwd.startsWith(`${prefix}/`)) return trackId;
  }
  return null;
}

type EnrichedEntry = Omit<SessionHistoryEntry, 'filePath'> & {
  cwdExists: boolean;
  trackId: TrackId | null;
  trackName: string | null;
};

export function createSessionHistoryRouter(deps: SessionHistoryRouterDeps): Router {
  const router = Router();

  router.get('/session-history', async (_req, res) => {
    try {
      const entries = await deps.scanner.list();
      const prefixIndex = buildPrefixIndex(deps);
      const trackNameById = new Map(deps.tracks.findAll().map((t) => [t.id, t.name]));

      const enriched: EnrichedEntry[] = entries.map((entry) => {
        const { filePath: _filePath, ...rest } = entry;
        const trackId = entry.cwd ? matchTrack(entry.cwd, prefixIndex) : null;
        return {
          ...rest,
          cwdExists: entry.cwd ? existsSync(entry.cwd) : false,
          trackId,
          trackName: trackId ? trackNameById.get(trackId) ?? null : null,
        };
      });
      res.json(enriched);
    } catch (err) {
      console.error('Failed to list session history:', err);
      res.status(500).json({ error: 'Failed to list session history' });
    }
  });

  router.get('/session-history/:sessionId/transcript', async (req, res) => {
    if (!SESSION_ID_RE.test(req.params.sessionId)) {
      res.status(400).json({ error: 'Invalid session ID' });
      return;
    }
    try {
      const limit = Number(req.query.limit);
      const stat = await deps.scanner.stat(req.params.sessionId);
      if (!stat) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      const etag = `"${stat.mtimeMs}-${stat.size}-${Number.isInteger(limit) ? limit : 0}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'no-cache');
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
      const messages = await deps.scanner.readTranscript(req.params.sessionId);
      if (!messages) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      // Optional tail so a phone polling a long session only pulls the recent end.
      res.json({ messages: Number.isInteger(limit) && limit > 0 ? messages.slice(-limit) : messages });
    } catch (err) {
      console.error('Failed to read session transcript:', err);
      res.status(500).json({ error: 'Failed to read session transcript' });
    }
  });

  // Codex/Gemini sessions, keyed by Workshop session id (Claude's go through /session-history above).
  router.get('/sessions/:id/transcript', (req, res) => {
    const session = deps.sessions.findById(req.params.id as SessionId);
    const found = session?.workingDirectory
      ? readAgentTranscript(session.provider, session.workingDirectory, Date.parse(session.createdAt))
      : null;
    if (!found) {
      res.status(404).json({ error: 'No transcript yet' });
      return;
    }
    try {
      const limit = Number(req.query.limit);
      const st = statSync(found.file);
      const etag = `"${st.mtimeMs}-${st.size}-${Number.isInteger(limit) ? limit : 0}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'no-cache');
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
      const messages = found.read();
      res.json({ messages: Number.isInteger(limit) && limit > 0 ? messages.slice(-limit) : messages });
    } catch (err) {
      console.error('Failed to read agent transcript:', err);
      res.status(500).json({ error: 'Failed to read transcript' });
    }
  });

  router.post('/sessions/:id/input', async (req, res) => {
    const { text, keys } = req.body ?? {};
    if (keys !== undefined) {
      if (!Array.isArray(keys) || keys.length < 1 || keys.length > MAX_KEYS || !keys.every((k) => typeof k === 'string' && KEY_RE.test(k))) {
        res.status(400).json({ error: `keys must be 1-${MAX_KEYS} of: 1-9, Escape, Enter, Up, Down, Left, Right` });
        return;
      }
    } else if (typeof text !== 'string' || text.trim().length === 0 || text.length > MAX_INPUT_CHARS) {
      res.status(400).json({ error: `text must be a non-empty string up to ${MAX_INPUT_CHARS} chars` });
      return;
    }
    const sessionId = req.params.id as SessionId;
    if (!deps.sessions.findById(sessionId)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    try {
      const ok = keys ? await deps.terminal.sendKeys(sessionId, keys) : await deps.terminal.sendInput(sessionId, text);
      if (!ok) {
        res.status(409).json({ error: 'Session is not running' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      console.error('Failed to send session input:', err);
      res.status(500).json({ error: 'Failed to send input' });
    }
  });

  router.get('/sessions/:id/prompt', (req, res) => {
    const sessionId = req.params.id as SessionId;
    if (!deps.sessions.findById(sessionId)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const prompt = deps.terminal.capturePrompt(sessionId);
    if (prompt === undefined) {
      res.status(409).json({ error: 'Session is not running' });
      return;
    }
    res.json({ prompt });
  });

  router.post('/session-history/:sessionId/resume', async (req, res) => {
    const sessionId = req.params.sessionId;
    if (!SESSION_ID_RE.test(sessionId)) {
      res.status(400).json({ error: 'Invalid session ID' });
      return;
    }
    const trackId = req.body?.trackId;
    if (!trackId || typeof trackId !== 'string') {
      res.status(400).json({ error: 'trackId is required' });
      return;
    }
    const track = deps.tracks.findById(trackId as TrackId);
    if (!track) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }

    try {
      const entries = await deps.scanner.list();
      const entry = entries.find((e) => e.sessionId === sessionId);
      if (!entry) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      if (!entry.cwd || !existsSync(entry.cwd)) {
        res.status(400).json({ error: `Original directory no longer exists: ${entry.cwd ?? ''}` });
        return;
      }

      // No worktree mode — claude --resume must run in the original cwd.
      const session = await deps.terminal.createSession(track.id, {
        provider: 'claude',
        claudeResumeId: sessionId,
        workingDirectory: entry.cwd,
        name: entry.title ?? entry.preview?.slice(0, 60) ?? 'Resumed session',
        onReady: (s) => broadcast('session:ready', track.id, { sessionId: s.id }),
      });

      broadcast('session:created', track.id, { sessionId: session.id });
      res.status(201).json(session);
    } catch (err) {
      console.error('Failed to resume session:', err);
      res.status(500).json({ error: 'Failed to resume session' });
    }
  });

  return router;
}
