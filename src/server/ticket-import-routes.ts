import { Router } from 'express';
import type { ImportableIssue, TicketSource, TrackId, TodoId } from '@foundation/types';
import type { SettingsRepository } from '@domain/repo/repository';
import type { TrackRepository } from '@domain/track/repository';
import type { TodoRepository } from '@domain/todo/repository';
import type { TicketImportIgnoreRepository } from '@domain/ticket-import/repository';
import {
  LinearApiError,
  getIssueByIdentifier as getLinearIssueByIdentifier,
  listAssignedOpenIssues as listLinearAssignedOpenIssues,
  type LinearIssue,
} from '@infrastructure/linear/client.js';
import {
  GithubCliError,
  getIssueByIdentifier as getGithubIssueByIdentifier,
  listAssignedOpenIssues as listGithubAssignedOpenIssues,
  type GithubIssue,
} from '@infrastructure/github/issues-client.js';
import { broadcast } from './events.js';

export interface TicketImportRouterDeps {
  settings: SettingsRepository;
  tracks: TrackRepository;
  todos: TodoRepository;
  ignores: TicketImportIgnoreRepository;
}

interface TicketImportListResponse {
  available: ImportableIssue[];
  ignored: ImportableIssue[];
  imported: ImportableIssue[];
}

type SupportedSource = 'linear' | 'github';

function isSupportedSource(value: string): value is SupportedSource {
  return value === 'linear' || value === 'github';
}

/**
 * Linear identifiers ("ASY-1402") are case-insensitive; GitHub identifiers
 * ("owner/repo#123") are case-sensitive — uppercasing would corrupt them.
 */
function normalizeId(source: SupportedSource, id: string): string {
  const trimmed = id.trim();
  return source === 'linear' ? trimmed.toUpperCase() : trimmed;
}

