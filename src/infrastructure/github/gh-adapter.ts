import { execFile } from 'child_process';
import { promisify } from 'util';
import type { PrCheckStatus, PrCheckSummary, PrComment, PrState } from '@foundation/types';
import { parsePrUrl } from '@infrastructure/forge/pr-url.js';

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

interface GhCommentNode {
  id?: string;
  author?: { login?: string };
  body?: string;
  createdAt?: string;
  url?: string;
}

interface GhReviewCommentNode extends GhCommentNode {
  path?: string;
  line?: number;
  originalLine?: number;
  isResolved?: boolean;
}

interface GhReviewNode {
  id?: string;
  author?: { login?: string };
  body?: string;
  createdAt?: string;
  url?: string;
  state?: string;
  comments?: GhReviewCommentNode[];
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
  comments?: GhCommentNode[];
  reviews?: GhReviewNode[];
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
 * Reviews and review-thread comments come back as one stream per review. The
 * resolution flag tells us whether a thread is still open. PR-level comments
 * (issue comments) don't have a resolution concept — we surface all of them
 * that arrived after the last polled-at timestamp; for the first poll we include
 * all of them. The caller distinguishes which to act on via the `kind` field.
 */
function deriveComments(raw: GhPrJson): PrComment[] {
  const out: PrComment[] = [];

  for (const c of raw.comments ?? []) {
    if (!c.id) continue;
    out.push({
      id: c.id,
      author: c.author?.login ?? 'unknown',
      body: clampString(c.body, COMMENT_BODY_MAX) ?? '',
      createdAt: c.createdAt ?? new Date().toISOString(),
      url: c.url,
      kind: 'issue',
    });
  }

  for (const review of raw.reviews ?? []) {
    // Top-level review body (the "Changes requested" summary). Only surface it
    // if the review carries no inline thread comments — otherwise it's noise.
    const hasInline = (review.comments ?? []).length > 0;
    if (!hasInline && review.body && review.body.trim().length > 0 && review.state !== 'APPROVED') {
      out.push({
        id: review.id ?? `${review.author?.login ?? 'unknown'}-${review.createdAt ?? ''}`,
        author: review.author?.login ?? 'unknown',
        body: clampString(review.body, COMMENT_BODY_MAX) ?? '',
        createdAt: review.createdAt ?? new Date().toISOString(),
        url: review.url,
        kind: 'review',
      });
    }
    for (const rc of review.comments ?? []) {
      if (rc.isResolved) continue;
      if (!rc.id) continue;
      out.push({
        id: rc.id,
        author: rc.author?.login ?? 'unknown',
        body: clampString(rc.body, COMMENT_BODY_MAX) ?? '',
        createdAt: rc.createdAt ?? new Date().toISOString(),
        url: rc.url,
        kind: 'review',
        path: rc.path,
        line: rc.line ?? rc.originalLine,
      });
    }
  }

  return out;
}

export function snapshotFromGhJson(raw: GhPrJson): GhPrSnapshot {
  const state = deriveState(raw);
  const checks = deriveCheckStatus(raw.statusCheckRollup);
  const comments = deriveComments(raw);
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
  'comments',
  'reviews',
].join(',');

export interface CreateGhAdapterOptions {
  /** Override for tests — defaults to the real `gh` binary on PATH. */
  ghBinary?: string;
  /** Override for tests — defaults to a real execFile. */
  exec?: (binary: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  /** Override for tests — defaults to 30s per call. */
  timeoutMs?: number;
}

export function createGhAdapter(opts: CreateGhAdapterOptions = {}): GhAdapter {
  const ghBinary = opts.ghBinary ?? 'gh';
  const timeoutMs = opts.timeoutMs ?? 30_000;
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
      return snapshotFromGhJson(raw);
    },
  };
}
