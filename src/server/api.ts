import { Router } from 'express';
import type { TrackId, SessionId, RepoId, AutomationRuleId, TemplateId, TerminalLayout } from '@foundation/types';
import { createTrackRepository } from '@infrastructure/persistence/track-repository.js';
import { createSessionRepository } from '@infrastructure/persistence/session-repository.js';
import { createSummaryRepository } from '@infrastructure/persistence/summary-repository.js';
import { createTicketRepository } from '@infrastructure/persistence/ticket-repository.js';
import { createAutomationRuleRepository } from '@infrastructure/persistence/automation-repository.js';
import { createPromptTemplateRepository } from '@infrastructure/persistence/prompt-template-repository.js';
import { createTodoRepository } from '@infrastructure/persistence/todo-repository.js';
import { createPermissionRequestRepository } from '@infrastructure/persistence/permission-repository.js';
import { createAgentRepository } from '@infrastructure/persistence/agent-repository.js';
import { createTerminalManager } from '@infrastructure/terminal/manager.js';
import { createGitAdapter } from '@infrastructure/git/git-adapter.js';
import { createFilesystemAgentScanner } from '@infrastructure/agents/filesystem-scanner.js';
import { createSummaryGenerationService } from '@application/summary-generation/service.js';
import { interpolateTemplate } from '@application/track-management/prompt-interpolation.js';
import type { AutomationEngine } from '@application/automation-engine/engine.js';
import { createTodoRouter } from './todo-routes.js';
import { createPermissionRouter } from './permission-routes.js';
import { createAgentRouter } from './agent-routes.js';
import { broadcast } from './events.js';

export interface ApiRouterDeps {
  automationEngine?: AutomationEngine;
}

