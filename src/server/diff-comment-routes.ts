import path from 'path';
import { Router } from 'express';
import type { DiffComment, DiffCommentId, SessionId } from '@foundation/types';
import type { SessionRepository } from '@domain/session/repository';
import type { TrackRepository } from '@domain/track/repository';
import type { DiffCommentRepository } from '@domain/diff-comment/repository';
import { findRepoForFile, diffFile } from '@infrastructure/git/workspace-git.js';
import { parseUnifiedDiff, relocateLine, extractHunkForLine } from '@foundation/diff-utils.js';
import type { DiffFile, ParsedDiff } from '@foundation/diff-utils.js';
import { workspaceRoot, resolveExisting, type WorkspaceRouterDeps } from './workspace-routes.js';

export interface DiffCommentRouterDeps {
  sessions: SessionRepository;
  tracks: TrackRepository;
  comments: DiffCommentRepository;
  terminal: {
    sendInput: (sessionId: SessionId, text: string) => Promise<boolean>;
  };
}

function firstDiffFile(parsed: ParsedDiff): DiffFile | undefined {
  return parsed.values().next().value;
}

/** Parses the current diff for `file` (workspace-root-relative), or null if it can't be read. */
async function diffFileEntry(root: string, file: string): Promise<DiffFile | undefined> {
  const abs = resolveExisting(root, file);
  if (!abs) return undefined;
  const repoPath = findRepoForFile(root, abs);
  if (!repoPath) return undefined;
  const diff = await diffFile(repoPath, path.relative(repoPath, abs));
  return firstDiffFile(parseUnifiedDiff(diff));
}

/**
 * Re-anchors every comment against the current diff of its file, persisting
 * line/anchored/codeContext changes. A file that errors or dropped out of the
 * diff leaves its comments' last known line+context but marks them unanchored.
 */
async function reanchorComments(
  deps: DiffCommentRouterDeps,
  root: string,
  existing: DiffComment[],
): Promise<DiffComment[]> {
  const files = [...new Set(existing.map((c) => c.file))];
  const entryByFile = new Map<string, DiffFile | undefined>();
  for (const file of files) {
    try {
      entryByFile.set(file, await diffFileEntry(root, file));
    } catch (err) {
      console.error(`Failed to re-anchor diff comments for ${file}:`, err);
      entryByFile.set(file, undefined);
    }
  }

  const patchedById = new Map<DiffCommentId, DiffComment>();
  for (const c of existing) {
    const entry = entryByFile.get(c.file);
    const newLine = relocateLine(entry, c.line, c.lineText);
    if (newLine === undefined) {
      if (c.anchored) {
        const patched = deps.comments.update(c.id, { anchored: false });
        if (patched) patchedById.set(c.id, patched);
      }
      continue;
    }
    const codeContext = entry ? extractHunkForLine(new Map([[entry.path, entry]]), entry.path, newLine) : undefined;
    if (newLine !== c.line || !c.anchored || codeContext !== c.codeContext) {
      const patched = deps.comments.update(c.id, { line: newLine, anchored: true, codeContext });
      if (patched) patchedById.set(c.id, patched);
    }
  }

  return existing.map((c) => patchedById.get(c.id) ?? c);
}

export function buildDiffCommentsPrompt(comments: DiffComment[]): string {
  const lines: string[] = [
    `Review notes on your working-tree changes — address all ${comments.length} in one pass:`,
    '',
  ];
  comments.forEach((c, i) => {
    const previously = c.sentAt ? ' (still open from a previous pass)' : '';
    lines.push(`${i + 1}. ${c.file}:${c.line}${previously}`);
    if (c.anchored) {
      lines.push(`   > ${c.lineText}`);
    } else {
      lines.push(`   (line since changed or removed — it read:) ${c.lineText}`);
    }
    lines.push('');
    lines.push(c.body);
    lines.push('');
  });
  lines.push(`When done, reply briefly with what you changed for each note.`);
  return lines.join('\n');
}

