import { Router } from 'express';
import { execSync } from 'child_process';
import { homedir } from 'os';
import path from 'path';
import { readdirSync, statSync, existsSync } from 'fs';
import type { GlobalRepoId, SessionProvider } from '@foundation/types';
import { parseDefaultAiCli, isDefaultAiCli } from '@foundation/types.js';
import {
  CLI_REGISTRY,
  AGENT_IDS,
  DEFAULT_AVAILABLE_AGENTS,
  getCliDescriptor,
} from '@foundation/cli-registry.js';
import type { GlobalRepoRepository, SettingsRepository } from '@domain/repo/repository';
import {
  detectAvailability,
  hasCli,
  isEditorChoice,
  isTerminalChoice,
  parseEditorChoice,
  parseTerminalChoice,
  resolveEditor,
  resolveTerminal,
} from '@infrastructure/launch/launch-apps.js';
import {
  startAuthTerminal,
  stopAuthTerminal,
} from '@infrastructure/terminal/auth-terminal.js';

/** Every agent CLI whose binary is present on this host. */
function installedAgents(): SessionProvider[] {
  return CLI_REGISTRY
    .filter((c) => c.kind === 'agent' && hasCli(c.binary))
    .map((c) => c.provider as SessionProvider);
}

/**
 * Read the stored list of enabled agents. Stored as a comma-joined string
 * under `available_clis`; filtered to valid agent ids. When the user has
 * never customised the list, every *installed* agent CLI is enabled — an
 * explicit Settings → Available CLIs save takes over from there.
 */
function parseAvailableAgents(raw: string | null): SessionProvider[] {
  if (!raw) {
    const installed = installedAgents();
    return installed.length > 0 ? installed : [...DEFAULT_AVAILABLE_AGENTS];
  }
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is SessionProvider => (AGENT_IDS as string[]).includes(s));
  return ids.length > 0 ? ids : [...DEFAULT_AVAILABLE_AGENTS];
}

/**
 * Author-login substrings hidden from the PR-monitor (outgoing PRs) comment
 * feed by default. Bots (and only bots, hopefully) match these; humans,
 * CodeRabbit, and Cursor/bugbot don't.
 */
export const DEFAULT_PR_MONITOR_IGNORED_AUTHORS: readonly string[] = [
  'trunk-io',
  'klaviyo-code-delivery',
  'spacelift',
  'wiz-inc',
  'linear-code',
];

/**
 * Read the stored ignored-comment-authors list. Stored as a JSON array string
 * under `pr_monitor_ignored_authors`; falls back to the default list when
 * unset or malformed. Shared by the settings route and the gh-adapter getter
 * so both agree on the same default.
 */
export function parsePrMonitorIgnoredAuthors(raw: string | null): string[] {
  if (!raw) return [...DEFAULT_PR_MONITOR_IGNORED_AUTHORS];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((entry): entry is string => typeof entry === 'string')) {
      return parsed;
    }
  } catch {
    // fall through to default
  }
  return [...DEFAULT_PR_MONITOR_IGNORED_AUTHORS];
}

