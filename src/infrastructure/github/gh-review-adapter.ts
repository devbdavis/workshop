import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import type { PrReviewVerdict } from '@foundation/types';
import { parsePrUrl } from '@infrastructure/forge/pr-url.js';

const execFileAsync = promisify(execFile);

/** One PR returned by `gh search prs user-review-requested:@me`. */
export interface DiscoveredPr {
  url: string;
  title: string;
  author: string;
  repoOwner: string;
  repoName: string;
  number: number;
  /** PR description (markdown), clamped. */
  body?: string;
  updatedAt?: string;
}

/** Keep stored PR descriptions bounded — the dashboard shows a scrollable excerpt. */
export const PR_BODY_MAX = 5_000;

export function clampPrBody(body: string | null | undefined): string | undefined {
  if (!body) return undefined;
  const trimmed = body.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length > PR_BODY_MAX ? `${trimmed.slice(0, PR_BODY_MAX)}…` : trimmed;
}

export interface GhReviewComment {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  body: string;
}

export interface GhReviewSubmission {
  body: string;
  verdict: PrReviewVerdict;
  comments: GhReviewComment[];
}

export interface GhReviewAdapter {
  /** Open PRs across GitHub where the authed user's review is requested. */
  searchReviewRequestedPrs(): Promise<DiscoveredPr[]>;
  /** Raw unified diff of the PR (`gh pr diff`). */
  fetchPrDiff(prUrl: string): Promise<string>;
  /** Posts ONE review (body + verdict + inline comments) via the forge's reviews API. */
  submitPrReview(prUrl: string, submission: GhReviewSubmission): Promise<void>;
}

interface GhSearchPrNode {
  url?: string;
  title?: string;
  author?: { login?: string };
  repository?: { name?: string; nameWithOwner?: string };
  number?: number;
  body?: string;
  updatedAt?: string;
}

const VERDICT_TO_EVENT: Record<PrReviewVerdict, string> = {
  approve: 'APPROVE',
  request_changes: 'REQUEST_CHANGES',
  comment: 'COMMENT',
};

export interface CreateGhReviewAdapterOptions {
  ghBinary?: string;
  /** Override for tests — defaults to a real execFile. */
  exec?: (binary: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  /** Override for tests — defaults to a real spawn with the payload on stdin. */
  execWithStdin?: (binary: string, args: string[], stdin: string) => Promise<{ stdout: string; stderr: string }>;
  timeoutMs?: number;
}

function spawnWithStdin(
  binary: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${binary} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `${binary} exited with code ${code}`));
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

/** A comment shaped for GitHub's create-review payload (line/side, or legacy diff position). */
type ReviewCommentPayload = Record<string, string | number>;

interface PendingReviewComment {
  path?: string;
  body?: string;
  line?: number | null;
  side?: 'LEFT' | 'RIGHT' | null;
  start_line?: number | null;
  start_side?: 'LEFT' | 'RIGHT' | null;
  position?: number | null;
  in_reply_to_id?: number | null;
}

/** Re-express a hand-written pending comment for the create-review payload. Pending
 *  comments carry only a diff `position` — `line`/`side` are filled in on submit. */
function toReviewComment(c: PendingReviewComment): ReviewCommentPayload {
  const reject = (why: string) =>
    new Error(
      `Pending review comment on ${c.path ?? 'an unknown file'} ${why}. ` +
        'Submit or delete your in-progress review on GitHub, then retry.',
    );
  if (!c.path || !c.body) throw reject('is missing a path or body');
  if (c.in_reply_to_id) throw reject('is a reply to another comment and cannot be merged');
  if (typeof c.line === 'number') {
    return {
      path: c.path,
      body: c.body,
      line: c.line,
      side: c.side ?? 'RIGHT',
      ...(typeof c.start_line === 'number' ? { start_line: c.start_line, start_side: c.start_side ?? 'RIGHT' } : {}),
    };
  }
  if (typeof c.position === 'number') return { path: c.path, body: c.body, position: c.position };
  throw reject('is no longer anchored to the diff');
}

