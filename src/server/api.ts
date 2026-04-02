import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import path from 'path';
import { Router } from 'express';
import type { TrackId, SessionId, SessionProvider, RepoId, PathId, AgentId, AutomationRuleId, TemplateId, TerminalLayout, WorkflowTicket } from '@foundation/types';
import { VAULT_ROOT } from '@foundation/config.js';
import { createTrackRepository } from '@infrastructure/persistence/track-repository.js';
import { createSessionRepository } from '@infrastructure/persistence/session-repository.js';
import { createSummaryRepository } from '@infrastructure/persistence/summary-repository.js';
import { createTicketRepository } from '@infrastructure/persistence/ticket-repository.js';
import { createAutomationRuleRepository } from '@infrastructure/persistence/automation-repository.js';
import { createPromptTemplateRepository } from '@infrastructure/persistence/prompt-template-repository.js';
import { createTodoRepository } from '@infrastructure/persistence/todo-repository.js';
import { createAgentRepository } from '@infrastructure/persistence/agent-repository.js';
import { createTerminalManager } from '@infrastructure/terminal/manager.js';
import { createGitAdapter } from '@infrastructure/git/git-adapter.js';
import { createFilesystemAgentScanner } from '@infrastructure/agents/filesystem-scanner.js';
import { createVaultReader } from '@infrastructure/vault/reader.js';
import { createVaultWriter } from '@infrastructure/vault/writer.js';
import { createVaultProvisioner } from '@infrastructure/vault/provisioner.js';
import { slugifyTrackName } from '@infrastructure/vault/utils.js';
import { createScheduledTaskRepository, createScheduledTaskRunRepository } from '@infrastructure/persistence/scheduled-task-repository.js';
import { createSummaryGenerationService } from '@application/summary-generation/service.js';
import { interpolateTemplate } from '@application/track-management/prompt-interpolation.js';
import { composeVaultContext } from '@application/vault/compose-vault-context.js';
import type { AutomationEngine } from '@application/automation-engine/engine.js';
import { createTaskScheduler } from '@application/scheduler/task-scheduler.js';
import { createTodoRouter } from './todo-routes.js';
import { createAgentRouter } from './agent-routes.js';
import { createVaultRouter } from './vault-routes.js';
import { createScheduledTaskRouter } from './scheduled-task-routes.js';
import { createWorkflowRouter } from './workflow-routes.js';
import { createPlaybookRouter } from './workflow-playbook-routes.js';
import { createWorkflowProposalRouter } from './workflow-proposal-routes.js';
import { createWorkflowTicketRepository, createWorkflowTransitionRepository } from '@infrastructure/persistence/workflow-repository.js';
import { createTicketDependencyRepository } from '@infrastructure/persistence/workflow-dependency-repository.js';
import { createWorkflowEngine } from '@application/workflow/engine.js';
import { createExecutionDispatcher } from '@application/workflow/execution-dispatcher.js';
import { createAgentDispatcher } from '@application/workflow/agent-dispatcher.js';
import { createDispatchCoordinator } from '@application/workflow/dispatch-coordinator.js';
import { createTopologyLoader } from '@application/workflow/topology-loader.js';
import { createPlaybookRepository } from '@infrastructure/persistence/workflow-playbook-repository.js';
import { createAgentRoleRepository } from '@infrastructure/persistence/workflow-agent-role-repository.js';
import { createExecutionHookRouter } from './execution-hook-routes.js';
import { recoverStuckTickets } from '@application/workflow/startup-recovery.js';
import { broadcast } from './events.js';
import { createDiscussionTeamRepository } from '@infrastructure/persistence/discussion-team-repository.js';
import { createDiscussionRepository } from '@infrastructure/persistence/discussion-repository.js';
import { createDiscussionMessageRepository } from '@infrastructure/persistence/discussion-message-repository.js';
import { createDiscussionVoteRepository } from '@infrastructure/persistence/discussion-vote-repository.js';
import { createDiscussionSessionRepository } from '@infrastructure/persistence/discussion-session-repository.js';
import { createDiscussionService } from '@application/discussion/discussion-service.js';
import { createDiscussionPoller } from '@application/discussion/discussion-poller.js';
import { createMatrixRouter } from '@application/matrix-router/router.js';
import { createDiscussionRouter } from './discussion-routes.js';
import { createMcpServerConfigRepository } from '@infrastructure/persistence/mcp-config-repository.js';
import { createMcpConfigRouter } from './mcp-config-routes.js';
import { createGlobalRepoRepository, createSettingsRepository } from '@infrastructure/persistence/repo-repository.js';
import { createRepoRouter } from './repo-routes.js';
import { createClaudeAdapter } from '@infrastructure/mcp-tools/claude-adapter.js';
import { createCodexAdapter } from '@infrastructure/mcp-tools/codex-adapter.js';
import { createGeminiAdapter } from '@infrastructure/mcp-tools/gemini-adapter.js';
import { createSoulLoader } from '@infrastructure/soul/soul-loader.js';

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
  const agents = createAgentRepository();
  const filesystemScanner = createFilesystemAgentScanner();
  const projectRoot = process.cwd();
  const soulLoader = createSoulLoader(projectRoot);
  const terminal = createTerminalManager(sessions, soulLoader, todos);

  // Sync session states on startup and periodically (every 30s).
  // Dead tmux sessions are removed from the DB (or suspended if resumable).
  // When the sync produces new suspensions, immediately attempt to resume them —
  // this handles the post-restart case where sessions transition dying→suspended
  // after the 30s grace period, which would otherwise outlive the startup resume call.
  async function runSessionSync() {
    const result = terminal.syncSessionStates();
    for (const { trackId } of result.cleaned) {
      broadcast('session:deleted', trackId);
    }
    for (const { trackId } of result.suspended) {
      broadcast('session:updated', trackId);
    }
    for (const { trackId } of result.dying) {
      broadcast('session:updated', trackId);
    }
    for (const trackId of result.activityChanged) {
      broadcast('session:updated', trackId);
    }
    if (result.suspended.length > 0) {
      try {
        const resumed = await terminal.resumeSuspendedSessions();
        for (const session of resumed) {
          broadcast('session:created', session.trackId);
        }
        if (resumed.length > 0) {
          console.log(`[session-resume] Resumed ${resumed.length} session(s)`);
        }
      } catch (err) {
        console.error('[session-resume] Failed to resume suspended sessions:', err);
      }
    }
  }
  runSessionSync();

  // Resume any sessions that were suspended or orphaned before this startup.
  // Delayed slightly so the server is ready for hook callbacks.
  setTimeout(async () => {
    try {
      // Fast-path: suspend any 'active' sessions whose tmux is gone so
      // resumeSuspendedSessions picks them up immediately — bypassing the
      // normal 30s dying grace period that would otherwise delay recovery.
      const allSessions = sessions.findAll();
      for (const session of allSessions) {
        if (session.state === 'active' && session.claudeResumeId && !terminal.isSessionAlive(session)) {
          sessions.updateState(session.id, 'suspended');
          console.log(`[session-resume] Fast-suspended orphaned session ${session.id} (${session.tmuxSession})`);
        }
      }

      const resumed = await terminal.resumeSuspendedSessions();
      for (const session of resumed) {
        broadcast('session:created', session.trackId);
      }
      if (resumed.length > 0) {
        console.log(`[session-resume] Resumed ${resumed.length} session(s) after restart`);
      }
    } catch (err) {
      console.error('[session-resume] Failed to resume suspended sessions:', err);
    }
  }, 3_000);

  const syncInterval = setInterval(runSessionSync, 30_000);
  // Clean up interval when the router's parent process exits
  process.on('SIGINT', () => clearInterval(syncInterval));
  process.on('SIGTERM', () => clearInterval(syncInterval));

  const gitAdapter = createGitAdapter();
  const vaultReader = createVaultReader(VAULT_ROOT);
  const vaultWriter = createVaultWriter(VAULT_ROOT);
  const vaultProvisioner = createVaultProvisioner(VAULT_ROOT);
  vaultProvisioner.seedPlaybookPatterns();
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
    vaultReader,
  });
  router.use(todoRouter);

  // Mount agent sub-router
  const agentRouter = createAgentRouter({ agents, filesystemScanner, projectRoot });
  router.use(agentRouter);

  // Mount vault sub-router
  const vaultRouter = createVaultRouter({ vaultReader, vaultWriter, vaultProvisioner });
  router.use(vaultRouter);

  // Mount scheduled task sub-router
  const scheduledTasks = createScheduledTaskRepository();
  const scheduledTaskRuns = createScheduledTaskRunRepository();
  const taskScheduler = createTaskScheduler({
    tasks: scheduledTasks,
    runs: scheduledTaskRuns,
    tracks,
    sessions,
    summaries,
    tickets,
    promptTemplates,
    agents,
    filesystemScanner,
    projectRoot,
    terminal,
    broadcast: broadcast as (type: string, id: string) => void,
  });
  taskScheduler.start();

  const scheduledTaskRouter = createScheduledTaskRouter({
    tasks: scheduledTasks,
    runs: scheduledTaskRuns,
    scheduler: taskScheduler,
  });
  router.use(scheduledTaskRouter);

  // Mount workflow sub-router
  const workflowTickets = createWorkflowTicketRepository();
  const workflowTransitions = createWorkflowTransitionRepository();
  const ticketDependencies = createTicketDependencyRepository();
  const workflowPlaybooks = createPlaybookRepository();
  const workflowAgentRoles = createAgentRoleRepository();
  const topologyLoader = createTopologyLoader({ playbooks: workflowPlaybooks });

  // Create a mutable callback holder for epic advanced events (circular dependency resolution)
  let epicAdvancedCallback: ((ticket: WorkflowTicket) => Promise<void>) | undefined;
  let taskUnblockedCallback: ((ticket: WorkflowTicket) => Promise<void>) | undefined;

  const workflowEngine = createWorkflowEngine({
    tickets: workflowTickets,
    transitions: workflowTransitions,
    dependencies: ticketDependencies,
    topologyLoader,
    playbooks: workflowPlaybooks,
    onEpicAdvanced: async (ticket) => {
      if (epicAdvancedCallback) await epicAdvancedCallback(ticket);
    },
    onTaskUnblocked: async (ticket) => {
      if (taskUnblockedCallback) await taskUnblockedCallback(ticket);
    },
    onTerminalState: async (ticket) => {
      console.log(
        `[workflow] Ticket ${ticket.id} reached terminal state "${ticket.state}"` +
        (ticket.playbookRowId ? ` (playbook: ${ticket.playbookRowId})` : ''),
      );
      broadcast('workflow:terminal', ticket.trackId ?? ticket.id);
    },
  });

  // Execution dispatcher — handles plan-review → executing dispatch
  const executionDispatcher = createExecutionDispatcher({
    engine: workflowEngine,
    tickets: workflowTickets,
    tracks,
    summaries,
    terminal,
    topologyLoader,
  });

  // Agent dispatcher — handles all other agent-actionable states
  const agentDispatcher = createAgentDispatcher({
    tickets: workflowTickets,
    tracks,
    summaries,
    terminal,
    topologyLoader,
    agentRoles: workflowAgentRoles,
  });

  // Unified coordinator — routes transitions through the right dispatcher
  const dispatchCoordinator = createDispatchCoordinator({
    engine: workflowEngine,
    tickets: workflowTickets,
    executionDispatcher,
    agentDispatcher,
    topologyLoader,
  });

  // Wire the callback after coordinator exists (B4 fix: parent epic dispatch)
  epicAdvancedCallback = async (epic) => {
    await dispatchCoordinator.dispatchForCurrentState(epic.id);
  };
  taskUnblockedCallback = async (task) => {
    console.log(`Task unblocked: ${task.id} -> ${task.state}, dispatching agent`);
    await dispatchCoordinator.dispatchForCurrentState(task.id);
  };

  const workflowRouter = createWorkflowRouter({
    engine: workflowEngine,
    tickets: workflowTickets,
    transitions: workflowTransitions,
    dependencies: ticketDependencies,
    dispatcher: dispatchCoordinator,
    topologyLoader,
  });
  router.use(workflowRouter);

  // Workflow playbook routes (playbook registry, agent roles, validation)
  const playbookRouter = createPlaybookRouter({
    playbooks: workflowPlaybooks,
    agentRoles: workflowAgentRoles,
  });
  router.use(playbookRouter);

  // Workflow proposal routes (propose and approve workflow assignments)
  const workflowProposalRouter = createWorkflowProposalRouter({
    engine: workflowEngine,
    tickets: workflowTickets,
    playbooks: workflowPlaybooks,
    agentRoles: workflowAgentRoles,
    topologyLoader,
    dispatcher: dispatchCoordinator,
  });
  router.use(workflowProposalRouter);

  // Execution hook routes (SubagentStop + SessionEnd + SessionStart callbacks)
  const executionHookRouter = createExecutionHookRouter({
    engine: workflowEngine,
    tickets: workflowTickets,
    terminal,
    sessions,
  });
  router.use(executionHookRouter);

  // Recover stuck workflow tickets on startup (delay to let session sync finish first)
  setTimeout(async () => {
    try {
      const result = await recoverStuckTickets({
        tickets: workflowTickets,
        sessions,
        dispatcher: dispatchCoordinator,
        topologyLoader,
      });
      if (result.redispatched.length > 0) {
        console.log(
          `[workflow-recovery] Startup recovery complete: ${result.redispatched.length} ticket(s) re-dispatched`,
        );
        for (const id of result.redispatched) {
          broadcast('workflow:dispatched', id);
        }
      }
      if (result.errors.length > 0) {
        console.warn(
          `[workflow-recovery] ${result.errors.length} ticket(s) failed to re-dispatch`,
        );
      }
    } catch (err) {
      console.error('[workflow-recovery] Startup recovery failed:', err);
    }
  }, 5_000);

  // Periodic workflow recovery — check every 2 minutes for agent-actionable
  // tickets whose sessions have died mid-operation
  const recoveryDeps = { tickets: workflowTickets, sessions, dispatcher: dispatchCoordinator, topologyLoader };
  const recoveryInterval = setInterval(async () => {
    try {
      const result = await recoverStuckTickets(recoveryDeps);
      if (result.redispatched.length > 0) {
        console.log(
          `[workflow-recovery] Periodic recovery: ${result.redispatched.length} ticket(s) re-dispatched`,
        );
        for (const id of result.redispatched) {
          broadcast('workflow:dispatched', id);
        }
      }
    } catch (err) {
      console.error('[workflow-recovery] Periodic recovery failed:', err);
    }
  }, 120_000);
  process.on('SIGINT', () => clearInterval(recoveryInterval));
  process.on('SIGTERM', () => clearInterval(recoveryInterval));

  // Mount discussion sub-router
  const discussionTeams = createDiscussionTeamRepository();
  const discussionsList = createDiscussionRepository();
  const discussionMessages = createDiscussionMessageRepository();
  const discussionVotes = createDiscussionVoteRepository();
  const discussionSessionsRepo = createDiscussionSessionRepository();
  const discussionService = createDiscussionService({
    teams: discussionTeams,
    discussions: discussionsList,
    messages: discussionMessages,
    votes: discussionVotes,
    discussionSessions: discussionSessionsRepo,
    agents,
    filesystemScanner,
    sessions,
    tracks,
    summaries,
    terminal,
    projectRoot,
    broadcast: broadcast as (type: string, id: string) => void,
  });

  const discussionRouter = createDiscussionRouter({
    discussionService,
    teams: discussionTeams,
    discussions: discussionsList,
    discussionSessions: discussionSessionsRepo,
  });
  router.use(discussionRouter);

  // Mount repo + settings sub-router
  const globalRepos = createGlobalRepoRepository();
  const settingsRepo = createSettingsRepository();
  const repoRouter = createRepoRouter({ repos: globalRepos, settings: settingsRepo });
  router.use(repoRouter);

  // Mount MCP config sub-router
  const mcpConfigs = createMcpServerConfigRepository();
  const mcpConfigRouter = createMcpConfigRouter({
    mcpConfigs,
    adapters: {
      claude: createClaudeAdapter(),
      codex: createCodexAdapter(),
      gemini: createGeminiAdapter(),
    },
  });
  router.use(mcpConfigRouter);

  // Discussion poller — nudges agents about new messages and detects stale discussions
  const discussionPoller = createDiscussionPoller({
    discussionSessions: discussionSessionsRepo,
    discussions: discussionsList,
    messages: discussionMessages,
    sessions,
    discussionService,
    broadcast: broadcast as (type: string, id: string) => void,
  });
  discussionPoller.start(60_000);

  // Stop scheduler on shutdown
  process.on('SIGINT', () => taskScheduler.stop());
  process.on('SIGTERM', () => taskScheduler.stop());

  // Stop discussion poller on shutdown
  process.on('SIGINT', () => discussionPoller.stop());
  process.on('SIGTERM', () => discussionPoller.stop());

  // Matrix router — ensures dedicated sessions for room-bound tracks
  const matrixRouter = createMatrixRouter({
    tracks,
    sessions,
    summaries,
    tickets,
    promptTemplates,
    terminal,
    vaultReader,
    broadcast: broadcast as (type: string, id: string) => void,
  });
  matrixRouter.start();

  process.on('SIGINT', () => matrixRouter.stop());
  process.on('SIGTERM', () => matrixRouter.stop());

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

    // Auto-provision vault folder for the new track
    try {
      const trackSlug = slugifyTrackName(track.name);
      vaultProvisioner.provisionTrack(trackSlug, track.name);
    } catch (err) {
      console.error('Failed to auto-provision vault folder:', err);
      // Non-fatal — track creation still succeeds
    }

    broadcast('track:created', track.id);
    res.status(201).json(track);
  });

  // Lookup track by Matrix room ID (must be before /:id to avoid matching "by-room" as an id)
  router.get('/tracks/by-room/:roomId', (req, res) => {
    const track = tracks.findByMatrixRoomId(req.params.roomId);
    if (!track) {
      res.status(404).json({ error: 'No track bound to this room' });
      return;
    }
    track.tickets = tickets.findByTrack(track.id);
    res.json(track);
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
    const { name, description, context, label, matrixRoomId, status, worktreeMode, defaultAgentId } = req.body;
    const track = tracks.update(req.params.id as TrackId, { name, description, context, label, matrixRoomId, status, worktreeMode, defaultAgentId });
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
    // Link to global repo if one exists for this path
    const globalRepo = globalRepos.findByPath(repoPath);
    const repo = tracks.addRepo(req.params.id as TrackId, repoPath, remoteUrl, globalRepo?.id);
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

  router.delete('/tracks/:trackId/paths/:pathId', (req, res) => {
    const deleted = tracks.removePath(req.params.pathId as PathId);
    if (!deleted) {
      res.status(404).json({ error: 'Path not found' });
      return;
    }
    res.status(204).send();
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

  router.get('/sessions', (_req, res) => {
    const allSessions = sessions.findAll();
    const enriched = allSessions.map(s => ({
      ...s,
      lastActivityAt: terminal.getLastActivityAt(s.id),
      dying: terminal.isDying(s.id),
      activityStatus: terminal.getActivityStatus(s.id),
    }));
    res.json(enriched);
  });

  router.get('/tracks/:id/sessions', (req, res) => {
    const trackSessions = sessions.findByTrack(req.params.id as TrackId);
    const enriched = trackSessions.map(s => ({
      ...s,
      lastActivityAt: terminal.getLastActivityAt(s.id),
      dying: terminal.isDying(s.id),
      activityStatus: terminal.getActivityStatus(s.id),
    }));
    res.json(enriched);
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

        // 2. Vault memory (persistent Obsidian notes)
        const trackSlug = slugifyTrackName(track.name);
        const vaultContext = composeVaultContext(vaultReader, trackSlug);
        if (vaultContext) {
          parts.push(vaultContext);
        }

        // 3. Latest summary
        const summary = summaries.findLatest(trackId);
        if (summary) {
          parts.push(`## Current Status\n\n${summary.content}`);
        }

        // 4. Interpolated prompt template
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

      // Validate provider if provided
      const provider: SessionProvider = req.body?.provider === 'codex' ? 'codex' : 'claude';

      // worktreeMode: explicit request body takes precedence, then track-level default
      const requestWorktreeMode = req.body?.worktreeMode;
      const worktreeMode = typeof requestWorktreeMode === 'boolean'
        ? requestWorktreeMode
        : (track.worktreeMode ?? false);

      const repos = tracks.findReposByTrack(trackId);

      const session = await terminal.createSession(trackId, {
        systemPrompt,
        provider,
        workingDirectory: repos[0]?.path,
        worktreeMode: worktreeMode && repos.length > 0,
        repos: worktreeMode ? repos : undefined,
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

  // --- Open in editor ---

  router.post('/shell/open-in-editor', (req, res) => {
    const { path: targetPath, app } = req.body;
    if (!targetPath || typeof targetPath !== 'string') {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    // Reject traversal attempts
    if (targetPath.includes('..')) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
    if (!existsSync(targetPath)) {
      res.status(404).json({ error: 'Path does not exist' });
      return;
    }
    try {
      if (app === 'terminal') {
        execSync(`open -a iTerm ${JSON.stringify(targetPath)}`, { stdio: 'pipe' });
      } else {
        // Default: Cursor. Try CLI first, fall back to open -a.
        try {
          execSync(`cursor ${JSON.stringify(targetPath)}`, { stdio: 'pipe' });
        } catch {
          execSync(`open -a Cursor ${JSON.stringify(targetPath)}`, { stdio: 'pipe' });
        }
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('Failed to open in editor:', err);
      res.status(500).json({ error: 'Failed to open in editor' });
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

  router.put('/tracks/:id/agent', (req, res) => {
    const { agentId } = req.body;
    const trackId = req.params.id as TrackId;
    const track = tracks.findById(trackId);
    if (!track) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }

    // Allow null to unset the default agent
    const newAgentId = agentId ? (agentId as AgentId) : null;

    // Verify the agent exists if setting one
    if (newAgentId) {
      const agent = agents.findById(newAgentId) ?? filesystemScanner.findById(newAgentId, projectRoot);
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
    }

    const updated = tracks.setDefaultAgent(trackId, newAgentId);
    if (!updated) {
      res.status(500).json({ error: 'Failed to update track agent' });
      return;
    }
    broadcast('track:updated', trackId);
    res.json({ agentId: newAgentId });
  });

  // --- Soul ---

  router.get('/soul', (_req, res) => {
    const info = soulLoader.getInfo();
    res.json(info);
  });

  router.put('/soul', (req, res) => {
    const { content } = req.body;
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content must be a string' });
      return;
    }
    soulLoader.save(content);
    const info = soulLoader.getInfo();
    res.json(info);
  });

  router.delete('/soul', (_req, res) => {
    soulLoader.reset();
    const info = soulLoader.getInfo();
    res.json(info);
  });

  // --- Sprites ---

  const spritesDir = path.join(homedir(), '.workshop', 'sprites');
  router.get('/sprites/:filename', (req, res) => {
    const { filename } = req.params;
    // Reject directory traversal attempts
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }
    const filePath = path.join(spritesDir, filename);
    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'Sprite not found' });
      return;
    }
    res.sendFile(filePath);
  });

  return router;
}
