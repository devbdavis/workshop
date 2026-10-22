import { Router } from 'express';
import type { TrackId, TodoId, SessionId, AgentId, SessionProvider, TrackRepo } from '@foundation/types';
import { resolveSessionProvider } from '@foundation/types.js';
import type { TodoRepository } from '@domain/todo/repository';
import type { TrackRepository } from '@domain/track/repository';
import type { SessionRepository } from '@domain/session/repository';
import type { TicketRepository } from '@domain/ticket/repository';
import type { PromptTemplateRepository } from '@domain/prompt-template/repository';
import type { AgentRepository } from '@domain/agent/repository';
import type { SettingsRepository } from '@domain/repo/repository';
import type { FilesystemAgentScanner } from '@infrastructure/agents/filesystem-scanner.js';
import type { VaultReader } from '@infrastructure/vault/reader.js';
import type { PrMonitorRegistrar } from '@application/pr-monitor/registrar.js';
import { slugifyTrackName } from '@infrastructure/vault/utils.js';
import { interpolateTemplate } from '@application/track-management/prompt-interpolation.js';
import { composeVaultContext } from '@application/vault/compose-vault-context.js';
import { broadcast } from './events.js';

/** Settings key caching the dedicated system track that hosts ticket-drafting sessions. */
const LINEAR_TICKET_TRACK_SETTING = 'linear_ticket_track_id';

/** Result of a "create Linear ticket" agent run, surfaced to the modal. */
interface LinearTicketJob {
  status: 'pending' | 'done';
  issueKey?: string;
  url?: string;
  title?: string;
  body?: string;
}

