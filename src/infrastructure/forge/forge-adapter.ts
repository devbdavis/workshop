import type { GhAdapter, GhPrSnapshot } from '@infrastructure/github/gh-adapter';
import { createGhAdapter } from '@infrastructure/github/gh-adapter.js';
import type { DiscoveredPr, GhReviewAdapter, GhReviewSubmission } from '@infrastructure/github/gh-review-adapter';
import { createGhReviewAdapter } from '@infrastructure/github/gh-review-adapter.js';
import { createGiteaAdapter } from './gitea-adapter.js';
import { loadGiteaLogins } from './tea-config.js';
import { parsePrUrl } from './pr-url.js';

/** Review requests found this pass, plus the hosts that actually answered. */
export interface ReviewRequestDiscovery {
  prs: DiscoveredPr[];
  hosts: string[];
  /** Team-requested PRs no teammate has engaged with yet; undefined when the team search failed. */
  teamPrs?: DiscoveredPr[];
}

/** A forge we can inspect one PR at a time (GitHub or Gitea). */
interface PrSource {
  fetchPrSnapshot(prUrl: string): Promise<GhPrSnapshot>;
  fetchPrDiff(prUrl: string): Promise<string>;
  submitPrReview(prUrl: string, submission: GhReviewSubmission): Promise<void>;
  fetchCheckLog(prUrl: string, detailsUrl: string): Promise<string>;
}

export type ForgeAdapter = PrSource & {
  discoverReviewRequests(): Promise<ReviewRequestDiscovery>;
};

export interface CreateForgeAdapterOptions {
  github?: GhAdapter & GhReviewAdapter;
  gitea?: ForgeAdapter;
  /** Forwarded to the default GitHub adapter so PR-monitor comments from these
   *  author-login substrings are filtered out. Ignored when `github` is supplied. */
  getIgnoredCommentAuthors?: () => string[];
  /** GitHub `org/team` whose unanswered review requests are also discovered; read live each pass. */
  getReviewTeam?: () => string | undefined;
}

const GITHUB_HOST = 'github.com';

/**
 * One adapter over both forges. Per-PR calls route on the URL's host; discovery
 * unions results from `gh` and every configured `tea` login. A forge that is
 * unauthenticated or offline must not sink discovery for the other, so each
 * search is isolated and only answering hosts are reported back.
 */
export function createForgeAdapter(opts: CreateForgeAdapterOptions = {}): ForgeAdapter {
  const github =
    opts.github ??
    { ...createGhAdapter({ getIgnoredCommentAuthors: opts.getIgnoredCommentAuthors }), ...createGhReviewAdapter() };
  const gitea = opts.gitea ?? createGiteaAdapter();
  const giteaConfigured = opts.gitea !== undefined || loadGiteaLogins().length > 0;

  function pick(prUrl: string): PrSource {
    const parsed = parsePrUrl(prUrl);
    if (!parsed) throw new Error(`Invalid PR URL: ${prUrl}`);
    return parsed.forge === 'gitea' ? gitea : github;
  }

  return {
    fetchPrSnapshot(prUrl: string): Promise<GhPrSnapshot> {
      return pick(prUrl).fetchPrSnapshot(prUrl);
    },
    fetchPrDiff(prUrl: string): Promise<string> {
      return pick(prUrl).fetchPrDiff(prUrl);
    },
    submitPrReview(prUrl: string, submission: GhReviewSubmission): Promise<void> {
      return pick(prUrl).submitPrReview(prUrl, submission);
    },
    fetchCheckLog(prUrl: string, detailsUrl: string): Promise<string> {
      return pick(prUrl).fetchCheckLog(prUrl, detailsUrl);
    },

    async discoverReviewRequests(): Promise<ReviewRequestDiscovery> {
      const prs: DiscoveredPr[] = [];
      const hosts: string[] = [];

      try {
        prs.push(...(await github.searchReviewRequestedPrs()));
        hosts.push(GITHUB_HOST);
      } catch (err) {
        console.warn('[forge] GitHub PR discovery failed:', err instanceof Error ? err.message : err);
      }

      const team = opts.getReviewTeam?.();
      let teamPrs: DiscoveredPr[] | undefined = [];
      if (team) {
        try {
          teamPrs = await github.searchUnansweredTeamRequests(team);
        } catch (err) {
          teamPrs = undefined;
          console.warn('[forge] GitHub team review discovery failed:', err instanceof Error ? err.message : err);
        }
      }

      if (giteaConfigured) {
        try {
          const found = await gitea.discoverReviewRequests();
          prs.push(...found.prs);
          hosts.push(...found.hosts);
        } catch (err) {
          console.warn('[forge] Gitea PR discovery failed:', err instanceof Error ? err.message : err);
        }
      }

      return { prs, hosts, teamPrs };
    },
  };
}
