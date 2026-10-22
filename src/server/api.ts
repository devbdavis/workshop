import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { Router } from 'express';
import type { TrackId, SessionId, SessionProvider, RepoId, PathId, AgentId, AutomationRuleId, TemplateId, TerminalLayout, TodoId, WorkflowIssue } from '@foundation/types';
import { resolveSessionProvider } from '@foundation/types.js';
import { VAULT_ROOT } from '@foundation/config.js';
import { createTrackRepository } from '@infrastructure/persistence/track-repository.js';
import { createSessionRepository } from '@infrastructure/persistence/session-repository.js';
import { createIssueRepository } from '@infrastructure/persistence/issue-repository.js';
import { createAutomationRuleRepository } from '@infrastructure/persistence/automation-repository.js';
import { createPromptTemplateRepository } from '@infrastructure/persistence/prompt-template-repository.js';
import { createTodoRepository } from '@infrastructure/persistence/todo-repository.js';
import { createAgentRepository } from '@infrastructure/persistence/agent-repository.js';
import { createTerminalManager } from '@infrastructure/terminal/manager.js';
import type { TerminalManager } from '@infrastructure/terminal/manager.js';
import { createGitAdapter } from '@infrastructure/git/git-adapter.js';
import { createFilesystemAgentScanner } from '@infrastructure/agents/filesystem-scanner.js';
import { ensureAutoInstallAgents } from '@infrastructure/agents/template-installer.js';
import { createFilesystemSkillScanner } from '@infrastructure/skills/filesystem-scanner.js';
import { createVaultReader } from '@infrastructure/vault/reader.js';
import { createVaultWriter } from '@infrastructure/vault/writer.js';
import { createVaultProvisioner } from '@infrastructure/vault/provisioner.js';
import { slugifyTrackName } from '@infrastructure/vault/utils.js';
import { createScheduledTaskRepository, createScheduledTaskRunRepository } from '@infrastructure/persistence/scheduled-task-repository.js';
import { interpolateTemplate } from '@application/track-management/prompt-interpolation.js';
import { composeVaultContext } from '@application/vault/compose-vault-context.js';
import type { AutomationEngine } from '@application/automation-engine/engine.js';
import { createTaskScheduler } from '@application/scheduler/task-scheduler.js';
import { importBundledSchedules } from '@application/scheduler/schedule-importer.js';
import { createTodoRouter } from './todo-routes.js';
import { createAgentRouter } from './agent-routes.js';
import { createSkillRouter } from './skill-routes.js';
import { createVaultRouter } from './vault-routes.js';
import { createScheduledTaskRouter } from './scheduled-task-routes.js';
import { createWorkflowRouter } from './workflow-routes.js';
import { createPlaybookRouter } from './workflow-playbook-routes.js';
import { createWorkflowProposalRouter } from './workflow-proposal-routes.js';
import { createWorkflowIssueRepository, createWorkflowTransitionRepository } from '@infrastructure/persistence/workflow-repository.js';
import { createIssueDependencyRepository } from '@infrastructure/persistence/workflow-dependency-repository.js';
import { createWorkflowEngine } from '@application/workflow/engine.js';
import { createExecutionDispatcher } from '@application/workflow/execution-dispatcher.js';
import { createAgentDispatcher } from '@application/workflow/agent-dispatcher.js';
import { createDispatchCoordinator } from '@application/workflow/dispatch-coordinator.js';
import { generateShiftReport } from '@application/workflow/shift-report.js';
import { createUsageTracker } from '@infrastructure/usage/usage-tracker.js';
import { createUsagePacingPoller } from '@application/usage/usage-pacing-poller.js';
import { createTopologyLoader } from '@application/workflow/topology-loader.js';
import { createPlaybookRepository } from '@infrastructure/persistence/workflow-playbook-repository.js';
import { createAgentRoleRepository } from '@infrastructure/persistence/workflow-agent-role-repository.js';
import { createExecutionHookRouter } from './execution-hook-routes.js';
import { createActivityHookRouter } from './activity-hook-routes.js';
import { createPermissionRouter } from './permission-routes.js';
import { createPermissionRepository } from '@infrastructure/persistence/permission-repository.js';
import { createPermissionService } from '@application/permissions/permission-service.js';
import { recoverStuckIssues } from '@application/workflow/startup-recovery.js';
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
import { createPluginRouter } from './plugin-routes.js';
import { createPluginRepository } from '@infrastructure/persistence/plugin-repository.js';
import { ensureRegisteredPluginsInstalled } from '@infrastructure/plugins/ensure-installed.js';
import { createGlobalRepoRepository, createSettingsRepository } from '@infrastructure/persistence/repo-repository.js';
import { createRepoRouter, parsePrMonitorIgnoredAuthors } from './repo-routes.js';
import { createWorkspaceRouter } from './workspace-routes.js';
import { createPreviewRouter } from './preview-routes.js';
import { createSessionHistoryRouter } from './session-history-routes.js';
import { createSessionHistoryScanner } from '@infrastructure/usage/session-history.js';
import { createDiffCommentRouter } from './diff-comment-routes.js';
import { createDiffCommentRepository } from '@infrastructure/persistence/diff-comment-repository.js';
import { createUserRepository } from '@infrastructure/persistence/user-repository.js';
import { createUserRouter } from './user-routes.js';
import { getProfileId } from './profile.js';
import { createBackupRouter } from './backup-routes.js';
import { createBackupScheduler } from '@application/backup/backup-scheduler.js';
import { createIssueImportIgnoreRepository } from '@infrastructure/persistence/issue-import-ignore-repository.js';
import { createIssueImportRouter } from './issue-import-routes.js';
import { createClaudeAdapter } from '@infrastructure/mcp-tools/claude-adapter.js';
import { createCodexAdapter } from '@infrastructure/mcp-tools/codex-adapter.js';
import { createGeminiAdapter } from '@infrastructure/mcp-tools/gemini-adapter.js';
import { createSoulLoader } from '@infrastructure/soul/soul-loader.js';
import { ensureDefaultTodoTemplate, ensureSystemPromptTemplates } from '@infrastructure/persistence/database.js';
import { createPrMonitorRepository } from '@infrastructure/persistence/pr-monitor-repository.js';
import { createForgeAdapter } from '@infrastructure/forge/forge-adapter.js';
import { createPrMonitorPoller } from '@application/pr-monitor/poller.js';
import { createPrMonitorRegistrar } from '@application/pr-monitor/registrar.js';
import { createPrMonitorRouter } from './pr-monitor-routes.js';
import { createPrCheckLogRouter } from './pr-check-log-routes.js';
import { createPrReviewRepository } from '@infrastructure/persistence/pr-review-repository.js';
import { createPrReviewDiscoveryPoller } from '@application/pr-review/discovery-poller.js';
import { createStaleAgentReaper } from '@application/session-cleanup/stale-agent-reaper.js';
import { createPrReviewRouter } from './pr-review-routes.js';
import {
  detectAvailability,
  parseEditorChoice,
  parseTerminalChoice,
  resolveEditor,
  resolveEditorTarget,
  resolveTerminal,
  launchEditor,
  launchTerminal,
} from '@infrastructure/launch/launch-apps.js';
import { isCodeServerAvailable, isRunningInContainer } from '@infrastructure/code-server/code-server.js';