// Values are interpolated into a gh command in the agent prompt, so keep them shell-inert.
const GITHUB_REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const GITHUB_LABEL_RE = /^[^"'`$\\,\n\r]+$/;

export interface TodoRouterDeps {
  todos: TodoRepository;
  tracks: TrackRepository;
  sessions: SessionRepository;
  tickets: TicketRepository;
  promptTemplates: PromptTemplateRepository;
  agents: AgentRepository;
  settings: SettingsRepository;
  filesystemScanner: FilesystemAgentScanner;
  projectRoot: string;
  terminal: {
    createSession: (
      trackId: TrackId,
      opts?: { systemPrompt?: string; workingDirectory?: string; background?: boolean; todoId?: string; initialPrompt?: string; provider?: SessionProvider; model?: string; name?: string; worktreeMode?: boolean; repos?: TrackRepo[]; additionalDirs?: string[]; issueKey?: string; dangerouslySkipPermissions?: boolean; skipBackgroundInstructions?: boolean; onReady?: (session: { id: SessionId }) => void },
    ) => Promise<{ id: SessionId; trackId: TrackId; tmuxSession: string; state: string }>;
    destroySession: (sessionId: SessionId) => Promise<void>;
    softDeleteSession: (sessionId: SessionId) => Promise<void>;
  };
  vaultReader: VaultReader;
  /**
   * Optional — when provided, the todo update endpoint reconciles PR monitor
   * rows against the new `pullRequests` list so submit-for-review et al don't
   * need a separate API call to register monitoring.
   */
  prMonitorRegistrar?: PrMonitorRegistrar;
}

export function createTodoRouter(deps: TodoRouterDeps): Router {
  const router = Router();
  const {
    todos,
    tracks,
    sessions,
    tickets,
    promptTemplates,
    agents,
    settings,
    filesystemScanner,
    projectRoot,
    terminal,
    vaultReader,
    prMonitorRegistrar,
  } = deps;

  // Ephemeral results of "create Linear ticket" runs, keyed by todoId. In-memory
  // on purpose — a transient aid for the modal, fine to lose on server restart.
  const linearTicketJobs = new Map<string, LinearTicketJob>();

  /** The dedicated system track that hosts ticket-drafting sessions (lazily created, id cached in settings). */
  function ensureLinearTicketTrack(): TrackId {
    const cached = settings.get(LINEAR_TICKET_TRACK_SETTING);
    if (cached && tracks.findById(cached as TrackId)) return cached as TrackId;
    const track = tracks.create({
      name: 'Linear Tickets',
      description: 'Background sessions that draft and file Linear tickets from todos.',
      label: 'system',
      status: 'active',
    });
    settings.set(LINEAR_TICKET_TRACK_SETTING, track.id);
    return track.id;
  }

  // --- List all todos (with optional filters) ---

  router.get('/todos', (req, res) => {
    const { trackId, status } = req.query;
    if (trackId) {
      res.json(todos.findByTrack(trackId as TrackId));
      return;
    }
    if (status) {
      res.json(todos.findByStatus(status as any));
      return;
    }
    res.json(todos.findAll());
  });

  // --- List todos for a track ---

  router.get('/tracks/:id/todos', (req, res) => {
    res.json(todos.findByTrack(req.params.id as TrackId));
  });

  // --- Create todo for a track ---

  router.post('/tracks/:id/todos', (req, res) => {
    const trackId = req.params.id as TrackId;
    const track = tracks.findById(trackId);
    if (!track) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }

    const { title, description, priority, status } = req.body;
    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    const todo = todos.create({
      trackId,
      title,
      description,
      status: status || 'backlog',
      priority: priority || 'medium',
      sortOrder: 0,
    });
    broadcast('todo:created', trackId);
    res.status(201).json(todo);
  });

  // --- Batch reorder todos ---

  router.post('/todos/reorder', (req, res) => {
    const { updates } = req.body;
    if (!Array.isArray(updates)) {
      res.status(400).json({ error: 'updates must be an array' });
      return;
    }
    for (const { id, sortOrder } of updates) {
      if (typeof id === 'string' && typeof sortOrder === 'number') {
        todos.update(id as TodoId, { sortOrder });
      }
    }
    broadcast('todo:updated', '' as any);
    res.json({ ok: true });
  });

  // --- Get single todo ---

  router.get('/todos/:todoId', (req, res) => {
    const todo = todos.findById(req.params.todoId as TodoId);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }
    res.json(todo);
  });

  // --- Update todo ---

  router.put('/todos/:todoId', async (req, res) => {
    const { title, description, resolution, issueKey, pullRequests, status, priority, sessionId, sortOrder } = req.body;

    // If transitioning to done, check for an active session to clean up
    const existing = todos.findById(req.params.todoId as TodoId);
    if (!existing) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    // Clear session/agent assignment when moving to 'done' from any active state.
    // Moving to 'review' or back to 'backlog'/'ready' preserves the link so the
    // session header keeps showing PR/ticket icons while the session is still alive.
    const isMovingToDone = status === 'done' && existing.status !== 'done';
    const resolvedSessionId = isMovingToDone ? null : sessionId;
    const resolvedAgentId: null | undefined = isMovingToDone ? null : undefined;

    const todo = todos.update(req.params.todoId as TodoId, {
      title,
      description,
      resolution,
      issueKey,
      pullRequests,
      status,
      priority,
      sessionId: resolvedSessionId,
      agentId: resolvedAgentId,
      sortOrder,
    });
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    // Soft-delete session to recycle bin when todo is marked done
    if (isMovingToDone && existing.sessionId) {
      try {
        await terminal.softDeleteSession(existing.sessionId);
        broadcast('session:deleted', todo.trackId);
      } catch (err) {
        console.error('Failed to soft-delete session for completed todo:', err);
      }
    }

    // Reconcile PR monitor rows when pullRequests changed (or the todo moved to done).
    // The registrar is idempotent — calling it on every update is cheap.
    if (prMonitorRegistrar) {
      try {
        if (isMovingToDone) {
          // Closing out the todo — stop tracking its PRs entirely.
          prMonitorRegistrar.removeAllForTodo(todo.id);
        } else if (pullRequests !== undefined) {
          prMonitorRegistrar.reconcile(todo);
        }
      } catch (err) {
        console.error('Failed to reconcile PR monitors for todo:', err);
      }
    }

    broadcast('todo:updated', todo.trackId);
    res.json(todo);
  });

  // --- Delete todo ---

  router.delete('/todos/:todoId', (req, res) => {
    const todo = todos.findById(req.params.todoId as TodoId);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }
    // Drop PR monitors before deleting the todo so the ON DELETE CASCADE doesn't
    // sweep them silently — we want explicit unregister behaviour for observability.
    if (prMonitorRegistrar) {
      try {
        prMonitorRegistrar.removeAllForTodo(todo.id);
      } catch (err) {
        console.error('Failed to remove PR monitors for deleted todo:', err);
      }
    }
    todos.delete(todo.id);
    broadcast('todo:deleted', todo.trackId);
    res.status(204).send();
  });

  // --- Dispatch todo to an agent session ---

  router.post('/todos/:todoId/dispatch', async (req, res) => {
    try {
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

      // Accept optional agentId, provider, and dangerouslySkipPermissions from request body.
      // If no agentId provided, fall back to the track's configured default agent.
      const agentId = (req.body?.agentId as AgentId | undefined) ?? track.defaultAgentId;
      const provider: SessionProvider = resolveSessionProvider(
        req.body?.provider,
        settings.get('default_ai_cli'),
      );
      const dangerouslySkipPermissions: boolean = req.body?.dangerouslySkipPermissions === true;

      // Dispatched sessions are orchestrators — run them on the configured
      // model (default opus). Empty setting disables the --model flag.
      const model: string | undefined = (settings.get('dispatch_model') ?? 'opus').trim() || undefined;

      // Compose system prompt: agent + track context + template + repos + todo task
      const parts: string[] = [];
      const repos = tracks.findReposByTrack(todo.trackId);

      // If an agent is specified, prepend its system prompt
      if (agentId) {
        // Check DB first (workshop agents), then filesystem
        let agent = agents.findById(agentId);
        if (!agent) {
          agent = filesystemScanner.findById(agentId, projectRoot);
        }
        if (agent) {
          parts.push(`## Agent: ${agent.name}\n\n${agent.systemPrompt}`);
        }
      }

      if (track.context) {
        parts.push(track.context);
      }

      // Vault memory (persistent Obsidian notes)
      const trackSlug = slugifyTrackName(track.name);
      const vaultContext = composeVaultContext(vaultReader, trackSlug);
      if (vaultContext) {
        parts.push(vaultContext);
      }

      let templateHasRepos = false;
      let templateHasTask = false;
      let templateHasBackgroundInstructions = false;
      if (track.defaultPromptTemplateId) {
        const template = promptTemplates.findById(track.defaultPromptTemplateId);
        if (template) {
          templateHasRepos = template.content.includes('{{track.repos');
          templateHasTask = template.content.includes('{{todo.title}}');
          templateHasBackgroundInstructions = template.content.includes('{{todo.id}}');
          track.tickets = tickets.findByTrack(todo.trackId);
          // Merge the todo's ticket key into the track ticket list so it's
          // available via {{track.tickets}} in template interpolation.
          if (todo.issueKey) {
            const alreadyPresent = track.tickets.some((t) => t.externalId === todo.issueKey);
            if (!alreadyPresent) {
              track.tickets = [
                ...track.tickets,
                {
                  id: `todo-ticket-${todo.id}` as import('@foundation/types').TicketId,
                  trackId: todo.trackId,
                  source: 'linear' as const,
                  externalId: todo.issueKey,
                  relationship: 'primary' as const,
                  createdAt: new Date().toISOString(),
                },
              ];
            }
          }
          const interpolated = interpolateTemplate(template.content, {
            track,
            todo: { id: todo.id, title: todo.title, description: todo.description ?? '' },
          });
          parts.push(interpolated);
        }
      }

      // Include repos unless the template already expanded them
      if (repos.length > 0 && !templateHasRepos) {
        const repoLines = repos
          .map((r) => `- ${r.path}${r.remoteUrl ? ` (${r.remoteUrl})` : ''}`)
          .join('\n');
        parts.push(`## Repositories\n\n${repoLines}`);
      }

      // Track Paths
      const paths = tracks.findPathsByTrack(todo.trackId);
      if (paths.length > 0) {
        const pathLines = paths
          .map((p) => `- ${p.path}${p.label ? ` (${p.label})` : ''}`)
          .join('\n');
        parts.push(`## Track Paths\n\n${pathLines}`);
      }

      // Add the todo task unless the template already includes it
      if (!templateHasTask) {
        parts.push(`## Task\n\n**${todo.title}**\n\n${todo.description || ''}`);
      }

      const systemPrompt = parts.join('\n\n---\n\n');

      const prLines = (todo.pullRequests ?? [])
        .map((pr) => `- ${pr.title ? `${pr.title}: ` : ''}${pr.url}`)
        .join('\n');
      const taskPrompt = `Complete the following task:\n\n**${todo.title}**\n\n${todo.description || 'No additional details provided.'}${prLines ? `\n\nAssociated pull requests:\n${prLines}` : ''}`;

      const session = await terminal.createSession(todo.trackId, {
        systemPrompt,
        workingDirectory: repos[0]?.path,
        background: true,
        todoId: todo.id,
        initialPrompt: taskPrompt,
        provider,
        model,
        name: todo.title,
        worktreeMode: track.worktreeMode && repos.length > 0,
        repos: track.worktreeMode ? repos : undefined,
        issueKey: todo.issueKey,
        dangerouslySkipPermissions,
        skipBackgroundInstructions: templateHasBackgroundInstructions,
        onReady: (s) => broadcast('session:ready', todo.trackId, { sessionId: s.id }),
      });

      // Update todo status, link session, and store agent reference
      const updated = todos.update(todo.id, {
        status: 'in-progress',
        sessionId: session.id as SessionId,
        agentId,
      });

      broadcast('todo:dispatched', todo.trackId);
      broadcast('session:created', todo.trackId, { sessionId: session.id });
      res.status(201).json({ todo: updated, session });
    } catch (err) {
      console.error('Failed to dispatch todo:', err);
      res.status(500).json({ error: 'Failed to dispatch todo to agent' });
    }
  });

  // --- Create a Linear ticket or GitHub issue from a todo (one-shot background agent) ---

  router.post('/todos/:todoId/create-linear-ticket', async (req, res) => {
    try {
      const todo = todos.findById(req.params.todoId as TodoId);
      if (!todo) {
        res.status(404).json({ error: 'Todo not found' });
        return;
      }

      const github = settings.get('issue_tracker') === 'github';
      const body = (req.body ?? {}) as { repo?: unknown; labels?: unknown };
      const repo = (
        typeof body.repo === 'string'
          ? body.repo
          : (settings.get('issue_tracker_github_repo') ?? '')
      ).trim();
      const labels = (
        Array.isArray(body.labels)
          ? body.labels
          : (settings.get('issue_tracker_github_labels') ?? '').split(',')
      )
        .filter((l): l is string => typeof l === 'string')
        .map((l) => l.trim())
        .filter(Boolean);
      if (github && !GITHUB_REPO_RE.test(repo)) {
        res.status(400).json({ error: 'repo must be in owner/name form' });
        return;
      }
      if (github && labels.some((l) => !GITHUB_LABEL_RE.test(l))) {
        res.status(400).json({ error: 'labels may not contain quotes, commas, or newlines' });
        return;
      }

      const model: string | undefined =
        (settings.get('dispatch_model') ?? 'opus').trim() || undefined;

      // Canonical (non-worktree) repo clones from the todo's track, so the agent
      // can deep-dive into the code while drafting the ticket. Read-only by intent.
      const repoPaths = (tracks.findById(todo.trackId)?.repos ?? []).map((r) => r.path);

      const fileSteps = github
        ? [
            `2. Write the body to a temp file, then create the issue with the gh CLI: \`gh issue create --repo ${repo}${labels.map((l) => ` --label "${l}"`).join('')} --title <title> --body-file <file>\`.`,
            `3. After the issue is filed, call the workshop_report_linear_ticket MCP tool with todoId "${todo.id}", issueKey "${repo}#<number>", the issue url, the title, and the full body. This links the issue to the todo and lets Workshop show it.`,
          ]
        : [
            '2. Use the /linear skill to create the ticket for team ASY with that content.',
            `3. After the ticket is filed, call the workshop_report_linear_ticket MCP tool with todoId "${todo.id}", the resulting issueKey (e.g. "ASY-1234"), the ticket url, the title, and the full body. This links the ticket to the todo and lets Workshop show it.`,
          ];

      const prompt = [
        github
          ? `Turn this Workshop todo into a GitHub issue in ${repo}.`
          : 'Turn this Workshop todo into a Linear ticket.',
        '',
        `Todo title: ${todo.title}`,
        '',
        'Todo details:',
        todo.description?.trim() || '(no description provided)',
        '',
        ...(repoPaths.length > 0
          ? [
              'Relevant repositories (read-only — investigate code here as needed to write an accurate ticket, but do NOT modify anything):',
              ...repoPaths.map((p) => `- ${p}`),
              '',
            ]
          : []),
        'Do the following:',
        '1. Expand the todo into a well-structured ticket body — a brief Description, concrete Implementation Details, and Acceptance Criteria — inferred from the todo above. This is not a full implementation plan; stay within the scope the todo implies and do not invent extra work.',
        ...fileSteps,
      ].join('\n');

      // One-shot background session on a dedicated system track: no todoId → runs
      // with --print and auto-exits (mirrors the PR-review analyze dispatch).
      // Claude-only because /linear is a Claude skill. Does NOT change the todo's status.
      const trackId = ensureLinearTicketTrack();
      linearTicketJobs.set(todo.id, { status: 'pending' });
      const session = await terminal.createSession(trackId, {
        background: true,
        initialPrompt: prompt,
        provider: 'claude',
        model,
        name: `${github ? 'GitHub' : 'Linear'}: ${todo.title}`,
        worktreeMode: false,
        additionalDirs: repoPaths,
        dangerouslySkipPermissions: true,
        onReady: (s) => broadcast('session:ready', trackId, { sessionId: s.id }),
      });

      broadcast('session:created', trackId, { sessionId: session.id });
      res.status(201).json({ session });
    } catch (err) {
      console.error('Failed to create Linear ticket from todo:', err);
      res.status(500).json({ error: 'Failed to dispatch Linear ticket session' });
    }
  });

  // --- Poll the result of a "create Linear ticket" run (drives the modal) ---

  router.get('/todos/:todoId/linear-ticket-status', (req, res) => {
    res.json(linearTicketJobs.get(req.params.todoId) ?? { status: 'pending' });
  });

  // --- Ticket result arrives here (via the workshop_report_linear_ticket MCP tool) ---

  router.post('/todos/report-linear-ticket', (req, res) => {
    const { todoId, issueKey, url, title, body } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof todoId !== 'string') {
      res.status(400).json({ error: 'todoId is required' });
      return;
    }
    const todo = todos.findById(todoId as TodoId);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }
    const key = typeof issueKey === 'string' && issueKey.trim() ? issueKey.trim() : undefined;
    linearTicketJobs.set(todoId, {
      status: 'done',
      issueKey: key,
      url: typeof url === 'string' ? url : undefined,
      title: typeof title === 'string' ? title : undefined,
      body: typeof body === 'string' ? body : undefined,
    });
    // Link the ticket to the todo so it shows in the Issue field.
    if (key) {
      todos.update(todo.id, { issueKey: key });
      broadcast('todo:updated', todo.trackId);
    }
    res.json({ ok: true });
  });

  return router;
}