function toImportableFromLinear(issue: LinearIssue, importedTodoId?: TodoId): ImportableIssue {
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

function toImportableFromGithub(issue: GithubIssue, importedTodoId?: TodoId): ImportableIssue {
  return {
    source: 'github',
    externalId: issue.externalId,
    title: issue.title,
    description: issue.description ?? undefined,
    url: issue.url,
    stateName: issue.stateName,
    updatedAt: issue.updatedAt,
    importedTodoId,
  };
}

function readLinearApiKey(settings: SettingsRepository): string | null {
  const key = settings.get('linear_api_key');
  return key && key.trim().length > 0 ? key.trim() : null;
}

function readIssueTrackerOrg(settings: SettingsRepository): string | undefined {
  const org = settings.get('issue_tracker_org');
  return org && org.trim().length > 0 ? org.trim() : undefined;
}

/** Fetches every open issue assigned to the user for the given source, already mapped to ImportableIssue. */
async function listIssues(source: SupportedSource, settings: SettingsRepository): Promise<ImportableIssue[]> {
  if (source === 'linear') {
    const apiKey = readLinearApiKey(settings);
    if (!apiKey) throw new MissingConfigError('Linear API key not configured. Set it in Settings → Issue Tracking.');
    const issues = await listLinearAssignedOpenIssues(apiKey);
    return issues.map((i) => toImportableFromLinear(i));
  }
  const issues = await listGithubAssignedOpenIssues(readIssueTrackerOrg(settings));
  return issues.map((i) => toImportableFromGithub(i));
}

/** Looks up a single issue by its externalId for the given source, already mapped to ImportableIssue. */
async function findIssue(
  source: SupportedSource,
  settings: SettingsRepository,
  externalId: string,
): Promise<ImportableIssue | null> {
  if (source === 'linear') {
    const apiKey = readLinearApiKey(settings);
    if (!apiKey) throw new MissingConfigError('Linear API key not configured.');
    const issue = await getLinearIssueByIdentifier(apiKey, externalId);
    return issue ? toImportableFromLinear(issue) : null;
  }
  const issue = await getGithubIssueByIdentifier(externalId);
  return issue ? toImportableFromGithub(issue) : null;
}

/** Thrown when a source's required settings (e.g. Linear API key) aren't configured. */
class MissingConfigError extends Error {}

/**
 * Build an index of normalized externalId → todoId so the UI can flag issues
 * that already exist as todos.
 */
function indexTodosByIssueKey(todos: TodoRepository, source: SupportedSource): Map<string, TodoId> {
  const index = new Map<string, TodoId>();
  for (const todo of todos.findAll()) {
    if (todo.issueKey) {
      index.set(normalizeId(source, todo.issueKey), todo.id);
    }
  }
  return index;
}

function handleFetchError(source: TicketSource, err: unknown, res: import('express').Response, action: string): void {
  if (err instanceof MissingConfigError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof LinearApiError) {
    res.status(err.status === 401 || err.status === 403 ? 401 : 502).json({ error: err.message });
    return;
  }
  if (err instanceof GithubCliError) {
    res.status(err.code === 'ENOENT' || err.code === 4 ? 400 : 502).json({ error: err.message });
    return;
  }
  console.error(`Failed to ${action} ${source} issue(s):`, err);
  res.status(500).json({ error: `Failed to ${action} ${source} issue(s)` });
}

export function createTicketImportRouter(deps: TicketImportRouterDeps): Router {
  const router = Router();
  const { settings, tracks, todos, ignores } = deps;

  // --- List issues ---

  router.get('/ticket-import/:source', async (req, res) => {
    const { source } = req.params;
    if (!isSupportedSource(source)) {
      res.status(400).json({ error: `Unsupported issue tracker: ${source}` });
      return;
    }

    try {
      const [issues, ignoreList] = [await listIssues(source, settings), ignores.findBySource(source)];

      const ignoredIds = new Set(ignoreList.map((i) => normalizeId(source, i.externalId)));
      const importedIndex = indexTodosByIssueKey(todos, source);

      const available: ImportableIssue[] = [];
      const imported: ImportableIssue[] = [];

      for (const issue of issues) {
        const key = normalizeId(source, issue.externalId);
        if (ignoredIds.has(key)) continue;
        const importedTodoId = importedIndex.get(key);
        const payload: ImportableIssue = { ...issue, importedTodoId };
        if (importedTodoId) {
          imported.push(payload);
        } else {
          available.push(payload);
        }
      }

      // For the Ignored tab, prefer fresh data from the live response so titles
      // and URLs stay current; fall back to the cached values captured at ignore time.
      const issueIndex = new Map(issues.map((i) => [normalizeId(source, i.externalId), i]));
      const ignored: ImportableIssue[] = ignoreList.map((entry) => {
        const live = issueIndex.get(normalizeId(source, entry.externalId));
        if (live) return live;
        return {
          source,
          externalId: entry.externalId,
          title: entry.cachedTitle ?? entry.externalId,
          url: entry.cachedUrl ?? '',
        };
      });

      const response: TicketImportListResponse = { available, ignored, imported };
      res.json(response);
    } catch (err) {
      handleFetchError(source, err, res, 'list');
    }
  });

  // --- Import one issue as a Todo ---

  router.post('/ticket-import/:source/import', async (req, res) => {
    const { source } = req.params;
    if (!isSupportedSource(source)) {
      res.status(400).json({ error: `Unsupported issue tracker: ${source}` });
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

    const identifier = normalizeId(source, externalId);
    const track = tracks.findById(trackId as TrackId);
    if (!track) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }

    // Guard against double-import — if a todo already carries this issueKey, return it.
    const existing = todos.findAll().find((t) => t.issueKey && normalizeId(source, t.issueKey) === identifier);
    if (existing) {
      res.status(200).json({ todo: existing, alreadyImported: true });
      return;
    }

    try {
      const issue = await findIssue(source, settings, identifier);
      if (!issue) {
        res.status(404).json({ error: `${source} issue ${identifier} not found or not visible.` });
        return;
      }

      const todo = todos.create({
        trackId: track.id,
        title: issue.title,
        description: issue.description,
        issueKey: issue.externalId,
        status: 'backlog',
        priority: 'medium',
        sortOrder: 0,
      });

      // If the issue was in the ignored list, unignore it automatically — importing
      // is a stronger signal than hiding, and we don't want it hiding from its own
      // Todo card forever.
      ignores.remove(source, issue.externalId);

      broadcast('todo:created', track.id);
      res.status(201).json({ todo, alreadyImported: false });
    } catch (err) {
      handleFetchError(source, err, res, 'import');
    }
  });

  // --- Ignore an issue (hide from Available tab) ---

  router.post('/ticket-import/:source/ignore', (req, res) => {
    const { source } = req.params;
    if (!isSupportedSource(source)) {
      res.status(400).json({ error: `Unsupported issue tracker: ${source}` });
      return;
    }

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
      source,
      externalId: normalizeId(source, externalId),
      cachedTitle: typeof cachedTitle === 'string' && cachedTitle.trim() ? cachedTitle.trim() : undefined,
      cachedUrl: typeof cachedUrl === 'string' && cachedUrl.trim() ? cachedUrl.trim() : undefined,
    });
    res.status(201).json(entry);
  });

  // --- Unignore (restore to Available tab) ---

  router.delete('/ticket-import/:source/ignore/:externalId', (req, res) => {
    const { source } = req.params;
    if (!isSupportedSource(source)) {
      res.status(400).json({ error: `Unsupported issue tracker: ${source}` });
      return;
    }

    const externalId = req.params.externalId;
    if (!externalId) {
      res.status(400).json({ error: 'externalId is required' });
      return;
    }
    const removed = ignores.remove(source, normalizeId(source, externalId));
    if (!removed) {
      res.status(404).json({ error: 'Ignore entry not found' });
      return;
    }
    res.status(204).send();
  });

  return router;
}
