import { Router } from 'express';
import type {
  PrMonitor,
  PrComment,
  SessionId,
  SessionProvider,
  TodoId,
  TrackId,
  TrackRepo,
  AgentId,
} from '@foundation/types';
import { resolveSessionProvider } from '@foundation/types.js';
import type { PrMonitorRepository } from '@domain/pr-monitor/repository';
import type { PrMonitorPoller } from '@application/pr-monitor/poller';
import type { PrMonitorRegistrar } from '@application/pr-monitor/registrar';
import type { TodoRepository } from '@domain/todo/repository';
import type { TrackRepository } from '@domain/track/repository';
import type { PromptTemplateRepository } from '@domain/prompt-template/repository';
import type { AgentRepository } from '@domain/agent/repository';
import type { SettingsRepository } from '@domain/repo/repository';
import type { FilesystemAgentScanner } from '@infrastructure/agents/filesystem-scanner.js';
import type { SummaryRepository } from '@domain/summary/repository';
import type { TicketRepository } from '@domain/ticket/repository';
import { interpolateTemplate } from '@application/track-management/prompt-interpolation.js';
import { interpolatePrTemplate, formatComments } from '@application/pr-monitor/prompt-interpolation.js';
import { broadcast } from './events.js';

export interface PrMonitorRouterDeps {
  monitors: PrMonitorRepository;
  registrar: PrMonitorRegistrar;
  poller: PrMonitorPoller;
  todos: TodoRepository;
  tracks: TrackRepository;
  summaries: SummaryRepository;
  tickets: TicketRepository;
  promptTemplates: PromptTemplateRepository;
  agents: AgentRepository;
  filesystemScanner: FilesystemAgentScanner;
  settings: SettingsRepository;
  projectRoot: string;
  terminal: {
    createSession: (
      trackId: TrackId,
      opts?: {
        systemPrompt?: string;
        workingDirectory?: string;
        background?: boolean;
        initialPrompt?: string;
        provider?: SessionProvider;
        name?: string;
        worktreeMode?: boolean;
        repos?: TrackRepo[];
        issueKey?: string;
        dangerouslySkipPermissions?: boolean;
        skipBackgroundInstructions?: boolean;
        onReady?: (session: { id: SessionId }) => void;
      },
    ) => Promise<{ id: SessionId; trackId: TrackId; tmuxSession: string; state: string }>;
    sendInput: (sessionId: SessionId, text: string) => Promise<boolean>;
  };
}

interface DispatchBody {
  agentId?: string;
  provider?: string;
  dangerouslySkipPermissions?: boolean;
  prUrl?: string;
  /** For comment dispatch: a subset of comment IDs to address (omit → all). */
  commentIds?: string[];
}

interface DismissCommentsBody {
  prUrl?: string;
  commentIds?: string[];
}

function pickMonitorForDispatch(monitors: PrMonitor[], requestedUrl?: string): PrMonitor | null {
  if (monitors.length === 0) return null;
  if (requestedUrl) {
    return monitors.find((m) => m.prUrl === requestedUrl) ?? null;
  }
  // Prefer a still-monitoring PR; fall back to the first row otherwise.
  return monitors.find((m) => m.monitoring) ?? monitors[0];
}

function selectComments(monitor: PrMonitor, commentIds?: string[]): PrComment[] {
  if (!commentIds || commentIds.length === 0) return monitor.unresolvedComments;
  const wanted = new Set(commentIds);
  return monitor.unresolvedComments.filter((c) => wanted.has(c.id));
}