export function createGhReviewAdapter(opts: CreateGhReviewAdapterOptions = {}): GhReviewAdapter {
  const ghBinary = opts.ghBinary ?? 'gh';
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const exec =
    opts.exec ??
    ((binary: string, args: string[]) =>
      execFileAsync(binary, args, { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 }));
  const execWithStdin =
    opts.execWithStdin ?? ((binary: string, args: string[], stdin: string) => spawnWithStdin(binary, args, stdin, timeoutMs));

  /** GitHub allows one pending review per user, so a review started by hand in the UI
   *  makes our POST 422. Adopt its comments and drop it, so everything lands as one
   *  review. Only the authed user's own pending review is ever listed. */
  async function drainPendingReview(
    reviewsPath: string,
  ): Promise<{ body: string; comments: ReviewCommentPayload[] } | null> {
    const { stdout } = await exec(ghBinary, ['api', `${reviewsPath}?per_page=100`, '--paginate']);
    const pending = (JSON.parse(stdout) as { id: number; state: string; body?: string }[]).find(
      (r) => r.state === 'PENDING',
    );
    if (!pending) return null;
    const { stdout: raw } = await exec(ghBinary, [
      'api',
      `${reviewsPath}/${pending.id}/comments?per_page=100`,
      '--paginate',
    ]);
    const comments = (JSON.parse(raw) as PendingReviewComment[]).map(toReviewComment);
    await exec(ghBinary, ['api', `${reviewsPath}/${pending.id}`, '--method', 'DELETE']);
    return { body: pending.body?.trim() ?? '', comments };
  }

  const postReview = (reviewsPath: string, payload: string) =>
    execWithStdin(ghBinary, ['api', reviewsPath, '--method', 'POST', '--input', '-'], payload);

  /** Our POST failed after the pending review was consumed — put the user's work back. */
  async function restorePendingReview(
    reviewsPath: string,
    drained: { body: string; comments: ReviewCommentPayload[] },
    cause: unknown,
  ): Promise<void> {
    // No API appends to a pending review, so it is deleted before we post: a crash in
    // that window loses it. Recreating it is the best guard available.
    const payload = JSON.stringify({ body: drained.body, comments: drained.comments });
    try {
      await postReview(reviewsPath, payload);
    } catch {
      const lost = drained.comments.map((c) => `- ${c.path}: ${c.body}`).join('\n');
      throw new Error(
        `${cause instanceof Error ? cause.message : String(cause)}\n\n` +
          `Your pending review was consumed and could not be restored. Comments:\n${lost}`,
      );
    }
  }

  return {
    async searchReviewRequestedPrs(): Promise<DiscoveredPr[]> {
      // user-review-requested (raw search qualifier — gh has no flag for it) matches
      // only PRs where the user is EXPLICITLY requested; --review-requested would
      // also match requests aimed at teams the user belongs to.
      const { stdout } = await exec(ghBinary, [
        'search',
        'prs',
        'user-review-requested:@me',
        '--state=open',
        '--limit',
        '100',
        '--json',
        'url,title,author,repository,number,body,updatedAt',
      ]);
      const nodes = JSON.parse(stdout) as GhSearchPrNode[];
      const out: DiscoveredPr[] = [];
      for (const node of nodes) {
        if (!node.url || !node.number) continue;
        const nameWithOwner = node.repository?.nameWithOwner ?? '';
        const [owner, name] = nameWithOwner.includes('/') ? nameWithOwner.split('/') : ['', node.repository?.name ?? ''];
        out.push({
          url: node.url,
          title: node.title ?? '',
          author: node.author?.login ?? 'unknown',
          repoOwner: owner,
          repoName: name,
          number: node.number,
          body: clampPrBody(node.body),
          updatedAt: node.updatedAt,
        });
      }
      return out;
    },

    async fetchPrDiff(prUrl: string): Promise<string> {
      const { stdout } = await exec(ghBinary, ['pr', 'diff', prUrl]);
      return stdout;
    },

    async submitPrReview(prUrl: string, submission: GhReviewSubmission): Promise<void> {
      const parsed = parsePrUrl(prUrl);
      if (!parsed) throw new Error(`Invalid PR URL: ${prUrl}`);
      const { owner, repo, number: prNumber } = parsed;
      const reviewsPath = `repos/${owner}/${repo}/pulls/${prNumber}/reviews`;
      const drained = await drainPendingReview(reviewsPath);
      const payload = JSON.stringify({
        body: [drained?.body, submission.body].filter(Boolean).join('\n\n'),
        event: VERDICT_TO_EVENT[submission.verdict],
        comments: [
          ...(drained?.comments ?? []),
          ...submission.comments.map((c) => ({ path: c.path, line: c.line, side: c.side, body: c.body })),
        ],
      });
      try {
        await postReview(reviewsPath, payload);
      } catch (err) {
        if (drained && (drained.comments.length > 0 || drained.body)) await restorePendingReview(reviewsPath, drained, err);
        throw err;
      }
    },
  };
}