export function createDiffCommentRouter(deps: DiffCommentRouterDeps): Router {
  const router = Router();
  const { comments } = deps;
  const wsDeps: WorkspaceRouterDeps = { sessions: deps.sessions, tracks: deps.tracks };

  router.get('/sessions/:id/diff-comments', async (req, res) => {
    const sessionId = req.params.id as SessionId;
    const root = workspaceRoot(wsDeps, sessionId);
    if (!root) {
      res.status(404).json({ error: 'Session or workspace root not found' });
      return;
    }
    const existing = comments.findBySession(sessionId);
    const reanchored = await reanchorComments(deps, root, existing);
    res.json(reanchored);
  });

  router.post('/sessions/:id/diff-comments', async (req, res) => {
    const sessionId = req.params.id as SessionId;
    const root = workspaceRoot(wsDeps, sessionId);
    if (!root) {
      res.status(404).json({ error: 'Session or workspace root not found' });
      return;
    }
    const { file, line, body } = (req.body ?? {}) as { file?: unknown; line?: unknown; body?: unknown };
    if (typeof file !== 'string' || !resolveExisting(root, file)) {
      res.status(400).json({ error: 'file must be a path inside the workspace' });
      return;
    }
    if (typeof line !== 'number' || !Number.isInteger(line)) {
      res.status(400).json({ error: 'line must be an integer' });
      return;
    }
    const trimmedBody = typeof body === 'string' ? body.trim() : '';
    if (trimmedBody.length === 0) {
      res.status(400).json({ error: 'body must be a non-empty string' });
      return;
    }

    let entry: DiffFile | undefined;
    try {
      entry = await diffFileEntry(root, file);
    } catch (err) {
      console.error(`Failed to diff ${file} for a new comment:`, err);
      res.status(500).json({ error: 'Failed to diff file' });
      return;
    }
    const lineText = entry?.rightText.get(line);
    if (!entry || lineText === undefined) {
      res.status(400).json({ error: 'line is not part of the current diff' });
      return;
    }

    const codeContext = extractHunkForLine(new Map([[entry.path, entry]]), entry.path, line);
    const created = comments.create({ sessionId, file, line, lineText, body: trimmedBody, codeContext });
    res.status(201).json(created);
  });

  router.patch('/diff-comments/:id', (req, res) => {
    const { body, status } = (req.body ?? {}) as { body?: unknown; status?: unknown };
    if (status !== undefined && status !== 'open' && status !== 'resolved') {
      res.status(400).json({ error: 'status must be open or resolved' });
      return;
    }
    let trimmedBody: string | undefined;
    if (body !== undefined) {
      trimmedBody = typeof body === 'string' ? body.trim() : '';
      if (trimmedBody.length === 0) {
        res.status(400).json({ error: 'body must be a non-empty string' });
        return;
      }
    }
    const updated = comments.update(req.params.id as DiffCommentId, { body: trimmedBody, status });
    if (!updated) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }
    res.json(updated);
  });

  router.delete('/diff-comments/:id', (req, res) => {
    comments.delete(req.params.id as DiffCommentId);
    res.status(204).end();
  });

  router.post('/sessions/:id/diff-comments/send', async (req, res) => {
    const sessionId = req.params.id as SessionId;
    const root = workspaceRoot(wsDeps, sessionId);
    if (!root) {
      res.status(404).json({ error: 'Session or workspace root not found' });
      return;
    }
    const existing = comments.findBySession(sessionId);
    const reanchored = await reanchorComments(deps, root, existing);
    const open = reanchored.filter((c) => c.status === 'open');
    if (open.length === 0) {
      res.status(400).json({ error: 'No open comments to send' });
      return;
    }

    const ok = await deps.terminal.sendInput(sessionId, buildDiffCommentsPrompt(open));
    if (!ok) {
      res.status(409).json({ error: 'Session is not running' });
      return;
    }

    const now = new Date().toISOString();
    for (const c of open) comments.update(c.id, { sentAt: now });
    res.json({ sent: open.length });
  });

  return router;
}
