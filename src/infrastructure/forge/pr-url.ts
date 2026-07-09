import { findGiteaLogin } from './tea-config.js';

export type Forge = 'github' | 'gitea';

export interface ParsedPrUrl {
  owner: string;
  repo: string;
  number: number;
  host: string;
  forge: Forge;
}

/**
 * Parse a PR URL into its components. GitHub uses `/owner/repo/pull/N`,
 * Gitea/Forgejo `/owner/repo/pulls/N`; both forms are accepted for either host.
 * A non-github host only resolves when it matches a login in `tea`'s config —
 * otherwise we'd register monitors we have no credentials to poll.
 * Returns null when the URL isn't a PR link so callers can decline.
 */
export function parsePrUrl(url: string): ParsedPrUrl | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const isGithub = host === 'github.com' || host === 'www.github.com';
    if (!isGithub && !findGiteaLogin(host)) return null;

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 4) return null;
    const [owner, repo, kind, numberRaw] = segments;
    if (kind !== 'pull' && kind !== 'pulls') return null;
    const prNumber = Number.parseInt(numberRaw, 10);
    if (!Number.isFinite(prNumber) || prNumber <= 0) return null;
    return { owner, repo, number: prNumber, host, forge: isGithub ? 'github' : 'gitea' };
  } catch {
    return null;
  }
}