/** Build the GET/PUT /settings/clis response payload. */
function buildClisPayload(available: SessionProvider[]) {
  const enabledSet = new Set<string>(available);
  const clis = CLI_REGISTRY.map((c) => ({
    id: c.id,
    label: c.label,
    kind: c.kind,
    provider: c.provider,
    installed: hasCli(c.binary),
    enabled: c.kind === 'agent' ? enabledSet.has(c.id) : true,
  }));
  return { clis, available };
}

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
      const repoRoot = settings.get('repo_root') || '~/Klaviyo/Repos';
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
    const value = settings.get('repo_root') || '~/Klaviyo/Repos';
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
  //
  // The Linear API key is reported as a boolean `linearApiKeyConfigured`
  // rather than echoed back verbatim — it's a credential, and the settings
  // page never needs to re-display it.

  router.get('/settings/issue-tracker', (_req, res) => {
    const tracker = settings.get('issue_tracker') ?? 'linear';
    const orgName = settings.get('issue_tracker_org') ?? '';
    const linearKey = settings.get('linear_api_key');
    res.json({
      tracker,
      orgName,
      linearApiKeyConfigured: !!(linearKey && linearKey.trim().length > 0),
    });
  });

  // --- Update issue tracker setting ---

  router.put('/settings/issue-tracker', (req, res) => {
    const { tracker, orgName, linearApiKey } = req.body as {
      tracker: unknown;
      orgName: unknown;
      linearApiKey: unknown;
    };
    if (!tracker || !['linear', 'jira', 'none'].includes(tracker as string)) {
      res.status(400).json({ error: 'tracker must be linear, jira, or none' });
      return;
    }
    settings.set('issue_tracker', tracker as string);
    settings.set('issue_tracker_org', typeof orgName === 'string' ? orgName : '');
    // Empty string clears the key; undefined/null leaves it unchanged so the UI
    // can save other fields without forcing the user to re-enter the secret.
    if (typeof linearApiKey === 'string') {
      settings.set('linear_api_key', linearApiKey.trim());
    }
    const currentKey = settings.get('linear_api_key');
    res.json({
      tracker,
      orgName: typeof orgName === 'string' ? orgName : '',
      linearApiKeyConfigured: !!(currentKey && currentKey.trim().length > 0),
    });
  });

  router.get('/settings/default-ai-cli', (_req, res) => {
    const provider = parseDefaultAiCli(settings.get('default_ai_cli'));
    res.json({ provider });
  });

  router.put('/settings/default-ai-cli', (req, res) => {
    const { provider } = req.body as { provider: unknown };
    if (!isDefaultAiCli(provider)) {
      res.status(400).json({ error: 'provider must be one of: claude, codex, gemini, cursor' });
      return;
    }
    settings.set('default_ai_cli', provider);
    res.json({ provider });
  });

  // Which model dispatched (orchestrator) sessions run on. Applies to claude
  // sessions via `--model`; other providers ignore it. Unset defaults to
  // "opus"; an explicit empty string disables the flag entirely.
  router.get('/settings/dispatch-model', (_req, res) => {
    res.json({ model: settings.get('dispatch_model') ?? 'opus' });
  });

  router.put('/settings/dispatch-model', (req, res) => {
    const { model } = req.body as { model: unknown };
    if (typeof model !== 'string') {
      res.status(400).json({ error: 'model must be a string' });
      return;
    }
    settings.set('dispatch_model', model.trim());
    res.json({ model: model.trim() });
  });

  // Author-login substrings hidden from the PR-monitor (outgoing PRs) comment
  // feed. Case-insensitive substring match; see parsePrMonitorIgnoredAuthors
  // for the default list and storage format.
  router.get('/settings/pr-monitor-ignored-authors', (_req, res) => {
    res.json({ authors: parsePrMonitorIgnoredAuthors(settings.get('pr_monitor_ignored_authors')) });
  });

  router.put('/settings/pr-monitor-ignored-authors', (req, res) => {
    const { authors } = req.body as { authors: unknown };
    if (!Array.isArray(authors) || !authors.every((a) => typeof a === 'string')) {
      res.status(400).json({ error: 'authors must be an array of strings' });
      return;
    }
    const cleaned = authors.map((a) => a.trim()).filter((a) => a.length > 0);
    settings.set('pr_monitor_ignored_authors', JSON.stringify(cleaned));
    res.json({ authors: cleaned });
  });

  // --- CLI availability + auth ---
  //
  // Reports every registered AI CLI / tool, whether its binary is installed on
  // this host, and (for agents) whether the user has enabled it. The enabled
  // set gates the New Session and Default AI CLI dropdowns.

  router.get('/settings/clis', (_req, res) => {
    const available = parseAvailableAgents(settings.get('available_clis'));
    res.json(buildClisPayload(available));
  });

  router.put('/settings/available-clis', (req, res) => {
    const { available } = req.body as { available: unknown };
    if (!Array.isArray(available)) {
      res.status(400).json({ error: 'available must be an array of agent ids' });
      return;
    }
    const valid = available.filter(
      (id): id is SessionProvider => typeof id === 'string' && (AGENT_IDS as string[]).includes(id),
    );
    settings.set('available_clis', valid.join(','));
    res.json(buildClisPayload(valid));
  });

  // Start an interactive auth terminal for a CLI/tool. Returns an authId the
  // client uses to open a WebSocket terminal (/ws/auth/:authId/terminal).
  router.post('/auth/cli/:id', async (req, res) => {
    const descriptor = getCliDescriptor(req.params.id);
    if (!descriptor) {
      res.status(400).json({ error: `Unknown CLI: ${req.params.id}` });
      return;
    }
    try {
      const { authId } = await startAuthTerminal(descriptor.loginCommand);
      res.json({ authId });
    } catch (err) {
      console.error(`Failed to start auth terminal for ${descriptor.id}:`, err);
      res.status(500).json({ error: 'Failed to start auth terminal' });
    }
  });

  // Tear down an auth terminal (kills its tmux session). Idempotent.
  router.delete('/auth/cli/:authId', (req, res) => {
    stopAuthTerminal(req.params.authId);
    res.status(204).send();
  });

  // --- Launch apps (editor / terminal) ---
  //
  // Reports both the user's preferences and what's actually available on this
  // host so the UI can label "Auto → Cursor" or warn when a saved choice is
  // missing (e.g. the user picked Konsole then moved to a machine without it).

  router.get('/settings/launch-apps', (_req, res) => {
    const availability = detectAvailability();
    const editor = parseEditorChoice(settings.get('launch_editor'));
    const terminal = parseTerminalChoice(settings.get('launch_terminal'));
    res.json({
      editor,
      terminal,
      resolvedEditor: resolveEditor(editor, availability),
      resolvedTerminal: resolveTerminal(terminal, availability),
      availability,
    });
  });

  router.put('/settings/launch-apps', (req, res) => {
    const { editor, terminal } = req.body as { editor?: unknown; terminal?: unknown };
    if (editor !== undefined) {
      if (!isEditorChoice(editor)) {
        res.status(400).json({ error: 'editor must be one of: auto, cursor, code' });
        return;
      }
      settings.set('launch_editor', editor);
    }
    if (terminal !== undefined) {
      if (!isTerminalChoice(terminal)) {
        res.status(400).json({ error: 'terminal must be one of: auto, iterm, konsole, gnome-terminal, wt' });
        return;
      }
      settings.set('launch_terminal', terminal);
    }
    const availability = detectAvailability();
    const savedEditor = parseEditorChoice(settings.get('launch_editor'));
    const savedTerminal = parseTerminalChoice(settings.get('launch_terminal'));
    res.json({
      editor: savedEditor,
      terminal: savedTerminal,
      resolvedEditor: resolveEditor(savedEditor, availability),
      resolvedTerminal: resolveTerminal(savedTerminal, availability),
      availability,
    });
  });

  return router;
}