export function createPrMonitorRouter(deps: PrMonitorRouterDeps): Router {
  const router = Router();
  const {
    monitors,
    registrar,
    poller,
    todos,
    tracks,
    summaries,
    tickets,
    promptTemplates,
    agents,
    filesystemScanner,
    settings,
    projectRoot,
    terminal,
  } = deps;

  router.get('/todos/:todoId/pr-monitors', (req, res) => {
    const todo = todos.findById(req.params.todoId as TodoId);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }
    res.json(monitors.findByTodo(todo.id));
  });

  router.get('/tracks/:trackId/pr-monitors', (req, res) => {
    res.json(monitors.findByTrack(req.params.trackId as TrackId));
  });

  router.post('/todos/:todoId/pr-monitors/reconcile', (req, res) => {
    const todo = todos.findById(req.params.todoId as TodoId);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }
    const result = registrar.reconcile(todo);
    res.json({ ...result, monitors: monitors.findByTodo(todo.id) });
  });

  router.post('/pr-monitors/poll-now', async (_req, res) => {
    try {
      const updated = await poller.pollNow();
      res.json({ updated });
    } catch (err) {
      console.error('Forced PR poll failed:', err);
      res.status(500).json({ error: 'Poll failed' });
    }
  });

  // Resume monitoring on a PR the poller previously paused (e.g. stale-cutoff).
  // Body accepts either { prUrl } or { todoId } — with todoId we resume every
  // paused monitor on that todo. Immediately refreshes each resumed PR via `gh`
  // so the caller gets fresh state back without waiting for the next tick.
  router.post('/pr-monitors/resume', async (req, res) => {
    try {
      const body = (req.body ?? {}) as { prUrl?: string; todoId?: string };
      const targets: string[] = [];

      if (typeof body.prUrl === 'string' && body.prUrl.trim().length > 0) {
        const existing = monitors.findByUrl(body.prUrl);
        if (!existing) {
          res.status(404).json({ error: 'No monitor registered for that PR URL' });
          return;
        }
        targets.push(body.prUrl);
      } else if (typeof body.todoId === 'string' && body.todoId.trim().length > 0) {
        const rows = monitors.findByTodo(body.todoId as TodoId);
        if (rows.length === 0) {
          res.status(404).json({ error: 'No PR monitors registered for that todo' });
          return;
        }
        for (const m of rows) targets.push(m.prUrl);
      } else {
        res.status(400).json({ error: 'Provide either prUrl or todoId' });
        return;
      }

      const resumed: import('@foundation/types').PrMonitor[] = [];
      const refreshed: import('@foundation/types').PrMonitor[] = [];
      for (const prUrl of targets) {
        const row = monitors.resumeMonitoring(prUrl);
        if (row) {
          resumed.push(row);
          const fresh = await poller.pollUrl(prUrl);
          if (fresh) refreshed.push(fresh);
        }
      }
      res.json({ resumed, refreshed });
    } catch (err) {
      console.error('PR monitor resume failed:', err);
      res.status(500).json({ error: 'Resume failed' });
    }
  });

  router.post('/todos/:todoId/pr-actions/dispatch-fix', async (req, res) => {
    try {
      const body = (req.body ?? {}) as DispatchBody;
      const todo = todos.findById(req.params.todoId as TodoId);
      if (!todo) {
        res.status(404).json({ error: 'Todo not found' });
        return;
      }
      const track = tracks.findById(todo.trackId);
      if (!track) {
        res.status(404).json({ error: 'Track not found' });
        return;
      }
      const todoMonitors = monitors.findByTodo(todo.id);
      const monitor = pickMonitorForDispatch(todoMonitors, body.prUrl);
      if (!monitor) {
        res.status(404).json({ error: 'No PR monitor available for this todo' });
        return;
      }
      const template = promptTemplates.findBySystemKind('pr-build-fix');
      if (!template) {
        res.status(500).json({ error: 'PR build-fix template missing — restart the server to reseed system templates' });
        return;
      }
      const session = await dispatchPrSession({
        body,
        todo,
        track,
        monitor,
        templateContent: template.content,
        commentsForTemplate: undefined,
        sessionLabel: `Fix PR #${monitor.prNumber}: ${monitor.prTitle ?? ''}`.trim(),
        deps: { tracks, summaries, tickets, agents, filesystemScanner, settings, projectRoot, terminal },
      });
      broadcast('session:created', track.id, { sessionId: session.id });
      res.status(201).json({ session, monitor });
    } catch (err) {
      console.error('Failed to dispatch PR fix:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to dispatch PR fix' });
    }
  });

  router.post('/todos/:todoId/pr-actions/send-comments', async (req, res) => {
    try {
      const body = (req.body ?? {}) as DispatchBody;
      const todo = todos.findById(req.params.todoId as TodoId);
      if (!todo) {
        res.status(404).json({ error: 'Todo not found' });
        return;
      }
      const monitor = pickMonitorForDispatch(monitors.findByTodo(todo.id), body.prUrl);
      if (!monitor) {
        res.status(404).json({ error: 'No PR monitor available for this todo' });
        return;
      }
      const comments = selectComments(monitor, body.commentIds);
      if (comments.length === 0) {
        res.status(400).json({ error: 'No matching comments to address' });
        return;
      }
      if (!todo.sessionId) {
        res.status(409).json({ error: 'This todo has no linked session to send feedback to.' });
        return;
      }
      const message = `Please address the following review feedback on PR #${monitor.prNumber} (${monitor.prUrl}):\n\n${formatComments(comments)}`;
      const ok = await terminal.sendInput(todo.sessionId, message);
      if (!ok) {
        res.status(409).json({ error: 'The linked session is not running — start or resume it, then try again.' });
        return;
      }
      res.json({ ok: true, sessionId: todo.sessionId, addressedCommentIds: comments.map((c) => c.id) });
    } catch (err) {
      console.error('Failed to send PR comment feedback:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send comment feedback' });
    }
  });

  router.post('/todos/:todoId/pr-actions/dismiss-comments', (req, res) => {
    try {
      const todo = todos.findById(req.params.todoId as TodoId);
      if (!todo) {
        res.status(404).json({ error: 'Todo not found' });
        return;
      }
      const body = (req.body ?? {}) as DismissCommentsBody;
      if (typeof body.prUrl !== 'string' || body.prUrl.trim().length === 0) {
        res.status(400).json({ error: 'prUrl is required' });
        return;
      }
      if (!Array.isArray(body.commentIds) || body.commentIds.length === 0 ||
          !body.commentIds.every((id) => typeof id === 'string' && id.length > 0)) {
        res.status(400).json({ error: 'commentIds must be a non-empty array of strings' });
        return;
      }
      // Scope the monitor to this todo (as the dispatch/send routes do) so a
      // mismatched todoId/prUrl pair can't dismiss comments on an unrelated PR.
      const target = pickMonitorForDispatch(monitors.findByTodo(todo.id), body.prUrl);
      if (!target) {
        res.status(404).json({ error: 'No PR monitor available for this todo' });
        return;
      }
      const monitor = monitors.dismissComments(target.prUrl, body.commentIds);
      if (!monitor) {
        res.status(404).json({ error: 'No PR monitor registered for that PR URL' });
        return;
      }
      broadcast('pr:updated', monitor.trackId, {
        todoId: monitor.todoId,
        prUrl: monitor.prUrl,
        state: monitor.state,
        checkStatus: monitor.checkStatus,
        monitoring: monitor.monitoring,
        pauseReason: monitor.pauseReason,
      });
      res.json({ monitor });
    } catch (err) {
      console.error('Failed to dismiss PR comments:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to dismiss comments' });
    }
  });

  return router;
}

