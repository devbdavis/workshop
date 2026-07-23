/**
 * Minimal GitHub Issues client for the ticket-import feature.
 *
 * Uses the already-authenticated `gh` CLI (no API key setting) — same
 * exec/injection pattern as gh-adapter.ts and gh-review-adapter.ts.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface GithubIssue {
  /** Always "owner/repo#number" — the stable identifier used for storage/matching. */
  externalId: string;
  title: string;
  description: string | null;
  url: string;
  stateName: string;
  updatedAt?: string;
  repository?: string;
}

/** Distinguishes gh-not-authed/not-installed from other exec failures so routes can map them separately. */
export class GithubCliError extends Error {
  readonly code: number | 'ENOENT';

  constructor(message: string, code: number | 'ENOENT') {
    super(message);
    this.name = 'GithubCliError';
    this.code = code;
  }
}

export interface GithubIssuesClientOptions {
  /** Override for tests — defaults to the real `gh` binary on PATH. */
  ghBinary?: string;
  /** Override for tests — defaults to a real execFile. */
  exec?: (binary: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  /** Override for tests — defaults to 30s per call. */
  timeoutMs?: number;
}

interface ExecErrnoLike {
  code?: number | string;
  stderr?: string;
  message: string;
}

function defaultExec(timeoutMs: number): (binary: string, args: string[]) => Promise<{ stdout: string; stderr: string }> {
  return (binary, args) => execFileAsync(binary, args, { timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024 });
}

function wrapGhError(err: unknown): GithubCliError {
  const e = err as ExecErrnoLike;
  if (e.code === 'ENOENT') {
    return new GithubCliError('gh CLI not found on PATH. Install it: https://cli.github.com', 'ENOENT');
  }
  const exitCode = typeof e.code === 'number' ? e.code : 1;
  const stderr = e.stderr ?? e.message ?? '';
  if (stderr.toLowerCase().includes('auth login')) {
    return new GithubCliError('gh CLI not authenticated. Run `gh auth login`.', exitCode);
  }
  return new GithubCliError(stderr.trim() || e.message, exitCode);
}

interface GhSearchIssueNode {
  number?: number;
  title?: string;
  body?: string;
  repository?: { nameWithOwner?: string };
  url?: string;
  updatedAt?: string;
}

/**
 * List open issues assigned to the authenticated user, optionally scoped to
 * an org/user via `owner`. `gh search issues` excludes PRs by default.
 */
export async function listAssignedOpenIssues(
  owner?: string,
  opts: GithubIssuesClientOptions = {},
): Promise<GithubIssue[]> {
  const ghBinary = opts.ghBinary ?? 'gh';
  const exec = opts.exec ?? defaultExec(opts.timeoutMs ?? 30_000);

  const args = ['search', 'issues', '--assignee=@me', '--state=open'];
  if (owner && owner.trim().length > 0) {
    args.push('--owner', owner.trim());
  }
  args.push('--limit', '100', '--json', 'number,title,body,repository,url,updatedAt');

  let stdout: string;
  try {
    ({ stdout } = await exec(ghBinary, args));
  } catch (err) {
    throw wrapGhError(err);
  }

  const nodes = JSON.parse(stdout) as GhSearchIssueNode[];
  const out: GithubIssue[] = [];
  for (const node of nodes) {
    const nameWithOwner = node.repository?.nameWithOwner;
    if (!nameWithOwner || node.number === undefined) continue;
    out.push({
      externalId: `${nameWithOwner}#${node.number}`,
      title: node.title ?? '',
      description: node.body ?? null,
      url: node.url ?? '',
      stateName: 'open',
      updatedAt: node.updatedAt,
      repository: nameWithOwner,
    });
  }
  return out;
}

interface GhIssueViewJson {
  number?: number;
  title?: string;
  body?: string;
  url?: string;
  state?: string;
}

/** Parses "owner/repo#123" into its parts. Returns null for anything else. */
function parseIdentifier(identifier: string): { owner: string; repo: string; number: string } | null {
  const match = identifier.trim().match(/^(.+)\/(.+)#(\d+)$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: match[3] };
}

/**
 * Look up a single issue by "owner/repo#number". Returns null when the
 * identifier can't be parsed or gh reports the issue/repo doesn't resolve —
 * callers fall back to cached data rather than treating this as an error.
 */
export async function getIssueByIdentifier(
  identifier: string,
  opts: GithubIssuesClientOptions = {},
): Promise<GithubIssue | null> {
  const parsed = parseIdentifier(identifier);
  if (!parsed) return null;

  const ghBinary = opts.ghBinary ?? 'gh';
  const exec = opts.exec ?? defaultExec(opts.timeoutMs ?? 30_000);
  const repo = `${parsed.owner}/${parsed.repo}`;

  let stdout: string;
  try {
    ({ stdout } = await exec(ghBinary, [
      'issue',
      'view',
      parsed.number,
      '--repo',
      repo,
      '--json',
      'number,title,body,url,state',
    ]));
  } catch (err) {
    const wrapped = wrapGhError(err);
    // Match gh's "Could not resolve to an issue or pull request" (not-found) —
    // deliberately narrow so a DNS "could not resolve host" surfaces as a real error.
    if (wrapped.message.toLowerCase().includes('could not resolve to an issue')) return null;
    throw wrapped;
  }

  const raw = JSON.parse(stdout) as GhIssueViewJson;
  if (raw.number === undefined) return null;
  return {
    externalId: `${repo}#${raw.number}`,
    title: raw.title ?? '',
    description: raw.body ?? null,
    url: raw.url ?? '',
    stateName: (raw.state ?? 'open').toLowerCase(),
    repository: repo,
  };
}
