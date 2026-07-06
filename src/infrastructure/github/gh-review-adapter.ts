import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import type { PrReviewVerdict } from '@foundation/types';

const execFileAsync = promisify(execFile);

/** One PR returned by `gh search prs --review-requested=@me`. */
export interface DiscoveredPr {
  url: string;
  title: string;
  author: string;
  repoOwner: string;
  repoName: string;
  number: number;
  updatedAt?: string;
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
  /** Posts ONE review (body + verdict + inline comments) via the GitHub reviews API. */
  submitPrReview(owner: string, repo: string, prNumber: number, submission: GhReviewSubmission): Promise<void>;
}

interface GhSearchPrNode {
  url?: string;
  title?: string;
  author?: { login?: string };
  repository?: { name?: string; nameWithOwner?: string };
  number?: number;
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

export function createGhReviewAdapter(opts: CreateGhReviewAdapterOptions = {}): GhReviewAdapter {
  const ghBinary = opts.ghBinary ?? 'gh';
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const exec =
    opts.exec ??
    ((binary: string, args: string[]) =>
      execFileAsync(binary, args, { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 }));
  const execWithStdin =
    opts.execWithStdin ?? ((binary: string, args: string[], stdin: string) => spawnWithStdin(binary, args, stdin, timeoutMs));

  return {
    async searchReviewRequestedPrs(): Promise<DiscoveredPr[]> {
      const { stdout } = await exec(ghBinary, [
        'search',
        'prs',
        '--review-requested=@me',
        '--state=open',
        '--limit',
        '100',
        '--json',
        'url,title,author,repository,number,updatedAt',
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
          updatedAt: node.updatedAt,
        });
      }
      return out;
    },

    async fetchPrDiff(prUrl: string): Promise<string> {
      const { stdout } = await exec(ghBinary, ['pr', 'diff', prUrl]);
      return stdout;
    },

    async submitPrReview(owner: string, repo: string, prNumber: number, submission: GhReviewSubmission): Promise<void> {
      const payload = JSON.stringify({
        body: submission.body,
        event: VERDICT_TO_EVENT[submission.verdict],
        comments: submission.comments.map((c) => ({ path: c.path, line: c.line, side: c.side, body: c.body })),
      });
      await execWithStdin(ghBinary, [
        'api',
        `repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
        '--method',
        'POST',
        '--input',
        '-',
      ], payload);
    },
  };
}