// --- Dispatch helper ---

interface DispatchPrSessionParams {
  body: DispatchBody;
  todo: { id: TodoId; trackId: TrackId; title: string; description?: string; issueKey?: string };
  track: import('@foundation/types').Track;
  monitor: PrMonitor;
  templateContent: string;
  commentsForTemplate?: PrComment[];
  sessionLabel: string;
  deps: {
    tracks: TrackRepository;
    summaries: SummaryRepository;
    tickets: TicketRepository;
    agents: AgentRepository;
    filesystemScanner: FilesystemAgentScanner;
    settings: SettingsRepository;
    projectRoot: string;
    terminal: PrMonitorRouterDeps['terminal'];
  };
}

async function dispatchPrSession(params: DispatchPrSessionParams) {
  const { body, todo, track, monitor, templateContent, commentsForTemplate, sessionLabel, deps } = params;
  const { tracks, summaries, tickets, agents, filesystemScanner, settings, projectRoot, terminal } = deps;

  // Compose system prompt: agent + track context + summary + repos + PR-specific template
  const parts: string[] = [];

  const agentId = (body.agentId as AgentId | undefined) ?? track.defaultAgentId;
  if (agentId) {
    let agent = agents.findById(agentId);
    if (!agent) {
      agent = filesystemScanner.findById(agentId, projectRoot);
    }
    if (agent) {
      parts.push(`## Agent: ${agent.name}\n\n${agent.systemPrompt}`);
    }
  }

  if (track.context) parts.push(track.context);

  const summary = summaries.findLatest(todo.trackId);
  if (summary) parts.push(`## Current Status\n\n${summary.content}`);

  // Materialise track tickets so {{track.tickets}} resolves
  track.tickets = tickets.findByTrack(todo.trackId);

  const repos = tracks.findReposByTrack(todo.trackId);

  // Two-stage interpolation: standard track/todo first, then PR-specific vars.
  const stage1 = interpolateTemplate(templateContent, {
    track,
    todo: { id: todo.id, title: todo.title, description: todo.description ?? '' },
  });
  const stage2 = interpolatePrTemplate(stage1, { monitor, comments: commentsForTemplate });
  parts.push(stage2);

  if (repos.length > 0 && !templateContent.includes('{{track.repos')) {
    const repoLines = repos
      .map((r) => `- ${r.path}${r.remoteUrl ? ` (${r.remoteUrl})` : ''}`)
      .join('\n');
    parts.push(`## Repositories\n\n${repoLines}`);
  }

  const systemPrompt = parts.join('\n\n---\n\n');

  const initialPrompt = commentsForTemplate
    ? `Address review feedback on PR #${monitor.prNumber} (${monitor.prUrl}). See the system prompt for the comment list and procedure.`
    : `Investigate the failing CI checks on PR #${monitor.prNumber} (${monitor.prUrl}) and push a fix to the same branch. See the system prompt for the failing checks and procedure.`;

  const provider: SessionProvider = resolveSessionProvider(
    body.provider,
    settings.get('default_ai_cli'),
  );

  // We deliberately do NOT enable worktree mode for PR action sessions: the
  // sub-agent needs to operate on the PR's existing head branch (via
  // `gh pr checkout`), not in a fresh workshop-managed branch. Running in the
  // primary repo path lets the agent check out and push to the PR branch
  // without extra setup.
  return terminal.createSession(track.id, {
    systemPrompt,
    workingDirectory: repos[0]?.path,
    background: true,
    initialPrompt,
    provider,
    name: sessionLabel,
    worktreeMode: false,
    issueKey: todo.issueKey,
    dangerouslySkipPermissions: body.dangerouslySkipPermissions === true,
  });
}

