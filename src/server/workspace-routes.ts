import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, realpathSync, lstatSync } from 'fs';
import path from 'path';
import { Router } from 'express';
import type { SessionId } from '@foundation/types';
import type { SessionRepository } from '@domain/session/repository';
import type { TrackRepository } from '@domain/track/repository';
import { listChanges, findRepoForFile, diffFile } from '@infrastructure/git/workspace-git.js';

const MAX_FILE_SIZE = 1024 * 1024; // 1 MB
const BINARY_SNIFF_BYTES = 8192;

export interface WorkspaceRouterDeps {
  sessions: SessionRepository;
  tracks: TrackRepository;
}

interface WorkspaceEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size?: number;
}

/** Workspace root for a session: worktree root, else the track's first repo, else the raw cwd. */
function workspaceRoot(deps: WorkspaceRouterDeps, sessionId: SessionId): string | null {
  const session = deps.sessions.findById(sessionId);
  if (!session) return null;
  const repos = deps.tracks.findReposByTrack(session.trackId);
  return session.worktreeRoot ?? repos[0]?.path ?? session.workingDirectory ?? null;
}

/**
 * Resolves a root-relative path for reading, requiring the realpath to land inside `root`.
 * Rejects traversal (`../`) and symlinks that escape the root. Returns null if invalid or missing.
 */
function resolveExisting(root: string, rel: string): string | null {
  if (typeof rel !== 'string') return null;
  const resolved = path.resolve(root, rel || '.');
  try {
    const realRoot = realpathSync(root);
    const realResolved = realpathSync(resolved);
    if (realResolved === realRoot || realResolved.startsWith(realRoot + path.sep)) return realResolved;
  } catch {
    // doesn't exist, or root itself is unreadable
  }
  return null;
}

/** Resolves a root-relative path for writing: the file may not exist yet, but its parent dir must, inside `root`. */
function resolveForWrite(root: string, rel: string): string | null {
  const existing = resolveExisting(root, rel);
  if (existing) return existing;
  if (typeof rel !== 'string' || !rel) return null;
  const resolved = path.resolve(root, rel);
  // Something (e.g. an escaping or dangling symlink) already sits here but failed the check above: writing would follow it.
  if (lstatSync(resolved, { throwIfNoEntry: false })) return null;
  const parent = path.dirname(resolved);
  try {
    const realRoot = realpathSync(root);
    const realParent = realpathSync(parent);
    if (realParent === realRoot || realParent.startsWith(realRoot + path.sep)) {
      return path.join(realParent, path.basename(resolved));
    }
  } catch {
    // parent doesn't exist
  }
  return null;
}

export function createWorkspaceRouter(deps: WorkspaceRouterDeps): Router {
  const router = Router();

  router.get('/sessions/:id/workspace/tree', (req, res) => {
    const root = workspaceRoot(deps, req.params.id as SessionId);
    if (!root) {
      res.status(404).json({ error: 'Session or workspace root not found' });
      return;
    }
    const rel = typeof req.query.path === 'string' ? req.query.path : '';
    const abs = resolveExisting(root, rel);
    if (!abs || !statSync(abs).isDirectory()) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }

    const entries: WorkspaceEntry[] = readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.name !== '.git' && e.name !== 'node_modules')
      .map((e): WorkspaceEntry => {
        const entryAbs = path.join(abs, e.name);
        const entryRel = path.relative(root, entryAbs);
        return e.isDirectory()
          ? { name: e.name, path: entryRel, type: 'dir' }
          : { name: e.name, path: entryRel, type: 'file', size: statSync(entryAbs).size };
      })
      .sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));

    res.json({ root, entries });
  });

  router.get('/sessions/:id/workspace/file', (req, res) => {
    const root = workspaceRoot(deps, req.params.id as SessionId);
    if (!root) {
      res.status(404).json({ error: 'Session or workspace root not found' });
      return;
    }
    const rel = typeof req.query.path === 'string' ? req.query.path : '';
    const abs = resolveExisting(root, rel);
    if (!abs || !statSync(abs).isFile()) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }

    const size = statSync(abs).size;
    if (size > MAX_FILE_SIZE) {
      res.json({ path: path.relative(root, abs), content: '', binary: false, tooLarge: true });
      return;
    }

    const buffer = readFileSync(abs);
    const binary = buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
    res.json({
      path: path.relative(root, abs),
      content: binary ? '' : buffer.toString('utf8'),
      binary,
      tooLarge: false,
    });
  });

  router.put('/sessions/:id/workspace/file', (req, res) => {
    const root = workspaceRoot(deps, req.params.id as SessionId);
    if (!root) {
      res.status(404).json({ error: 'Session or workspace root not found' });
      return;
    }
    const { path: rel, content } = req.body as { path?: unknown; content?: unknown };
    if (typeof rel !== 'string' || typeof content !== 'string') {
      res.status(400).json({ error: 'path and content are required strings' });
      return;
    }
    const abs = resolveForWrite(root, rel);
    if (!abs) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      res.status(400).json({ error: 'Cannot write to a directory' });
      return;
    }
    writeFileSync(abs, content, 'utf8');
    res.json({ path: path.relative(root, abs) });
  });

  router.get('/sessions/:id/workspace/changes', async (req, res) => {
    const root = workspaceRoot(deps, req.params.id as SessionId);
    if (!root) {
      res.status(404).json({ error: 'Session or workspace root not found' });
      return;
    }
    try {
      res.json(await listChanges(root));
    } catch (err) {
      console.error('Failed to list workspace changes:', err);
      res.status(500).json({ error: 'Failed to list changes' });
    }
  });

  router.get('/sessions/:id/workspace/diff', async (req, res) => {
    const root = workspaceRoot(deps, req.params.id as SessionId);
    if (!root) {
      res.status(404).json({ error: 'Session or workspace root not found' });
      return;
    }
    const rel = typeof req.query.path === 'string' ? req.query.path : '';
    const abs = resolveExisting(root, rel);
    if (!abs) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
    const repoPath = findRepoForFile(root, abs);
    if (!repoPath) {
      res.status(404).json({ error: 'File is not inside a git repository' });
      return;
    }
    try {
      const diff = await diffFile(repoPath, path.relative(repoPath, abs));
      res.json({ diff });
    } catch (err) {
      console.error('Failed to diff workspace file:', err);
      res.status(500).json({ error: 'Failed to diff file' });
    }
  });

  return router;
}
