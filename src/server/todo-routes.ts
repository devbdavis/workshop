import { Router } from 'express';
import type { TrackId, TodoId, SessionId, AgentId, SessionProvider } from '@foundation/types';
import type { TodoRepository } from '@domain/todo/repository';
import type { TrackRepository } from '@domain/track/repository';
import type { SessionRepository } from '@domain/session/repository';
import type { SummaryRepository } from '@domain/summary/repository';
import type { TicketRepository } from '@domain/ticket/repository';
import type { PromptTemplateRepository } from '@domain/prompt-template/repository';
import type { AgentRepository } from '@domain/agent/repository';
import type { FilesystemAgentScanner } from '@infrastructure/agents/filesystem-scanner.js';
import type { VaultReader } from '@infrastructure/vault/reader.js';
import { slugifyTrackName } from '@infrastructure/vault/utils.js';
import { interpolateTemplate } from '@application/track-management/prompt-interpolation.js';
import { composeVaultContext } from '@application/vault/compose-vault-context.js';
import { broadcast } from './events.js';

export interface TodoRouterDeps {
  todos: TodoRepository;
  tracks: TrackRepository;
  sessions: SessionRepository;
  summaries: SummaryRepository;
  tickets: TicketRepository;
  promptTemplates: PromptTemplateRepository;
  agents: AgentRepository;
  filesystemScanner: FilesystemAgentScanner;
  projectRoot: string;
  terminal: {
    createSession: (
      trackId: TrackId,
      opts?: { systemPrompt?: string; workingDirectory?: string; background?: boolean; todoId?: string; initialPrompt?: string; provider?: SessionProvider; dangerouslySkipPermissions?: boolean; name?: string },
    ) => Promise<{ id: SessionId; trackId: TrackId; tmuxSession: string; state: string }>;
    destroySession: (sessionId: SessionId) => Promise<void>;
  };
  vaultReader: VaultReader;
}

export function createTodoRouter(deps: TodoRouterDeps): Router {
  const router = Router();
  const { todos, tracks, sessions, summaries, tickets, promptTemplates, agents, filesystemScanner, projectRoot, terminal, vaultReader } = deps;

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

    const { title, description, priority, refined, status } = req.body;
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
      refined: refined ?? false,
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
    const { title, description, status, priority, refined, sessionId, sortOrder } = req.body;

    // If transitioning to done, check for an active session to clean up
    const existing = todos.findById(req.params.todoId as TodoId);
    if (!existing) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    const todo = todos.update(req.params.todoId as TodoId, {
      title,
      description,
      status,
      priority,
      refined,
      sessionId,
      sortOrder,
    });
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    // Clean up tmux session when todo is marked done
    if (status === 'done' && existing.sessionId) {
      try {
        await terminal.destroySession(existing.sessionId);
        broadcast('session:deleted', todo.trackId);
      } catch (err) {
        console.error('Failed to clean up session for completed todo:', err);
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

      // Accept optional agentId, provider, and permission skip from request body
      const agentId = req.body?.agentId as AgentId | undefined;
      const provider: SessionProvider = req.body?.provider === 'codex' ? 'codex' : 'claude';
      const dangerouslySkipPermissions = req.body?.dangerouslySkipPermissions === true;

      // Compose system prompt: agent + track context + summary + template + todo task
      const parts: string[] = [];

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

      const summary = summaries.findLatest(todo.trackId);
      if (summary) {
        parts.push(`## Current Status\n\n${summary.content}`);
      }

      if (track.defaultPromptTemplateId) {
        const template = promptTemplates.findById(track.defaultPromptTemplateId);
        if (template) {
          track.tickets = tickets.findByTrack(todo.trackId);
          const interpolated = interpolateTemplate(template.content, { track });
          parts.push(interpolated);
        }
      }

      // Add the todo task as the specific instruction
      parts.push(`## Task\n\n**${todo.title}**\n\n${todo.description || ''}`);

      const systemPrompt = parts.join('\n\n---\n\n');
      const repos = tracks.findReposByTrack(todo.trackId);

      const taskPrompt = `Complete the following task:\n\n**${todo.title}**\n\n${todo.description || 'No additional details provided.'}`;

      const session = await terminal.createSession(todo.trackId, {
        systemPrompt,
        workingDirectory: repos[0]?.path,
        background: true,
        todoId: todo.id,
        initialPrompt: taskPrompt,
        provider,
        dangerouslySkipPermissions,
        name: todo.title,
      });

      // Update todo status, link session, and store agent reference
      const updated = todos.update(todo.id, {
        status: 'in-progress',
        sessionId: session.id as SessionId,
        agentId,
      });

      broadcast('todo:dispatched', todo.trackId);
      broadcast('session:created', todo.trackId);
      res.status(201).json({ todo: updated, session });
    } catch (err) {
      console.error('Failed to dispatch todo:', err);
      res.status(500).json({ error: 'Failed to dispatch todo to agent' });
    }
  });

  return router;
}