export function createApiRouter(deps: ApiRouterDeps = {}): Router {
  const router = Router();
  const tracks = createTrackRepository();
  const sessions = createSessionRepository();
  const summaries = createSummaryRepository();
  const tickets = createTicketRepository();
  const automationRules = createAutomationRuleRepository();
  const promptTemplates = createPromptTemplateRepository();
  const todos = createTodoRepository();
  const permissions = createPermissionRequestRepository();
  const agents = createAgentRepository();
  const filesystemScanner = createFilesystemAgentScanner();
  const projectRoot = process.cwd();
  const terminal = createTerminalManager(sessions);
  terminal.syncSessionStates();
  const gitAdapter = createGitAdapter();
  const summaryGeneration = createSummaryGenerationService({
    trackRepo: tracks,
    ticketRepo: tickets,
    summaryRepo: summaries,
    gitAdapter,
  });

  // Mount todo sub-router
  const todoRouter = createTodoRouter({
    todos,
    tracks,
    sessions,
    summaries,
    tickets,
    promptTemplates,
    agents,
    filesystemScanner,
    projectRoot,
    terminal,
  });
  router.use(todoRouter);

  // Mount permission sub-router
  const permissionRouter = createPermissionRouter({ permissions });
  router.use(permissionRouter);

  // Mount agent sub-router
  const agentRouter = createAgentRouter({ agents, filesystemScanner, projectRoot });
  router.use(agentRouter);

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
    broadcast('track:created', track.id);
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
    const { name, description, context, status } = req.body;
    const track = tracks.update(req.params.id as TrackId, { name, description, context, status });
    if (!track) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }
    broadcast('track:updated', track.id);
    res.json(track);
  });

  router.delete('/tracks/:id', (req, res) => {
    const trackId = req.params.id as TrackId;
    const deleted = tracks.delete(trackId);
    if (!deleted) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }
    broadcast('track:deleted', trackId);
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

  // --- Terminal Layout ---

  router.get('/tracks/:id/layout', (req, res) => {
    const trackId = req.params.id as TrackId;
    const layout = tracks.getTerminalLayout(trackId);
    res.json(layout || { root: null });
  });

  router.put('/tracks/:id/layout', (req, res) => {
    const trackId = req.params.id as TrackId;
    const track = tracks.findById(trackId);
    if (!track) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }
    const layout = req.body as TerminalLayout;
    const updated = tracks.setTerminalLayout(trackId, layout);
    if (!updated) {
      res.status(500).json({ error: 'Failed to update layout' });
      return;
    }
    res.json(layout);
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

      // Auto-compose system prompt from track context + summary + template
      let systemPrompt = req.body?.systemPrompt;
      if (!systemPrompt) {
        const parts: string[] = [];

        // 1. Track context (freeform user-provided context)
        if (track.context) {
          parts.push(track.context);
        }

        // 2. Latest summary
        const summary = summaries.findLatest(trackId);
        if (summary) {
          parts.push(`## Current Status\n\n${summary.content}`);
        }

        // 3. Interpolated prompt template
        if (track.defaultPromptTemplateId) {
          const template = promptTemplates.findById(track.defaultPromptTemplateId);
          if (template) {
            track.tickets = tickets.findByTrack(trackId);
            const interpolated = interpolateTemplate(template.content, { track });
            parts.push(interpolated);
          }
        }

        if (parts.length > 0) {
          systemPrompt = parts.join('\n\n---\n\n');
        }
      }

      const session = await terminal.createSession(trackId, {
        systemPrompt,
        workingDirectory: track.repos?.[0]?.path,
      });
      broadcast('session:created', trackId);
      res.status(201).json(session);
    } catch (err) {
      console.error('Failed to create session:', err);
      res.status(500).json({ error: 'Failed to create session' });
    }
  });

  router.patch('/tracks/:trackId/sessions/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId as SessionId;
    const { name } = req.body;
    if (typeof name !== 'string') {
      res.status(400).json({ error: 'name must be a string' });
      return;
    }
    const session = sessions.updateName(sessionId, name);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    broadcast('session:updated', req.params.trackId as TrackId);
    res.json(session);
  });

  router.delete('/tracks/:trackId/sessions/:sessionId', async (req, res) => {
    try {
      await terminal.destroySession(req.params.sessionId as SessionId);
      broadcast('session:deleted', req.params.trackId as TrackId);
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
      broadcast('summary:updated', trackId);
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

  // --- Automations ---

  router.get('/tracks/:id/automations', (req, res) => {
    const rules = automationRules.findByTrack(req.params.id as TrackId);
    res.json(rules);
  });

  router.post('/tracks/:id/automations', (req, res) => {
    const { name, triggerType, triggerConfig, actionType, actionConfig, enabled } = req.body;
    if (!name || !triggerType || !actionType) {
      res.status(400).json({ error: 'name, triggerType, and actionType are required' });
      return;
    }
    const rule = automationRules.create({
      trackId: req.params.id as TrackId,
      name,
      triggerType,
      triggerConfig,
      actionType,
      actionConfig,
      enabled: enabled !== undefined ? enabled : true,
    });
    res.status(201).json(rule);
  });

  router.put('/tracks/:trackId/automations/:ruleId', (req, res) => {
    const { name, triggerType, triggerConfig, actionType, actionConfig, enabled } = req.body;
    const rule = automationRules.update(req.params.ruleId as AutomationRuleId, {
      name,
      triggerType,
      triggerConfig,
      actionType,
      actionConfig,
      enabled,
    });
    if (!rule) {
      res.status(404).json({ error: 'Automation rule not found' });
      return;
    }
    res.json(rule);
  });

  router.delete('/tracks/:trackId/automations/:ruleId', (req, res) => {
    const deleted = automationRules.delete(req.params.ruleId as AutomationRuleId);
    if (!deleted) {
      res.status(404).json({ error: 'Automation rule not found' });
      return;
    }
    res.status(204).send();
  });

  router.post('/tracks/:trackId/automations/:ruleId/trigger', async (req, res) => {
    const ruleId = req.params.ruleId as AutomationRuleId;
    const rule = automationRules.findById(ruleId);
    if (!rule) {
      res.status(404).json({ error: 'Automation rule not found' });
      return;
    }
    if (!deps.automationEngine) {
      res.status(503).json({ error: 'Automation engine not available' });
      return;
    }
    try {
      await deps.automationEngine.triggerRule(rule.id);
      res.json({ message: 'Rule triggered', ruleId: rule.id });
    } catch (err) {
      console.error('Failed to trigger automation rule:', err);
      res.status(500).json({ error: 'Failed to trigger automation rule' });
    }
  });

  // --- Prompt Templates ---

  router.get('/templates', (_req, res) => {
    res.json(promptTemplates.findAll());
  });

  router.post('/templates', (req, res) => {
    const { name, description, content } = req.body;
    if (!name || typeof name !== 'string' || !content || typeof content !== 'string') {
      res.status(400).json({ error: 'name and content are required' });
      return;
    }
    const template = promptTemplates.create({ name, description, content });
    res.status(201).json(template);
  });

  router.put('/templates/:id', (req, res) => {
    const { name, description, content } = req.body;
    const template = promptTemplates.update(req.params.id as TemplateId, { name, description, content });
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    res.json(template);
  });

  router.delete('/templates/:id', (req, res) => {
    const deleted = promptTemplates.delete(req.params.id as TemplateId);
    if (!deleted) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    res.status(204).send();
  });

  // --- Track Prompt ---

  router.get('/tracks/:id/prompt', (req, res) => {
    const track = tracks.findById(req.params.id as TrackId);
    if (!track) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }

    if (!track.defaultPromptTemplateId) {
      res.json({ templateId: null, raw: null, interpolated: null });
      return;
    }

    const template = promptTemplates.findById(track.defaultPromptTemplateId);
    if (!template) {
      res.json({ templateId: track.defaultPromptTemplateId, raw: null, interpolated: null });
      return;
    }

    // Populate tickets for interpolation
    track.tickets = tickets.findByTrack(track.id);
    const interpolated = interpolateTemplate(template.content, { track });
    res.json({ templateId: template.id, raw: template.content, interpolated });
  });

  router.put('/tracks/:id/prompt', (req, res) => {
    const { templateId } = req.body;
    const trackId = req.params.id as TrackId;
    const track = tracks.findById(trackId);
    if (!track) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }

    // Allow null to unset the template
    const newTemplateId = templateId ? (templateId as TemplateId) : null;

    // Verify the template exists if setting one
    if (newTemplateId) {
      const template = promptTemplates.findById(newTemplateId);
      if (!template) {
        res.status(404).json({ error: 'Template not found' });
        return;
      }
    }

    const updated = tracks.setDefaultPromptTemplate(trackId, newTemplateId);
    if (!updated) {
      res.status(500).json({ error: 'Failed to update track prompt' });
      return;
    }
    res.json({ templateId: newTemplateId });
  });

  return router;
}
