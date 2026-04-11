import { Router } from 'express';
import { execSync } from 'child_process';
import { homedir } from 'os';
import path from 'path';
import { readdirSync, statSync, existsSync } from 'fs';
import type { GlobalRepoId } from '@foundation/types';
import type { GlobalRepoRepository, SettingsRepository } from '@domain/repo/repository';

export interface RepoRouterDeps {
  repos: GlobalRepoRepository;
  settings: SettingsRepository;
}

function detectMainBranch(repoPath: string): 'main' | 'master' {
  try {
    const result = execSync(`git -C "${repoPath}" symbolic-ref --short HEAD 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    if (result === 'main' || result === 'master') return result;
  } catch {
    // fall through
  }
  // Try listing branches
  try {
    const result = execSync(`git -C "${repoPath}" branch --list main master 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    if (result.includes('main')) return 'main';
    if (result.includes('master')) return 'master';
  } catch {
    // fall through
  }
  return 'main';
}

function expandHome(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(homedir(), p.slice(2));
  }
  return p;
}

export function createRepoRouter(deps: RepoRouterDeps): Router {
  const router = Router();
  const { repos, settings } = deps;

  // --- List global repos ---

  router.get('/repos', (_req, res) => {
    res.json(repos.findAll());
  });

  // --- Suggestions: subfolders of repo_root ---
  // Must be before /repos/:id to avoid matching 'suggestions' as an id

  router.get('/repos/suggestions', (_req, res) => {
    try {
      const repoRoot = settings.get('repo_root') || '~/repos';
      const expanded = expandHome(repoRoot);
      if (!existsSync(expanded)) {
        res.json([]);
        return;
      }
      const entries = readdirSync(expanded);
      const folders = entries.filter((entry) => {
        try {
          return statSync(path.join(expanded, entry)).isDirectory();
        } catch {
          return false;
        }
      });
      res.json(folders);
    } catch (err) {
      console.error('Failed to list repo suggestions:', err);
      res.json([]);
    }
  });

  // --- Create global repo ---

  router.post('/repos', (req, res) => {
    const { path: repoPath } = req.body;
    if (!repoPath || typeof repoPath !== 'string') {
      res.status(400).json({ error: 'path is required' });
      return;
    }

    const expanded = expandHome(repoPath);

    // Check for existing repo at this path
    const existing = repos.findByPath(expanded);
    if (existing) {
      res.status(409).json({ error: 'Repo already exists at this path', repo: existing });
      return;
    }

    const name = path.basename(expanded);
    const mainBranch = detectMainBranch(expanded);
    const repo = repos.create({ path: expanded, name, mainBranch });
    res.status(201).json(repo);
  });

  // --- Delete global repo ---

  router.delete('/repos/:id', (req, res) => {
    const id = req.params.id as GlobalRepoId;
    const deleted = repos.delete(id);
    if (!deleted) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    res.status(204).send();
  });

  // --- Get repo root setting ---

  router.get('/settings/repo-root', (_req, res) => {
    const value = settings.get('repo_root') || '~/repos';
    res.json({ value });
  });

  // --- Update repo root setting ---

  router.put('/settings/repo-root', (req, res) => {
    const { value } = req.body;
    if (!value || typeof value !== 'string') {
      res.status(400).json({ error: 'value is required' });
      return;
    }
    settings.set('repo_root', value);
    res.json({ value });
  });

  // --- Get issue tracker setting ---

  router.get('/settings/issue-tracker', (_req, res) => {
    const tracker = settings.get('issue_tracker') ?? 'linear';
    const orgName = settings.get('issue_tracker_org') ?? '';
    res.json({ tracker, orgName });
  });

  // --- Update issue tracker setting ---

  router.put('/settings/issue-tracker', (req, res) => {
    const { tracker, orgName } = req.body as { tracker: unknown; orgName: unknown };
    if (!tracker || !['linear', 'jira', 'none'].includes(tracker as string)) {
      res.status(400).json({ error: 'tracker must be linear, jira, or none' });
      return;
    }
    settings.set('issue_tracker', tracker as string);
    settings.set('issue_tracker_org', typeof orgName === 'string' ? orgName : '');
    res.json({ tracker, orgName: typeof orgName === 'string' ? orgName : '' });
  });

  return router;
}
