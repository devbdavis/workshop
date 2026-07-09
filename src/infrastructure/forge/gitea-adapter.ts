import type { PrCheckStatus, PrCheckSummary, PrComment, PrState } from '@foundation/types';
import {
  CHECK_SUMMARY_MAX,
  COMMENT_BODY_MAX,
  PR_BODY_MAX_LENGTH,
  clampString,
  type GhPrSnapshot,
} from '@infrastructure/github/gh-adapter.js';
import { clampPrBody, type DiscoveredPr, type GhReviewSubmission } from '@infrastructure/github/gh-review-adapter.js';
import type { GiteaLogin } from './tea-config.js';
import { loadGiteaLogins } from './tea-config.js';
import { parsePrUrl } from './pr-url.js';

const TIMEOUT_MS = 30_000;

/** Gitea's review event names happen to match GitHub's. */
const VERDICT_TO_EVENT = {
  approve: 'APPROVED',
  request_changes: 'REQUEST_CHANGES',
  comment: 'COMMENT',
} as const;

interface GiteaUser { login?: string }
interface GiteaPull {
  title?: string;
  body?: string;
  user?: GiteaUser;
  state?: string;
  draft?: boolean;
  merged?: boolean;
  head?: { ref?: string; sha?: string };
}
interface GiteaStatus { status?: string; context?: string; description?: string; target_url?: string }
interface GiteaCombinedStatus { state?: string; statuses?: GiteaStatus[] }
interface GiteaComment { id?: number; user?: GiteaUser; body?: string; created_at?: string; html_url?: string }
interface GiteaReview { id?: number; user?: GiteaUser; body?: string; state?: string; submitted_at?: string; html_url?: string; comments_count?: number }
interface GiteaReviewComment extends GiteaComment { path?: string; position?: number; original_position?: number; resolver?: GiteaUser | null }
interface GiteaSearchIssue {
  html_url?: string;
  title?: string;
  body?: string;
  number?: number;
  updated_at?: string;
  user?: GiteaUser;
  repository?: { owner?: string; name?: string; full_name?: string };
}

export type GiteaFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface CreateGiteaAdapterOptions {
  logins?: GiteaLogin[];
  /** Override for tests — defaults to global fetch. */
  fetchImpl?: GiteaFetch;
}

function deriveState(pull: GiteaPull): PrState {
  if (pull.merged) return 'merged';
  if (pull.state === 'closed') return 'closed';
  if (pull.draft) return 'draft';
  if (pull.state === 'open') return 'open';
  return 'unknown';
}

function deriveChecks(combined: GiteaCombinedStatus | null, origin: string): { status: PrCheckStatus; failing: PrCheckSummary[] } {
  const statuses = combined?.statuses ?? [];
  if (statuses.length === 0) return { status: 'none', failing: [] };

  const failing: PrCheckSummary[] = [];
  let sawPending = false;
  let sawFailure = false;
  let sawError = false;

  for (const s of statuses) {
    const state = (s.status ?? '').toLowerCase();
    if (state === 'pending' || state === 'running') sawPending = true;
    // `warning` is Gitea's soft failure — surfacing it as passing would hide it.
    if (state !== 'failure' && state !== 'error' && state !== 'warning') continue;
    if (state === 'failure') sawFailure = true;
    else sawError = true;
    failing.push({
      name: s.context ?? 'check',
      conclusion: s.status,
      status: s.status,
      // Gitea returns site-relative target_urls for its own Actions runs.
      detailsUrl: s.target_url?.startsWith('/') ? `${origin}${s.target_url}` : s.target_url || undefined,
      summary: clampString(s.description, CHECK_SUMMARY_MAX),
    });
  }

  if (sawFailure) return { status: 'failing', failing };
  if (sawError) return { status: 'error', failing };
  if (sawPending) return { status: 'pending', failing: [] };
  return { status: 'passing', failing: [] };
}

