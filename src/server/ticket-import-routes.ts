import { Router } from 'express';
import type { ImportableIssue, TrackId, TodoId } from '@foundation/types';
import type { SettingsRepository } from '@domain/repo/repository';
import type { TrackRepository } from '@domain/track/repository';
import type { TodoRepository } from '@domain/todo/repository';
import type { TicketImportIgnoreRepository } from '@domain/ticket-import/repository';
import {
  LinearApiError,
  getIssueByIdentifier,
  listAssignedOpenIssues,
  type LinearIssue,
} from '@infrastructure/linear/client.js';
import { broadcast } from './events.js';

export interface TicketImportRouterDeps {
  settings: SettingsRepository;
  tracks: TrackRepository;
  todos: TodoRepository;
  ignores: TicketImportIgnoreRepository;
}

interface LinearListResponse {
  available: ImportableIssue[];
  ignored: ImportableIssue[];
  imported: ImportableIssue[];
}

function toImportable(issue: LinearIssue, importedTodoId?: TodoId): ImportableIssue {
  return {
    source: 'linear',
    externalId: issue.identifier,
    title: issue.title,
    description: issue.description ?? undefined,
    url: issue.url,
    stateName: issue.state?.name,
    stateType: issue.state?.type,
    projectName: issue.project?.name ?? undefined,
    priority: issue.priority,
    updatedAt: issue.updatedAt,
    importedTodoId,
  };
}

function readApiKey(settings: SettingsRepository): string | null {
  const key = settings.get('linear_api_key');
  return key && key.trim().length > 0 ? key.trim() : null;
}

/**
 * Build an index of issueKey → todoId so the UI can flag issues that already
 * exist as todos. Matching is done on the exact `issueKey` field; we don't try
 * to normalise or guess.
 */
function indexTodosByIssueKey(todos: TodoRepository): Map<string, TodoId> {
  const index = new Map<string, TodoId>();
  for (const todo of todos.findAll()) {
    if (todo.issueKey) {
      index.set(todo.issueKey.toUpperCase(), todo.id);
    }
  }
  return index;
}

export function createTicketImportRouter(deps: TicketImportRouterDeps): Router {
  const router = Router();
  const { settings, tracks, todos, ignores } = deps;

  // --- List Linear issues ---

  router.get('/ticket-import/linear', async (_req, res) => {
    const apiKey = readApiKey(settings);
    if (!apiKey) {
      res.status(400).json({ error: 'Linear API key not configured. Set it in Settings → Issue Tracking.' });
      return;
    }

    try {
      const [issues, ignoreList] = [
        await listAssignedOpenIssues(apiKey),
        ignores.findBySource('linear'),
      ];

      const ignoredIds = new Set(ignoreList.map((i) => i.externalId.toUpperCase()));
      const importedIndex = indexTodosByIssueKey(todos);

      const available: ImportableIssue[] = [];
      const imported: ImportableIssue[] = [];

      for (const issue of issues) {
        const key = issue.identifier.toUpperCase();
        if (ignoredIds.has(key)) continue;
        const importedTodoId = importedIndex.get(key);
        const payload = toImportable(issue, importedTodoId);
        if (importedTodoId) {
          imported.push(payload);
        } else {
          available.push(payload);
        }
      }

      // For the Ignored tab, prefer fresh data from the Linear response so titles
      // and URLs stay current; fall back to the cached values captured at ignore time.
      const issueIndex = new Map(issues.map((i) => [i.identifier.toUpperCase(), i]));
      const ignored: ImportableIssue[] = ignoreList.map((entry) => {
        const live = issueIndex.get(entry.externalId.toUpperCase());
        if (live) return toImportable(live);
        return {
          source: 'linear',
          externalId: entry.externalId,
          title: entry.cachedTitle ?? entry.externalId,
          url: entry.cachedUrl ?? '',
        };
      });

      const response: LinearListResponse = { available, ignored, imported };
      res.json(response);
    } catch (err) {
      if (err instanceof LinearApiError) {
        res.status(err.status === 401 || err.status === 403 ? 401 : 502).json({ error: err.message });
        return;
      }
      console.error('Failed to list Linear issues:', err);
      res.status(500).json({ error: 'Failed to list Linear issues' });
    }
  });

  // --- Import one issue as a Todo ---

  router.post('/ticket-import/linear/import', async (req, res) => {
    const apiKey = readApiKey(settings);
    if (!apiKey) {
      res.status(400).json({ error: 'Linear API key not configured.' });
      return;
    }

    const { externalId, trackId } = req.body as { externalId?: unknown; trackId?: unknown };
    if (typeof externalId !== 'string' || !externalId.trim()) {
      res.status(400).json({ error: 'externalId is required' });
      return;
    }
    if (typeof trackId !== 'string' || !trackId.trim()) {
      res.status(400).json({ error: 'trackId is required' });
      return;
    }

    const identifier = externalId.trim().toUpperCase();
    const track = tracks.findById(trackId as TrackId);
    if (!track) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }

    // Guard against double-import — if a todo already carries this issueKey, return it.
    const existing = todos.findAll().find((t) => t.issueKey?.toUpperCase() === identifier);
    if (existing) {
      res.status(200).json({ todo: existing, alreadyImported: true });
      return;
    }

    try {
      const issue = await getIssueByIdentifier(apiKey, identifier);
      if (!issue) {
        res.status(404).json({ error: `Linear issue ${identifier} not found or not visible with this API key.` });
        return;
      }

      const todo = todos.create({
        trackId: track.id,
        title: issue.title,
        description: issue.description ?? undefined,
        issueKey: issue.identifier,
        status: 'backlog',
        priority: 'medium',
        sortOrder: 0,
      });

      // If the issue was in the ignored list, unignore it automatically — importing
      // is a stronger signal than hiding, and we don't want it hiding from its own
      // Todo card forever.
      ignores.remove('linear', issue.identifier);

      broadcast('todo:created', track.id);
      res.status(201).json({ todo, alreadyImported: false });
    } catch (err) {
      if (err instanceof LinearApiError) {
        res.status(err.status === 401 || err.status === 403 ? 401 : 502).json({ error: err.message });
        return;
      }
      console.error('Failed to import Linear issue:', err);
      res.status(500).json({ error: 'Failed to import Linear issue' });
    }
  });

  // --- Ignore an issue (hide from Available tab) ---

  router.post('/ticket-import/linear/ignore', (req, res) => {
    const { externalId, cachedTitle, cachedUrl } = req.body as {
      externalId?: unknown;
      cachedTitle?: unknown;
      cachedUrl?: unknown;
    };
    if (typeof externalId !== 'string' || !externalId.trim()) {
      res.status(400).json({ error: 'externalId is required' });
      return;
    }
    const entry = ignores.add({
      source: 'linear',
      externalId: externalId.trim().toUpperCase(),
      cachedTitle: typeof cachedTitle === 'string' && cachedTitle.trim() ? cachedTitle.trim() : undefined,
      cachedUrl: typeof cachedUrl === 'string' && cachedUrl.trim() ? cachedUrl.trim() : undefined,
    });
    res.status(201).json(entry);
  });

  // --- Unignore (restore to Available tab) ---

  router.delete('/ticket-import/linear/ignore/:externalId', (req, res) => {
    const externalId = req.params.externalId?.toUpperCase();
    if (!externalId) {
      res.status(400).json({ error: 'externalId is required' });
      return;
    }
    const removed = ignores.remove('linear', externalId);
    if (!removed) {
      res.status(404).json({ error: 'Ignore entry not found' });
      return;
    }
    res.status(204).send();
  });

  return router;
}