export interface ApiRouterDeps {
  automationEngine?: AutomationEngine;
  /** Shared terminal manager instance — pass the same one used by setupWebSocket
   *  so in-memory session state (activity status, attention) stays consistent. */
  terminal?: TerminalManager;
}

export function createApiRouter(deps: ApiRouterDeps = {}): Router {
  const router = Router();
  const tracks = createTrackRepository();
  const sessions = createSessionRepository();
  const issues = createIssueRepository();
  const automationRules = createAutomationRuleRepository();
  const promptTemplates = createPromptTemplateRepository();
  const todos = createTodoRepository();
  const agents = createAgentRepository();
  const filesystemScanner = createFilesystemAgentScanner();
  const projectRoot = process.cwd();
  const soulLoader = createSoulLoader(projectRoot);
  const plugins = createPluginRepository();
  const terminal = deps.terminal ?? createTerminalManager(sessions, soulLoader, todos, plugins);

  // Ensure registered marketplace plugins are installed across AI CLIs.
  // Fire-and-forget — network/git work must never block server boot.
  ensureRegisteredPluginsInstalled(plugins)
    .then((results) => {
      const failures = results.filter((r) => !r.success);
      if (failures.length > 0) {
        console.warn('[plugins] Startup sync completed with failures:', failures.map((f) => `${f.provider}:${f.pluginName} — ${f.message}`).join('; '));
      } else {
        console.log(`[plugins] Startup sync complete (${results.length} step(s))`);
      }
    })
    .catch((err) => console.error('[plugins] Startup sync failed:', err));

  // Ensure the default todo template exists and is assigned to all tracks
  ensureDefaultTodoTemplate();
  // Ensure system templates for PR build-fix + comment-response exist (idempotent).
  ensureSystemPromptTemplates();

  // Install repo-committed agent templates flagged autoInstall into ~/.claude/agents
  try {
    ensureAutoInstallAgents(projectRoot);
  } catch (err) {
    console.warn('[agents] Auto-install of template agents failed:', err);
  }

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
    for (const alert of result.idleAlerts) {
      broadcast('session:idle-alert', alert.trackId, {
        sessionId: alert.sessionId,
        sessionName: alert.sessionName,
      });
    }
    for (const alert of result.needsInputAlerts) {
      broadcast('session:needs-input', alert.trackId, {
        sessionId: alert.sessionId,
        sessionName: alert.sessionName,
      });
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
      // Fast-path: suspend any live-state sessions whose tmux is gone so
      // resumeSuspendedSessions picks them up immediately — bypassing the
      // normal 30s dying grace period that would otherwise delay recovery.
      // Covers 'active' and 'detached' (background agents, detached sessions).
      const allSessions = sessions.findAll();
      for (const session of allSessions) {
        if (
          ['active', 'detached'].includes(session.state) &&
          session.claudeResumeId &&
          !terminal.isSessionAlive(session)
        ) {
          sessions.updateState(session.id, 'suspended');
          console.log(`[session-resume] Fast-suspended orphaned session ${session.id} (state=${session.state}, tmux=${session.tmuxSession})`);
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

  const syncInterval = setInterval(runSessionSync, 7_500);

  // Purge recycle-bin sessions older than 7 days, on startup and every hour.
  terminal.purgeExpiredSessions();
  const purgeInterval = setInterval(() => terminal.purgeExpiredSessions(), 60 * 60 * 1_000);

  // Clean up intervals when the router's parent process exits
  process.on('SIGINT', () => { clearInterval(syncInterval); clearInterval(purgeInterval); });
  process.on('SIGTERM', () => { clearInterval(syncInterval); clearInterval(purgeInterval); });

  const gitAdapter = createGitAdapter();
  const vaultReader = createVaultReader(VAULT_ROOT);
  const vaultWriter = createVaultWriter(VAULT_ROOT);
  const vaultProvisioner = createVaultProvisioner(VAULT_ROOT);
  vaultProvisioner.seedPlaybookPatterns();
  const settingsRepo = createSettingsRepository();

  // PR monitor infrastructure — wired before the todo router so todo updates
  // can reconcile monitors as part of their normal flow.
  const prMonitors = createPrMonitorRepository();
  // One adapter fronting both GitHub (`gh`) and Gitea/Forgejo (`tea` logins).
  const forgeAdapter = createForgeAdapter({
    getIgnoredCommentAuthors: () => parsePrMonitorIgnoredAuthors(settingsRepo.get('pr_monitor_ignored_authors')),
  });
  const prRegistrar = createPrMonitorRegistrar(prMonitors);
  const prPoller = createPrMonitorPoller({
    monitors: prMonitors,
    gh: forgeAdapter,
    broadcast: (type, trackId, payload) => broadcast(type, trackId, payload),
  });
  prPoller.start();
  process.on('SIGINT', () => prPoller.stop());
  process.on('SIGTERM', () => prPoller.stop());

  // PR Review dashboard — incoming review requests + agent findings.
  const prReviews = createPrReviewRepository();
  const prReviewDiscovery = createPrReviewDiscoveryPoller({
    reviews: prReviews,
    forge: forgeAdapter,
    broadcast: (type, trackId, payload) => broadcast(type, trackId, payload),
  });
  prReviewDiscovery.start();
  process.on('SIGINT', () => prReviewDiscovery.stop());
  process.on('SIGTERM', () => prReviewDiscovery.stop());

  // Terminate PR-review / Linear-issue agent sessions older than 48h — those
  // system tracks otherwise accumulate parked one-shot agents forever.
  const staleAgentReaper = createStaleAgentReaper({
    sessions,
    settings: settingsRepo,
    terminal,
    broadcast,
  });
  staleAgentReaper.start();
  process.on('SIGINT', () => staleAgentReaper.stop());
  process.on('SIGTERM', () => staleAgentReaper.stop());

  // Mount todo sub-router
  const todoRouter = createTodoRouter({
    todos,
    tracks,
    sessions,
    issues,
    promptTemplates,
    agents,
    settings: settingsRepo,
    filesystemScanner,
    projectRoot,
    terminal,
    vaultReader,
    prMonitorRegistrar: prRegistrar,
  });
  router.use(todoRouter);

  // Mount PR-monitor sub-router (action dispatch + status queries)
  const prMonitorRouter = createPrMonitorRouter({
    monitors: prMonitors,
    registrar: prRegistrar,
    poller: prPoller,
    todos,
    tracks,
    promptTemplates,
    terminal,
  });
  router.use(prMonitorRouter);
  router.use(createPrCheckLogRouter({ monitors: prMonitors, forge: forgeAdapter }));

  // Mount PR-review dashboard sub-router
  const prReviewRouter = createPrReviewRouter({
    reviews: prReviews,
    discovery: prReviewDiscovery,
    gh: forgeAdapter,
    ghReview: forgeAdapter,
    sessions,
    tracks,
    agents,
    filesystemScanner,
    settings: settingsRepo,
    projectRoot,
    terminal,
  });
  router.use(prReviewRouter);

  // Mount agent sub-router
  const agentRouter = createAgentRouter({ agents, filesystemScanner, projectRoot });
  router.use(agentRouter);

  // Mount skill sub-router
  const skillFilesystemScanner = createFilesystemSkillScanner();
  const skillRouter = createSkillRouter({ filesystemScanner: skillFilesystemScanner, projectRoot });
  router.use(skillRouter);

  // Mount vault sub-router
  const vaultRouter = createVaultRouter({ vaultReader, vaultWriter, vaultProvisioner });
  router.use(vaultRouter);

  // Mount scheduled task sub-router
  const scheduledTasks = createScheduledTaskRepository();
  const scheduledTaskRuns = createScheduledTaskRunRepository();
  // Seed any bundled schedule definitions from schedules/*.json that aren't yet in the DB
  importBundledSchedules(projectRoot, scheduledTasks);
  const taskScheduler = createTaskScheduler({
    tasks: scheduledTasks,
    runs: scheduledTaskRuns,
    tracks,
    sessions,
    issues,
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
    sessions,
    scheduler: taskScheduler,
    projectRoot,
  });
  router.use(scheduledTaskRouter);

  // Mount workflow sub-router
  const workflowIssues = createWorkflowIssueRepository();
  const workflowTransitions = createWorkflowTransitionRepository();
  const issueDependencies = createIssueDependencyRepository();
  const workflowPlaybooks = createPlaybookRepository();
  const workflowAgentRoles = createAgentRoleRepository();
  const topologyLoader = createTopologyLoader({ playbooks: workflowPlaybooks });

  // Create a mutable callback holder for epic advanced events (circular dependency resolution)
  let epicAdvancedCallback: ((issue: WorkflowIssue) => Promise<void>) | undefined;
  let taskUnblockedCallback: ((issue: WorkflowIssue) => Promise<void>) | undefined;

  const workflowEngine = createWorkflowEngine({
    issues: workflowIssues,
    transitions: workflowTransitions,
    dependencies: issueDependencies,
    topologyLoader,
    playbooks: workflowPlaybooks,
    onEpicAdvanced: async (issue) => {
      if (epicAdvancedCallback) await epicAdvancedCallback(issue);
    },
    onTaskUnblocked: async (issue) => {
      if (taskUnblockedCallback) await taskUnblockedCallback(issue);
    },
    onTerminalState: async (issue) => {
      console.log(
        `[workflow] Issue ${issue.id} reached terminal state "${issue.state}"` +
        (issue.playbookRowId ? ` (playbook: ${issue.playbookRowId})` : ''),
      );
      broadcast('workflow:terminal', issue.trackId ?? issue.id);
    },
  });

  // Execution dispatcher — handles plan-review → executing dispatch
  const executionDispatcher = createExecutionDispatcher({
    engine: workflowEngine,
    issues: workflowIssues,
    tracks,
    terminal,
    topologyLoader,
  });

  // Agent dispatcher — handles all other agent-actionable states
  const agentDispatcher = createAgentDispatcher({
    issues: workflowIssues,
    tracks,
    terminal,
    topologyLoader,
    agentRoles: workflowAgentRoles,
  });

  // Unified coordinator — routes transitions through the right dispatcher
  // Dark Factory usage pacing — reads local token logs (free) to estimate 5h-window usage.
  const usageTracker = createUsageTracker({ settings: settingsRepo });
  const USAGE_THRESHOLD = 0.75;

  const dispatchCoordinator = createDispatchCoordinator({
    engine: workflowEngine,
    issues: workflowIssues,
    executionDispatcher,
    agentDispatcher,
    topologyLoader,
    // Dark Factory usage pacing: pause new autonomous work at 75% of the learned
    // usage ceiling, leaving headroom for interactive sessions (window is account-wide).
    usageGate: () => ({
      over: usageTracker.isOverThreshold(USAGE_THRESHOLD),
      resumeAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    onPaused: async (issueId) => { broadcast('workflow:updated', issueId); },
    // Dark Factory: when an autonomous issue comes to rest (awaiting merge,
    // escalated, or done), generate a shift report and surface it to the UI.
    onAutonomousRest: async (issueId) => {
      const t = workflowIssues.findById(issueId);
      if (!t) return;
      const report = generateShiftReport(t, {
        transitions: workflowTransitions,
        topologyLoader,
      });
      workflowIssues.update(issueId, {
        stateData: { ...(t.stateData || {}), shiftReport: report },
      });
      broadcast('workflow:updated', issueId);
    },
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
    issues: workflowIssues,
    transitions: workflowTransitions,
    dependencies: issueDependencies,
    dispatcher: dispatchCoordinator,
    topologyLoader,
    playbooks: workflowPlaybooks,
    projectRoot,
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
    issues: workflowIssues,
    playbooks: workflowPlaybooks,
    agentRoles: workflowAgentRoles,
    topologyLoader,
    dispatcher: dispatchCoordinator,
  });
  router.use(workflowProposalRouter);

  // Execution hook routes (SubagentStop + SessionEnd + SessionStart callbacks)
  const executionHookRouter = createExecutionHookRouter({
    engine: workflowEngine,
    issues: workflowIssues,
    terminal,
    sessions,
    taskRuns: scheduledTaskRuns,
    usageTracker,
  });
  router.use(executionHookRouter);
  router.use(createActivityHookRouter({ terminal }));

  const permissionRepo = createPermissionRepository();
  router.use(
    createPermissionRouter({
      repo: permissionRepo,
      service: createPermissionService({
        repo: permissionRepo,
        broadcast,
        resolveTask: (sessionId) => {
          const session = sessions.findById(sessionId);
          const track = session ? tracks.findById(session.trackId) : null;
          const todo = todos.findBySession(sessionId);
          return {
            trackId: session?.trackId ?? null,
            taskName: todo?.title ?? session?.name ?? track?.name ?? sessionId,
          };
        },
      }),
    }),
  );

  // Dark Factory usage-pacing poller — resumes paused autonomous epics once the
  // usage window drains back under threshold. (Proactive pause happens at dispatch.)
  const usagePacingPoller = createUsagePacingPoller({
    issues: workflowIssues,
    usageTracker,
    dispatcher: dispatchCoordinator,
    onResumed: (id) => broadcast('workflow:updated', id),
    threshold: USAGE_THRESHOLD,
  });
  usagePacingPoller.start();
  process.on('SIGINT', () => usagePacingPoller.stop());
  process.on('SIGTERM', () => usagePacingPoller.stop());

  // Recover stuck workflow issues on startup (delay to let session sync finish first)
  setTimeout(async () => {
    try {
      const result = await recoverStuckIssues({
        issues: workflowIssues,
        sessions,
        dispatcher: dispatchCoordinator,
        topologyLoader,
      });
      if (result.redispatched.length > 0) {
        console.log(
          `[workflow-recovery] Startup recovery complete: ${result.redispatched.length} issue(s) re-dispatched`,
        );
        for (const id of result.redispatched) {
          broadcast('workflow:dispatched', id);
        }
      }
      if (result.errors.length > 0) {
        console.warn(
          `[workflow-recovery] ${result.errors.length} issue(s) failed to re-dispatch`,
        );
      }
    } catch (err) {
      console.error('[workflow-recovery] Startup recovery failed:', err);
    }
  }, 5_000);

  // Periodic workflow recovery — check every 2 minutes for agent-actionable
  // issues whose sessions have died mid-operation
  const recoveryDeps = { issues: workflowIssues, sessions, dispatcher: dispatchCoordinator, topologyLoader };
  const recoveryInterval = setInterval(async () => {
    try {
      const result = await recoverStuckIssues(recoveryDeps);
      if (result.redispatched.length > 0) {
        console.log(
          `[workflow-recovery] Periodic recovery: ${result.redispatched.length} issue(s) re-dispatched`,
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
  const repoRouter = createRepoRouter({ repos: globalRepos, settings: settingsRepo });
  router.use(repoRouter);

  // Mount workspace sub-router (file browser, edits, git changes/diff for a session)
  const workspaceRouter = createWorkspaceRouter({ sessions, tracks });
  router.use(workspaceRouter);

  // Mount Design Mode preview sub-router (screenshot + send picks into a session)
  const previewRouter = createPreviewRouter({ sessions, terminal });
  router.use(previewRouter);

  // Mount session-history sub-router (browse + resume any past Claude Code session on the box)
  const sessionHistoryScanner = createSessionHistoryScanner();
  const sessionHistoryRouter = createSessionHistoryRouter({ scanner: sessionHistoryScanner, sessions, tracks, terminal });
  router.use(sessionHistoryRouter);

  // Mount diff-comment sub-router (inline notes on a session's working-tree diff)
  const diffComments = createDiffCommentRepository();
  const diffCommentRouter = createDiffCommentRouter({ sessions, tracks, comments: diffComments, terminal });
  router.use(diffCommentRouter);

  // Mount profiles + per-user settings sub-router (lightweight multi-user layer)
  const users = createUserRepository();
  router.use(createUserRouter({ users, tracks }));

  // Encrypted backups — daily to a cloud-synced directory, scrypt-derived AES-256-GCM.
  const backupScheduler = createBackupScheduler({ settings: settingsRepo });
  backupScheduler.start();
  const backupRouter = createBackupRouter({ settings: settingsRepo, scheduler: backupScheduler });
  router.use(backupRouter);
  process.on('SIGINT', () => backupScheduler.stop());
  process.on('SIGTERM', () => backupScheduler.stop());

  // Mount issue-import sub-router (Linear import modal)
  const issueImportIgnores = createIssueImportIgnoreRepository();
  const issueImportRouter = createIssueImportRouter({
    settings: settingsRepo,
    tracks,
    todos,
    ignores: issueImportIgnores,
  });
  router.use(issueImportRouter);

  // Mount marketplace plugin sub-router
  const pluginRouter = createPluginRouter({ plugins });
  router.use(pluginRouter);

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
    issues,
    promptTemplates,
    terminal,
    vaultReader,
    broadcast: broadcast as (type: string, id: string) => void,
  });
  matrixRouter.start();

  process.on('SIGINT', () => matrixRouter.stop());
  process.on('SIGTERM', () => matrixRouter.stop());

  // --- Tracks ---

  router.get('/tracks', (req, res) => {
    const all = tracks.findAll();
    // Enrich with the active profile's favorite/hidden prefs (if a profile is selected).
    const profileId = getProfileId(req);
    if (!profileId) {
      res.json(all);
      return;
    }
    const prefs = new Map(users.getTrackPrefs(profileId).map((p) => [p.trackId, p]));
    res.json(
      all.map((t) => {
        const p = prefs.get(t.id);
        return { ...t, favorite: p?.isFavorite ?? false, hidden: p?.isHidden ?? false };
      }),
    );
  });

  /**
   * Returns per-track session activity counts derived from in-memory pane state.
   * Shape: Record<trackId, { working, idle, needsInput, total }>
   */
  router.get('/tracks/activity', (_req, res) => {
    const allSessions = sessions.findAll();
    const result: Record<string, { working: number; idle: number; needsInput: number; total: number }> = {};
    for (const session of allSessions) {
      const status = terminal.getActivityStatus(session.id);
      if (!result[session.trackId]) {
        result[session.trackId] = { working: 0, idle: 0, needsInput: 0, total: 0 };
      }
      const counts = result[session.trackId];
      counts.total += 1;
      if (status === 'working') counts.working += 1;
      else if (status === 'idle') counts.idle += 1;
      else if (status === 'needs-input') counts.needsInput += 1;
    }
    res.json(result);
  });

  router.post('/tracks', (req, res) => {
    const { name, description } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    // New tracks default to the Orchestrator agent (auto-installed from
    // templates/agents/orchestrator.md) so dispatched todos follow the
    // standard plan → execute → self-review → PR flow out of the box.
    const orchestratorId = 'global:orchestrator' as AgentId;
    const defaultAgentId = filesystemScanner.findById(orchestratorId, projectRoot) ? orchestratorId : undefined;

    const track = tracks.create({ name, description, status: 'active', defaultAgentId });

    // Auto-assign the default todo template to newly created tracks
    const defaultTemplate = promptTemplates.findDefault();
    if (defaultTemplate) {
      tracks.setDefaultPromptTemplate(track.id, defaultTemplate.id);
    }

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
    track.issues = issues.findByTrack(track.id);
    res.json(track);
  });

  router.get('/tracks/:id', (req, res) => {
    const track = tracks.findById(req.params.id as TrackId);
    if (!track) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }
    // Attach issues
    track.issues = issues.findByTrack(track.id);
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
      attentionSince: terminal.getAttentionSince(s.id),
    }));
    res.json(enriched);
  });

  // Terminal output captured at session end (written to session dir, auto-purged after 7 days)
  router.get('/sessions/:sessionId/output', (req, res) => {
    const outputPath = path.join(
      homedir(), '.workshop', 'sessions', req.params.sessionId, 'output.txt',
    );
    if (!existsSync(outputPath)) {
      res.json({ output: null });
      return;
    }
    try {
      res.json({ output: readFileSync(outputPath, 'utf-8') });
    } catch {
      res.json({ output: null });
    }
  });

  router.get('/tracks/:id/sessions', (req, res) => {
    const trackSessions = sessions.findByTrack(req.params.id as TrackId);
    const enriched = trackSessions.map(s => ({
      ...s,
      lastActivityAt: terminal.getLastActivityAt(s.id),
      dying: terminal.isDying(s.id),
      activityStatus: terminal.getActivityStatus(s.id),
      attentionSince: terminal.getAttentionSince(s.id),
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

      // A shell session is a tmux pane at the workspace cwd with no AI CLI —
      // the way to get an interactive terminal inside the container (nix,
      // direnv, git) without sshd or `docker exec`. It carries no task, agent,
      // prompt, or model.
      const shell = req.body?.shell === true;

      // A shell session may pin its own cwd — "Open in Terminal" opens one at the
      // pane's working directory rather than the track's first repo.
      const rawCwd = shell && typeof req.body?.cwd === 'string' ? req.body.cwd : '';
      if (rawCwd && (!rawCwd.startsWith('/') || rawCwd.includes('..') || !existsSync(rawCwd))) {
        res.status(400).json({ error: 'cwd must be an absolute path that exists' });
        return;
      }
      const shellCwd = rawCwd || undefined;

      // Optional todo link — the session works on this task and the todo is
      // marked in-progress once the session exists.
      const todoId = shell ? undefined : (req.body?.todoId as TodoId | undefined);
      const todo = todoId ? todos.findById(todoId) : undefined;
      if (todoId && !todo) {
        res.status(404).json({ error: 'Todo not found' });
        return;
      }

      const agentId = shell ? undefined : ((req.body?.agentId as AgentId | undefined) ?? undefined);

      // Auto-compose system prompt from track context + template
      let systemPrompt = shell ? undefined : req.body?.systemPrompt;
      if (!shell && !systemPrompt) {
        const parts: string[] = [];

        // 0. Agent role prompt (workshop DB first, then filesystem agents)
        if (agentId) {
          const agent = agents.findById(agentId) ?? filesystemScanner.findById(agentId, projectRoot);
          if (agent) {
            parts.push(`## Agent: ${agent.name}\n\n${agent.systemPrompt}`);
          }
        }

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

        // 3. Interpolated prompt template
        let templateHasRepos = false;
        let templateHasTask = false;
        if (track.defaultPromptTemplateId) {
          const template = promptTemplates.findById(track.defaultPromptTemplateId);
          if (template) {
            templateHasRepos = template.content.includes('{{track.repos');
            templateHasTask = template.content.includes('{{todo.title}}');
            track.issues = issues.findByTrack(trackId);
            const interpolated = interpolateTemplate(template.content, {
              track,
              todo: todo ? { id: todo.id, title: todo.title, description: todo.description ?? '' } : undefined,
            });
            parts.push(interpolated);
          }
        }

        // 5. Repositories — unless the template already expanded {{track.repos}}
        const reposForPrompt = tracks.findReposByTrack(trackId);
        if (reposForPrompt.length > 0 && !templateHasRepos) {
          const repoLines = reposForPrompt
            .map((r) => `- ${r.path}${r.remoteUrl ? ` (${r.remoteUrl})` : ''}`)
            .join('\n');
          parts.push(`## Repositories\n\n${repoLines}`);
        }

        // 6. Track Paths
        const pathsForPrompt = tracks.findPathsByTrack(trackId);
        if (pathsForPrompt.length > 0) {
          const pathLines = pathsForPrompt
            .map((p) => `- ${p.path}${p.label ? ` (${p.label})` : ''}`)
            .join('\n');
          parts.push(`## Track Paths\n\n${pathLines}`);
        }

        // 7. The task, when the session is linked to a todo
        // (unless the template already rendered it via {{todo.title}})
        if (todo && !templateHasTask) {
          parts.push(`## Task\n\n**${todo.title}**\n\n${todo.description || ''}`);
        }

        if (parts.length > 0) {
          systemPrompt = parts.join('\n\n---\n\n');
        }
      }

      // Initial prompt: explicit body value wins; a linked todo supplies a
      // task prompt as fallback (cursor requires a non-empty prompt).
      const bodyPrompt = !shell && typeof req.body?.initialPrompt === 'string' ? req.body.initialPrompt.trim() : '';
      const initialPrompt = bodyPrompt
        || (todo ? `Complete the following task:\n\n**${todo.title}**\n\n${todo.description || 'No additional details provided.'}` : undefined);

      const provider: SessionProvider = resolveSessionProvider(
        req.body?.provider,
        settingsRepo.get('default_ai_cli'),
      );

      // Task-bearing sessions (linked todo or an initial prompt) are
      // orchestrators — run them on the configured dispatch model (default
      // opus). Plain interactive terminals keep the CLI's own default.
      const model: string | undefined = todo || initialPrompt
        ? (settingsRepo.get('dispatch_model') ?? 'opus').trim() || undefined
        : undefined;

      // worktreeMode: explicit request body takes precedence, then track-level default.
      // A shell never gets its own worktree — it opens where you asked it to.
      const requestWorktreeMode = req.body?.worktreeMode;
      const worktreeMode = shell
        ? false
        : typeof requestWorktreeMode === 'boolean'
          ? requestWorktreeMode
          : (track.worktreeMode ?? false);

      const repos = tracks.findReposByTrack(trackId);
      const trackPaths = tracks.findPathsByTrack(trackId);

      const session = await terminal.createSession(trackId, {
        systemPrompt,
        provider,
        model,
        initialPrompt,
        skipClaude: shell,
        todoId: todo?.id,
        name: typeof req.body?.name === 'string' && req.body.name.trim()
          ? req.body.name.trim()
          : (todo?.title ?? (shell ? 'Shell' : undefined)),
        issueKey: todo?.issueKey,
        workingDirectory: shellCwd ?? repos[0]?.path,
        worktreeMode: worktreeMode && repos.length > 0,
        repos: worktreeMode ? repos : undefined,
        additionalDirs: trackPaths.length > 0 ? trackPaths.map((p) => p.path) : undefined,
        onReady: (s) => broadcast('session:ready', trackId, { sessionId: s.id }),
      });

      if (todo) {
        todos.update(todo.id, {
          status: 'in-progress',
          sessionId: session.id as SessionId,
          agentId,
        });
        broadcast('todo:updated', trackId);
      }

      broadcast('session:created', trackId, { sessionId: session.id });
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
    // Keep the workspace file name in sync (covers both single-root and multi-root sessions).
    const workspaceFile = path.join(
      process.env.HOME || '/tmp', '.workshop', 'sessions', sessionId, 'workspace', 'workspace.code-workspace',
    );
    if (existsSync(workspaceFile)) {
      try {
        const ws = JSON.parse(readFileSync(workspaceFile, 'utf-8')) as Record<string, unknown>;
        ws.name = name;
        const settings = (ws.settings ?? {}) as Record<string, unknown>;
        settings['window.title'] = `\${activeEditorShort}\${separator}${name}\${dirty}`;
        ws.settings = settings;
        writeFileSync(workspaceFile, JSON.stringify(ws, null, 2) + '\n', 'utf-8');
      } catch {
        // Non-fatal — workspace file is cosmetic
      }
    }
    broadcast('session:updated', req.params.trackId as TrackId);
    res.json(session);
  });

  // Soft-delete: moves the session to the recycle bin (worktree preserved for 7 days).
  router.delete('/tracks/:trackId/sessions/:sessionId', async (req, res) => {
    try {
      await terminal.softDeleteSession(req.params.sessionId as SessionId);
      broadcast('session:deleted', req.params.trackId as TrackId);
      res.status(204).send();
    } catch (err) {
      console.error('Failed to soft-delete session:', err);
      res.status(500).json({ error: 'Failed to delete session' });
    }
  });

  // Permanently destroy a session from the recycle bin (worktree cleaned up).
  router.delete('/tracks/:trackId/sessions/:sessionId/purge', async (req, res) => {
    try {
      await terminal.destroySession(req.params.sessionId as SessionId);
      broadcast('session:deleted', req.params.trackId as TrackId);
      res.status(204).send();
    } catch (err) {
      console.error('Failed to purge session:', err);
      res.status(500).json({ error: 'Failed to purge session' });
    }
  });

  // List soft-deleted sessions for a track.
  router.get('/tracks/:trackId/sessions/deleted', (req, res) => {
    const deleted = sessions.findDeletedByTrack(req.params.trackId as TrackId);
    res.json(deleted);
  });

  // Restore a session from the recycle bin.
  router.post('/tracks/:trackId/sessions/:sessionId/restore', async (req, res) => {
    try {
      const session = await terminal.restoreSession(req.params.sessionId as SessionId);
      broadcast('session:created', req.params.trackId as TrackId);
      res.json(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Session not found')) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      console.error('Failed to restore session:', err);
      res.status(500).json({ error: 'Failed to restore session' });
    }
  });

  // --- Open in editor ---

  // Resolve the editor target path (prefers a .code-workspace file) WITHOUT launching.
  // Used by the client when a per-user editor URI prefix is configured: the browser
  // builds `<prefix><path>` itself and hands off to the local editor (Remote-SSH).
  router.get('/shell/resolve-editor-target', (req, res) => {
    const targetPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!targetPath || targetPath.includes('..')) {
      res.status(400).json({ error: 'valid path is required' });
      return;
    }
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
    res.json({ path: resolveEditorTarget(targetPath, sessionId, req.query.portable === '1') });
  });

  router.get('/code-server/status', (_req, res) => res.json({ available: isRunningInContainer() && isCodeServerAvailable() }));

  router.post('/shell/open-in-editor', (req, res) => {
    const { path: targetPath, app, sessionId } = req.body;
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
      // Resolve session name once — used by both terminal and editor paths.
      const sessionIdStr = typeof sessionId === 'string' ? sessionId : undefined;
      const sessionName = sessionIdStr
        ? (sessions.findById(sessionIdStr as SessionId)?.name ?? undefined)
        : undefined;

      const availability = detectAvailability();

      if (app === 'terminal') {
        const choice = parseTerminalChoice(settingsRepo.get('launch_terminal'));
        const resolved = resolveTerminal(choice, availability);
        if (!resolved) {
          res.status(400).json({
            error: 'No terminal application is available on this system. Configure one in Settings → General, or start a Shell session for a terminal inside the container.',
          });
          return;
        }
        launchTerminal(resolved, targetPath, { title: sessionName });
      } else {
        const choice = parseEditorChoice(settingsRepo.get('launch_editor'));
        const resolved = resolveEditor(choice, availability);
        if (!resolved) {
          res.status(400).json({
            error: 'No editor (Cursor or VSCode) is available on this system. Configure one in Settings → General.',
          });
          return;
        }
        const editorTarget = resolveEditorTarget(targetPath, sessionIdStr);
        launchEditor(resolved, editorTarget, availability.platform);
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('Failed to open in editor:', err);
      res.status(500).json({ error: 'Failed to open in editor' });
    }
  });

  // --- Issues ---

  router.get('/tracks/:id/issues', (req, res) => {
    const trackIssues = issues.findByTrack(req.params.id as TrackId);
    res.json(trackIssues);
  });

  router.post('/tracks/:id/issues', (req, res) => {
    const { source, externalId, relationship, cachedTitle, cachedStatus } = req.body;
    if (!source || !externalId) {
      res.status(400).json({ error: 'source and externalId are required' });
      return;
    }
    const issue = issues.create({
      trackId: req.params.id as TrackId,
      source,
      externalId,
      relationship: relationship || 'related',
      cachedTitle,
      cachedStatus,
    });
    res.status(201).json(issue);
  });

  router.delete('/tracks/:trackId/issues/:issueId', (req, res) => {
    const deleted = issues.delete(req.params.issueId as any);
    if (!deleted) {
      res.status(404).json({ error: 'Issue not found' });
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

    // Populate issues for interpolation
    track.issues = issues.findByTrack(track.id);
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
