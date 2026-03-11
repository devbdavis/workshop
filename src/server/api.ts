import { Router } from 'express';
import type { TrackId, SessionId, RepoId } from '@foundation/types';
import { createTrackRepository } from '@infrastructure/persistence/track-repository.js';
import { createSessionRepository } from '@infrastructure/persistence/session-repository.js';
import { createSummaryRepository } from '@infrastructure/persistence/summary-repository.js';
import { createTicketRepository } from '@infrastructure/persistence/ticket-repository.js';
import { createTerminalManager } from '@infrastructure/terminal/manager.js';
import { createGitAdapter } from '@infrastructure/git/git-adapter.js';
import { createSummaryGenerationService } from '@application/summary-generation/service.js';

export function createApiRouter(): Router {
  const router = Router();
  const tracks = createTrackRepository();
  const sessions = createSessionRepository();
  const summaries = createSummaryRepository();
  const tickets = createTicketRepository();
  const terminal = createTerminalManager(sessions);
  const gitAdapter = createGitAdapter();
  const summaryGeneration = createSummaryGenerationService({
    trackRepo: tracks,
    ticketRepo: tickets,
    summaryRepo: summaries,
    gitAdapter,
  });

  // --- Tracks ---

  router.get('/tracks', (_req, res) => {
    res.json(tracks.findAll());
  });

  router.post('/tracks', (req, res) => {
    const { name, description } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const track = tracks.create({ name, description, status: 'active' });
    res.status(201).json(track);
  });

  router.get('/tracks/:id', (req, res) => {
    const track = tracks.findById(req.params.id as TrackId);
    if (!track) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }
    // Attach tickets
    track.tickets = tickets.findByTrack(track.id);
    res.json(track);
  });

  router.put('/tracks/:id', (req, res) => {
    const { name, description, status } = req.body;
    const track = tracks.update(req.params.id as TrackId, { name, description, status });
    if (!track) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }
    res.json(track);
  });

  router.delete('/tracks/:id', (req, res) => {
    const deleted = tracks.delete(req.params.id as TrackId);
    if (!deleted) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }
    res.status(204).send();
  });

  // --- Track Repos ---

  router.post('/tracks/:id/repos', (req, res) => {
    const { path: repoPath, remoteUrl } = req.body;
    if (!repoPath || typeof repoPath !== 'string') {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    const repo = tracks.addRepo(req.params.id as TrackId, repoPath, remoteUrl);
    res.status(201).json(repo);
  });

  router.delete('/tracks/:trackId/repos/:repoId', (req, res) => {
    const deleted = tracks.removeRepo(req.params.repoId as any);
    if (!deleted) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    res.status(204).send();
  });

  // --- Git Status ---

  router.get('/tracks/:id/repos/:repoId/git-status', async (req, res) => {
    try {
      const trackId = req.params.id as TrackId;
      const repoId = req.params.repoId as RepoId;

      const repos = tracks.findReposByTrack(trackId);
      const repo = repos.find((r) => r.id === repoId);
      if (!repo) {
        res.status(404).json({ error: 'Repo not found' });
        return;
      }

      const isRepo = await gitAdapter.isGitRepo(repo.path);
      if (!isRepo) {
        res.status(400).json({ error: 'Path is not a git repository' });
        return;
      }

      const status = await gitAdapter.getStatus(repo.path);
      res.json(status);
    } catch (err) {
      console.error('Failed to get git status:', err);
      res.status(500).json({ error: 'Failed to get git status' });
    }
  });

  // --- Track Paths ---

  router.post('/tracks/:id/paths', (req, res) => {
    const { path: fsPath, label } = req.body;
    if (!fsPath || typeof fsPath !== 'string') {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    const p = tracks.addPath(req.params.id as TrackId, fsPath, label);
    res.status(201).json(p);
  });

  // --- Sessions ---

  router.get('/tracks/:id/sessions', (req, res) => {
    const trackSessions = sessions.findByTrack(req.params.id as TrackId);
    res.json(trackSessions);
  });

  router.post('/tracks/:id/sessions', async (req, res) => {
    try {
      const trackId = req.params.id as TrackId;
      const track = tracks.findById(trackId);
      if (!track) {
        res.status(404).json({ error: 'Track not found' });
        return;
      }
      const session = await terminal.createSession(trackId, {
        systemPrompt: req.body?.systemPrompt,
        workingDirectory: track.repos?.[0]?.path,
      });
      res.status(201).json(session);
    } catch (err) {
      console.error('Failed to create session:', err);
      res.status(500).json({ error: 'Failed to create session' });
    }
  });

  router.delete('/tracks/:trackId/sessions/:sessionId', async (req, res) => {
    try {
      await terminal.destroySession(req.params.sessionId as SessionId);
      res.status(204).send();
    } catch (err) {
      console.error('Failed to destroy session:', err);
      res.status(500).json({ error: 'Failed to destroy session' });
    }
  });

  // --- Summary ---

  router.get('/tracks/:id/summary', (req, res) => {
    const summary = summaries.findLatest(req.params.id as TrackId);
    if (!summary) {
      res.status(404).json({ error: 'No summary yet' });
      return;
    }
    res.json(summary);
  });

  router.post('/tracks/:id/summary/refresh', async (req, res) => {
    try {
      const trackId = req.params.id as TrackId;
      const track = tracks.findById(trackId);
      if (!track) {
        res.status(404).json({ error: 'Track not found' });
        return;
      }
      const summary = await summaryGeneration.generateSummary(trackId);
      res.json(summary);
    } catch (err) {
      console.error('Failed to generate summary:', err);
      const message = err instanceof Error ? err.message : 'Failed to generate summary';
      res.status(500).json({ error: message });
    }
  });

  // --- Tickets ---

  router.get('/tracks/:id/tickets', (req, res) => {
    const trackTickets = tickets.findByTrack(req.params.id as TrackId);
    res.json(trackTickets);
  });

  router.post('/tracks/:id/tickets', (req, res) => {
    const { source, externalId, relationship, cachedTitle, cachedStatus } = req.body;
    if (!source || !externalId) {
      res.status(400).json({ error: 'source and externalId are required' });
      return;
    }
    const ticket = tickets.create({
      trackId: req.params.id as TrackId,
      source,
      externalId,
      relationship: relationship || 'related',
      cachedTitle,
      cachedStatus,
    });
    res.status(201).json(ticket);
  });

  router.delete('/tracks/:trackId/tickets/:ticketId', (req, res) => {
    const deleted = tickets.delete(req.params.ticketId as any);
    if (!deleted) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    res.status(204).send();
  });

  return router;
}
