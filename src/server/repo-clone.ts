/**
 * Pure URL → clone-target resolution and command building.
 *
 * Kept free of I/O so the parsing/validation rules can be unit-tested without
 * shelling out. The route layer composes these with filesystem + execFile.
 */

export interface CloneTarget {
  provider: 'github' | 'other';
  host: string;
  owner: string;
  repo: string;
}

// Component charset for host/owner/repo. Restricting to this set is what makes
// it safe to interpolate these values into `gh`/`tea` argv positions later.
const COMPONENT = /^[A-Za-z0-9._-]+$/;

function stripGitSuffix(repo: string): string {
  return repo.endsWith('.git') ? repo.slice(0, -'.git'.length) : repo;
}

function isValidComponent(value: string): boolean {
  if (!COMPONENT.test(value)) return false;
  // A leading '-' would be parsed as a flag by the CLIs; a leading '.' invites
  // path traversal ('.' / '..'). Disallow both for owner/repo/host alike.
  return !value.startsWith('-') && !value.startsWith('.');
}

/**
 * Parse and normalize a repository URL into a {@link CloneTarget}.
 *
 * Accepts https URLs (with optional `.git`, trailing `/` or `#`) and SSH form
 * (`git@host:owner/repo.git`). Throws on anything else or on a missing/invalid
 * host, owner, or repo.
 */
export function resolveCloneTarget(url: string): CloneTarget {
  const raw = url.trim();
  if (raw.length === 0) throw new Error('Invalid repository URL');

  const { host, owner, repo } = parseParts(raw);
  const cleanRepo = stripGitSuffix(repo);

  if (!isValidComponent(host) || !isValidComponent(owner) || !isValidComponent(cleanRepo)) {
    throw new Error('Invalid repository URL');
  }

  const provider = host.toLowerCase() === 'github.com' ? 'github' : 'other';
  return { provider, host, owner, repo: cleanRepo };
}

function parseParts(raw: string): { host: string; owner: string; repo: string } {
  // SSH form: git@host:owner/repo(.git)
  const sshMatch = /^git@([^:]+):(.+)$/.exec(raw);
  if (sshMatch) {
    const host = sshMatch[1];
    const [owner, repo] = splitOwnerRepo(sshMatch[2]);
    return { host, owner, repo };
  }

  // Drop a trailing '#...' fragment (e.g. a pasted '...workshop#') and any
  // trailing slashes before splitting into path segments.
  const withoutFragment = raw.split('#')[0];

  let parsed: URL;
  try {
    parsed = new URL(withoutFragment);
  } catch {
    throw new Error('Invalid repository URL');
  }

  const [owner, repo] = splitOwnerRepo(parsed.pathname);
  return { host: parsed.host, owner, repo };
}

function splitOwnerRepo(pathish: string): [string, string] {
  const segments = pathish.split('/').filter((s) => s.length > 0);
  if (segments.length < 2) throw new Error('Invalid repository URL');
  // Take the first two segments; a deeper path (e.g. GitLab subgroups) is not
  // supported by the `owner/repo` clone forms of either CLI.
  return [segments[0], segments[1]];
}

/**
 * Build the argv for the provider-appropriate clone CLI. Always returns an
 * arg array (never a shell string) so user-supplied components cannot inject.
 */
export function buildCloneCommand(
  target: CloneTarget,
  destDir: string,
): { cmd: string; args: string[] } {
  if (target.provider === 'github') {
    return { cmd: 'gh', args: ['repo', 'clone', `${target.owner}/${target.repo}`, destDir] };
  }
  return {
    cmd: 'tea',
    args: ['clone', `${target.host}/${target.owner}/${target.repo}`, destDir],
  };
}
