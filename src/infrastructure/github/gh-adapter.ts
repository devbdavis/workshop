import { execFile } from 'child_process';
import { promisify } from 'util';
import type { PrCheckStatus, PrCheckSummary, PrComment, PrState } from '@foundation/types';
import { parsePrUrl } from '@infrastructure/forge/pr-url.js';
import { stripHtmlNoise } from '@foundation/strip-html.js';

const execFileAsync = promisify(execFile);

export interface GhPrSnapshot {
  state: PrState;
  checkStatus: PrCheckStatus;
  failingChecks: PrCheckSummary[];
  unresolvedComments: PrComment[];
  prTitle?: string;
  /** PR author login — used by the PR review dashboard on manual add. */
  prAuthor?: string;
  /** PR description (markdown, clamped) — used by the PR review dashboard on manual add. */
  prBody?: string;
  headRefName?: string;
  /** SHA of the PR head commit — used by the poller to detect fresh pushes. */
  headRefOid?: string;
  isDraft: boolean;
  /** True when the PR has been merged or hard-closed and the poller should stop. */
  finished: boolean;
}

/** Maximum body length we cache per comment — UI shows a truncated preview anyway. */
export const COMMENT_BODY_MAX = 1200;
/** Maximum length of a check summary blob — kept short so the DB row stays small. */
export const CHECK_SUMMARY_MAX = 400;
/** Maximum stored PR description length (PR review dashboard). */
export const PR_BODY_MAX_LENGTH = 5_000;

export function clampString(value: string | null | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

interface GhCheckRollupNode {
  // From `--json statusCheckRollup`: checks come back as an array of mixed objects.
  // We narrow conservatively because the shape varies (CheckRun vs StatusContext).
  __typename?: string;
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string;
  state?: string;
  detailsUrl?: string;
  targetUrl?: string;
  description?: string;
  workflowName?: string;
}

interface GhReviewNode {
  id?: string;
  author?: { login?: string };
  body?: string;
  createdAt?: string;
  url?: string;
  state?: string;
}

interface GhPrJson {
  state?: string;
  isDraft?: boolean;
  title?: string;
  body?: string;
  author?: { login?: string };
  headRefName?: string;
  headRefOid?: string;
  mergedAt?: string | null;
  closed?: boolean;
  statusCheckRollup?: GhCheckRollupNode[];
  reviews?: GhReviewNode[];
}

/** A single inline review comment from the `gh api graphql` reviewThreads query. */
interface GhGraphqlInlineComment {
  id?: string;
  author?: { login?: string };
  body?: string;
  createdAt?: string;
  url?: string;
  path?: string;
  line?: number | null;
  originalLine?: number | null;
}

/** Shape of the `gh api graphql` reviewThreads response. */
interface GhReviewThreadsResponse {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          nodes?: Array<{
            isResolved?: boolean;
            comments?: { nodes?: GhGraphqlInlineComment[] };
          }>;
        };
      };
    };
  };
}

function deriveState(raw: GhPrJson): PrState {
  if (raw.mergedAt) return 'merged';
  if (raw.state === 'MERGED') return 'merged';
  if (raw.state === 'CLOSED') return 'closed';
  if (raw.isDraft) return 'draft';
  if (raw.state === 'OPEN') return 'open';
  return 'unknown';
}

