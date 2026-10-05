import { existsSync } from 'fs';
import { Router } from 'express';
import type { TrackId } from '@foundation/types';
import type { SessionRepository } from '@domain/session/repository';
import type { TrackRepository } from '@domain/track/repository';
import type { TerminalManager } from '@infrastructure/terminal/manager.js';
import type { SessionHistoryEntry, SessionHistoryScanner } from '@infrastructure/usage/session-history.js';
import { broadcast } from './events.js';

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      const messages = await deps.scanner.readTranscript(req.params.sessionId);
      if (!messages) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      // Optional tail so a phone polling a long session only pulls the recent end.
      const limit = Number(req.query.limit);
      res.json({ messages: Number.isInteger(limit) && limit > 0 ? messages.slice(-limit) : messages });
    } catch (err) {
      console.error('Failed to read session transcript:', err);
      res.status(500).json({ error: 'Failed to read session transcript' });
    }
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