export function createGiteaAdapter(opts: CreateGiteaAdapterOptions = {}) {
  const logins = opts.logins ?? loadGiteaLogins();
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as GiteaFetch);

  function loginFor(host: string): GiteaLogin {
    const login = logins.find((l) => l.host === host);
    if (!login) throw new Error(`No tea login configured for ${host}`);
    return login;
  }

  async function call(login: GiteaLogin, path: string, init?: { method?: string; body?: unknown; raw?: boolean }): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${login.url}/api/v1${path}`, {
        method: init?.method ?? 'GET',
        headers: {
          Authorization: `token ${login.token}`,
          Accept: init?.raw ? 'text/plain' : 'application/json',
          ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Gitea ${init?.method ?? 'GET'} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
      if (init?.raw) return text;
      return text.length > 0 ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Best-effort GET — Gitea 404s endpoints that simply have no data yet. */
  async function tryCall<T>(login: GiteaLogin, path: string): Promise<T | null> {
    try {
      return (await call(login, path)) as T;
    } catch {
      return null;
    }
  }

  async function fetchComments(login: GiteaLogin, base: string, index: number): Promise<PrComment[]> {
    const out: PrComment[] = [];
    const issueComments = (await tryCall<GiteaComment[]>(login, `${base}/issues/${index}/comments`)) ?? [];
    for (const c of issueComments) {
      if (c.id === undefined) continue;
      out.push({
        id: String(c.id),
        author: c.user?.login ?? 'unknown',
        body: clampString(c.body, COMMENT_BODY_MAX) ?? '',
        createdAt: c.created_at ?? new Date().toISOString(),
        url: c.html_url,
        kind: 'issue',
      });
    }

    const reviews = (await tryCall<GiteaReview[]>(login, `${base}/pulls/${index}/reviews`)) ?? [];
    for (const review of reviews) {
      if (review.id === undefined || review.state === 'PENDING') continue;
      const comments = (await tryCall<GiteaReviewComment[]>(login, `${base}/pulls/${index}/reviews/${review.id}/comments`)) ?? [];
      // Mirror the GitHub adapter: a review's summary body is noise when it also
      // carries inline threads, and approvals carry nothing to act on.
      if (comments.length === 0 && review.body?.trim() && review.state !== 'APPROVED') {
        out.push({
          id: String(review.id),
          author: review.user?.login ?? 'unknown',
          body: clampString(review.body, COMMENT_BODY_MAX) ?? '',
          createdAt: review.submitted_at ?? new Date().toISOString(),
          url: review.html_url,
          kind: 'review',
        });
      }
      for (const rc of comments) {
        if (rc.id === undefined || rc.resolver) continue;
        out.push({
          id: `rc-${rc.id}`,
          author: rc.user?.login ?? 'unknown',
          body: clampString(rc.body, COMMENT_BODY_MAX) ?? '',
          createdAt: rc.created_at ?? new Date().toISOString(),
          url: rc.html_url,
          kind: 'review',
          path: rc.path,
          line: rc.position ?? rc.original_position,
        });
      }
    }
    return out;
  }

  return {
    async fetchPrSnapshot(prUrl: string): Promise<GhPrSnapshot> {
      const parsed = parsePrUrl(prUrl);
      if (!parsed) throw new Error(`Invalid PR URL: ${prUrl}`);
      const login = loginFor(parsed.host);
      const base = `/repos/${parsed.owner}/${parsed.repo}`;

      const pull = (await call(login, `${base}/pulls/${parsed.number}`)) as GiteaPull;
      const state = deriveState(pull);
      const finished = state === 'merged' || state === 'closed';

      const sha = pull.head?.sha;
      const combined = !finished && sha ? await tryCall<GiteaCombinedStatus>(login, `${base}/commits/${sha}/status`) : null;
      const checks = deriveChecks(combined, login.url);

      return {
        state,
        checkStatus: finished ? 'none' : checks.status,
        failingChecks: finished ? [] : checks.failing,
        unresolvedComments: finished ? [] : await fetchComments(login, base, parsed.number),
        prTitle: pull.title,
        prAuthor: pull.user?.login,
        prBody: clampString(pull.body, PR_BODY_MAX_LENGTH),
        headRefName: pull.head?.ref,
        headRefOid: sha,
        isDraft: !!pull.draft,
        finished,
      };
    },

    async fetchPrDiff(prUrl: string): Promise<string> {
      const parsed = parsePrUrl(prUrl);
      if (!parsed) throw new Error(`Invalid PR URL: ${prUrl}`);
      const login = loginFor(parsed.host);
      return (await call(login, `/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}.diff`, { raw: true })) as string;
    },

    async submitPrReview(prUrl: string, submission: GhReviewSubmission): Promise<void> {
      const parsed = parsePrUrl(prUrl);
      if (!parsed) throw new Error(`Invalid PR URL: ${prUrl}`);
      const login = loginFor(parsed.host);
      await call(login, `/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}/reviews`, {
        method: 'POST',
        body: {
          body: submission.body,
          event: VERDICT_TO_EVENT[submission.verdict],
          // Gitea anchors inline comments by side-specific line number rather
          // than GitHub's `line` + `side` pair.
          comments: submission.comments.map((c) => ({
            path: c.path,
            body: c.body,
            ...(c.side === 'LEFT' ? { old_position: c.line } : { new_position: c.line }),
          })),
        },
      });
    },

    /**
     * Open PRs across every configured Gitea login where our review is requested.
     * `hosts` lists the logins that actually answered — the discovery poller may
     * only prune rows belonging to a host it successfully searched.
     */
    async discoverReviewRequests(): Promise<{ prs: DiscoveredPr[]; hosts: string[] }> {
      const prs: DiscoveredPr[] = [];
      const hosts: string[] = [];
      for (const login of logins) {
        let issues: GiteaSearchIssue[];
        try {
          issues = (await call(login, '/repos/issues/search?type=pulls&state=open&review_requested=true&limit=50')) as GiteaSearchIssue[];
        } catch (err) {
          console.warn(`[gitea] PR discovery failed for ${login.host}:`, err instanceof Error ? err.message : err);
          continue;
        }
        hosts.push(login.host);
        for (const issue of issues ?? []) {
          if (!issue.html_url || !issue.number) continue;
          const fullName = issue.repository?.full_name ?? '';
          const [owner, name] = fullName.includes('/')
            ? fullName.split('/')
            : [issue.repository?.owner ?? '', issue.repository?.name ?? ''];
          prs.push({
            url: issue.html_url,
            title: issue.title ?? '',
            author: issue.user?.login ?? 'unknown',
            repoOwner: owner,
            repoName: name,
            number: issue.number,
            body: clampPrBody(issue.body),
            updatedAt: issue.updated_at,
          });
        }
      }
      return { prs, hosts };
    },
  };
}