function deriveCheckStatus(rollup: GhCheckRollupNode[] | undefined): { status: PrCheckStatus; failing: PrCheckSummary[] } {
  if (!rollup || rollup.length === 0) {
    return { status: 'none', failing: [] };
  }

  let sawFailure = false;
  let sawError = false;
  let sawPending = false;
  const failing: PrCheckSummary[] = [];

  for (const node of rollup) {
    const name = node.name ?? node.context ?? node.workflowName ?? 'check';
    const status = (node.status ?? '').toUpperCase();
    const conclusion = (node.conclusion ?? '').toUpperCase();
    // StatusContext objects use `state` instead of conclusion.
    const contextState = (node.state ?? '').toUpperCase();

    const isInProgress =
      status === 'QUEUED' || status === 'IN_PROGRESS' || status === 'PENDING' || contextState === 'PENDING';
    const isFailure =
      conclusion === 'FAILURE' ||
      conclusion === 'TIMED_OUT' ||
      conclusion === 'STARTUP_FAILURE' ||
      contextState === 'FAILURE' ||
      contextState === 'ERROR';
    const isErrorish =
      conclusion === 'ACTION_REQUIRED' || conclusion === 'STALE' || conclusion === 'CANCELLED';

    if (isInProgress) sawPending = true;
    if (isFailure) {
      sawFailure = true;
      failing.push({
        name,
        conclusion: node.conclusion ?? node.state ?? undefined,
        status: node.status ?? undefined,
        detailsUrl: node.detailsUrl ?? node.targetUrl ?? undefined,
        summary: clampString(node.description ?? null, CHECK_SUMMARY_MAX),
      });
    } else if (isErrorish && !sawFailure) {
      sawError = true;
      failing.push({
        name,
        conclusion: node.conclusion ?? undefined,
        status: node.status ?? undefined,
        detailsUrl: node.detailsUrl ?? node.targetUrl ?? undefined,
        summary: clampString(node.description ?? null, CHECK_SUMMARY_MAX),
      });
    }
  }

  if (sawFailure) return { status: 'failing', failing };
  if (sawError) return { status: 'error', failing };
  if (sawPending) return { status: 'pending', failing: [] };
  return { status: 'passing', failing: [] };
}

/**
 * `gh` reports every comment author as a bare `{ login }` with no bot flag —
 * bots (trunk-io, wiz-inc, etc.) are indistinguishable from humans except by
 * login string. Filtering is
 * therefore a case-insensitive substring match against the caller-supplied
 * ignore list rather than any bot-detection heuristic.
 */
function isIgnoredAuthor(login: string, ignoredAuthors: readonly string[]): boolean {
  const lowerLogin = login.toLowerCase();
  return ignoredAuthors.some((substr) => substr.length > 0 && lowerLogin.includes(substr.toLowerCase()));
}

/**
 * Extract the unresolved inline review comments from a `gh api graphql`
 * reviewThreads response. Inline comments are NOT returned by `gh pr view`, so
 * they're fetched separately. We surface the root comment of each *unresolved*
 * thread — replies are usually the PR author's own responses, and resolving the
 * thread on GitHub clears it from this list.
 */
export function parseInlineComments(json: GhReviewThreadsResponse): PrComment[] {
  const threads = json.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  const out: PrComment[] = [];
  for (const thread of threads) {
    if (thread.isResolved) continue;
    const root = thread.comments?.nodes?.[0];
    if (!root?.id) continue;
    out.push({
      id: root.id,
      author: root.author?.login ?? 'unknown',
      body: clampString(stripHtmlNoise(root.body), COMMENT_BODY_MAX) ?? '',
      createdAt: root.createdAt ?? new Date().toISOString(),
      url: root.url,
      kind: 'review',
      path: root.path,
      line: root.line ?? root.originalLine ?? undefined,
    });
  }
  return out;
}

/**
 * Build the "needs attention" comment list. We deliberately surface only what a
 * reviewer must act on:
 *   - unresolved inline review-thread comments (`inlineComments`, incl. bots like
 *     Bugbot), fetched separately via GraphQL; and
 *   - the top-level summary of a review that explicitly *requested changes*.
 * PR-level (issue) comments and plain "Commented"/"Approved" review summaries are
 * dropped as noise. Inline comments carry `path`/`line`; summaries don't.
 */
function deriveComments(
  raw: GhPrJson,
  inlineComments: PrComment[],
  ignoredAuthors: readonly string[],
): PrComment[] {
  const out: PrComment[] = [];

  for (const review of raw.reviews ?? []) {
    if (review.state !== 'CHANGES_REQUESTED') continue;
    const author = review.author?.login ?? 'unknown';
    if (isIgnoredAuthor(author, ignoredAuthors)) continue;
    const body = clampString(stripHtmlNoise(review.body), COMMENT_BODY_MAX);
    if (!body) continue;
    out.push({
      id: review.id ?? `${author}-${review.createdAt ?? ''}`,
      author,
      body,
      createdAt: review.createdAt ?? new Date().toISOString(),
      url: review.url,
      kind: 'review',
    });
  }

  for (const c of inlineComments) {
    if (isIgnoredAuthor(c.author, ignoredAuthors)) continue;
    out.push(c);
  }

  return out;
}

export function snapshotFromGhJson(
  raw: GhPrJson,
  inlineComments: PrComment[] = [],
  ignoredCommentAuthors: readonly string[] = [],
): GhPrSnapshot {
  const state = deriveState(raw);
  const checks = deriveCheckStatus(raw.statusCheckRollup);
  const comments = deriveComments(raw, inlineComments, ignoredCommentAuthors);
  const finished = state === 'merged' || state === 'closed';
  return {
    state,
    checkStatus: finished ? 'none' : checks.status,
    failingChecks: finished ? [] : checks.failing,
    unresolvedComments: finished ? [] : comments,
    prTitle: raw.title,
    prAuthor: raw.author?.login,
    prBody: clampString(raw.body, PR_BODY_MAX_LENGTH),
    headRefName: raw.headRefName,
    headRefOid: raw.headRefOid,
    isDraft: !!raw.isDraft,
    finished,
  };
}

export interface GhAdapter {
  fetchPrSnapshot(prUrl: string): Promise<GhPrSnapshot>;
}

const GH_PR_VIEW_FIELDS = [
  'state',
  'isDraft',
  'title',
  'body',
  'author',
  'headRefName',
  'headRefOid',
  'mergedAt',
  'closed',
  'statusCheckRollup',
  'reviews',
].join(',');

// Inline review comments aren't returned by `gh pr view`; fetch them (and their
// resolution state) via GraphQL. One root comment per thread is enough context.
const REVIEW_THREADS_QUERY =
  'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved comments(first:1){nodes{id author{login} body path line originalLine url createdAt}}}}}}}';

export interface CreateGhAdapterOptions {
  /** Override for tests — defaults to the real `gh` binary on PATH. */
  ghBinary?: string;
  /** Override for tests — defaults to a real execFile. */
  exec?: (binary: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  /** Override for tests — defaults to 30s per call. */
  timeoutMs?: number;
  /**
   * Read live (not cached) on every fetch so a settings change takes effect
   * on the next poll without a server restart. Defaults to no filtering.
   */
  getIgnoredCommentAuthors?: () => string[];
}

export function createGhAdapter(opts: CreateGhAdapterOptions = {}): GhAdapter {
  const ghBinary = opts.ghBinary ?? 'gh';
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const getIgnoredCommentAuthors = opts.getIgnoredCommentAuthors ?? (() => []);
  const exec =
    opts.exec ??
    ((binary: string, args: string[]) =>
      execFileAsync(binary, args, { timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024 }));

  return {
    async fetchPrSnapshot(prUrl: string): Promise<GhPrSnapshot> {
      const parsed = parsePrUrl(prUrl);
      if (!parsed) {
        throw new Error(`Invalid PR URL: ${prUrl}`);
      }
      const { stdout } = await exec(ghBinary, ['pr', 'view', prUrl, '--json', GH_PR_VIEW_FIELDS]);
      let raw: GhPrJson;
      try {
        raw = JSON.parse(stdout) as GhPrJson;
      } catch (err) {
        throw new Error(`gh pr view returned unparseable JSON for ${prUrl}: ${(err as Error).message}`);
      }

      let inlineComments: PrComment[] = [];
      const state = deriveState(raw);
      const finished = state === 'merged' || state === 'closed';
      if (!finished) {
        try {
          const { stdout: gql } = await exec(ghBinary, [
            'api',
            'graphql',
            '-f',
            `query=${REVIEW_THREADS_QUERY}`,
            '-f',
            `owner=${parsed.owner}`,
            '-f',
            `name=${parsed.repo}`,
            '-F',
            `number=${parsed.number}`,
          ]);
          inlineComments = parseInlineComments(JSON.parse(gql) as GhReviewThreadsResponse);
        } catch {
          // ponytail: inline-comment fetch is best-effort — a flaky graphql call
          // shouldn't drop the whole snapshot (state/checks still update from `gh
          // pr view`). Next poll retries.
          inlineComments = [];
        }
      }

      return snapshotFromGhJson(raw, inlineComments, getIgnoredCommentAuthors());
    },
  };
}
