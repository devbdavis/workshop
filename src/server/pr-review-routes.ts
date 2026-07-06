import { Router } from 'express';
import type {
  AgentId,
  PrReviewFindingId,
  PrReviewId,
  PrReviewVerdict,
  SessionId,
  SessionProvider,
  TrackId,
  TrackRepo,
} from '@foundation/types';
import type { PrReviewRepository, PrReviewFindingInput } from '@domain/pr-review/repository';
import type { PrReviewDiscoveryPoller } from '@application/pr-review/discovery-poller';
import type { SessionRepository } from '@domain/session/repository';
import type { TrackRepository } from '@domain/track/repository';
import type { AgentRepository } from '@domain/agent/repository';
import type { SettingsRepository } from '@domain/repo/repository';
import type { FilesystemAgentScanner } from '@infrastructure/agents/filesystem-scanner.js';
import type { GhAdapter } from '@infrastructure/github/gh-adapter';
import type { GhReviewAdapter } from '@infrastructure/github/gh-review-adapter';
import { parsePrUrl } from '@infrastructure/github/gh-adapter.js';
import { parseUnifiedDiff, isAnchorable, extractHunkForLine } from '@infrastructure/github/diff-utils.js';
import { broadcast } from './events.js';

const PR_REVIEW_AGENT_ID = 'global:pr-review' as AgentId;
const TRACK_SETTING_KEY = 'pr_review_track_id';
/** Event channel — the dashboard filters on event type, not trackId. */
const EVENT_TRACK = 'pr-reviews';

const VALID_VERDICTS: ReadonlySet<PrReviewVerdict> = new Set(['approve', 'request_changes', 'comment']);

export interface PrReviewRouterDeps {
  reviews: PrReviewRepository;
  discovery: PrReviewDiscoveryPoller;
  gh: GhAdapter;
  ghReview: GhReviewAdapter;
  sessions: SessionRepository;
  tracks: TrackRepository;
  agents: AgentRepository;
  filesystemScanner: FilesystemAgentScanner;
  settings: SettingsRepository;
  projectRoot: string;
  terminal: {
    createSession: (
      trackId: TrackId,
      opts?: {
        systemPrompt?: string;
        background?: boolean;
        initialPrompt?: string;
        provider?: SessionProvider;
        name?: string;
        worktreeMode?: boolean;
        repos?: TrackRepo[];
        dangerouslySkipPermissions?: boolean;
      },
    ) => Promise<{ id: SessionId; trackId: TrackId; tmuxSession: string; state: string }>;
  };
}

/** Raw finding as reported by the agent via the MCP tool. */
interface ReportedFinding {
  file?: unknown;
  line?: unknown;
  category?: unknown;
  summary?: unknown;
  failureScenario?: unknown;
  suggestedComment?: unknown;
}

function parseReportedFindings(raw: unknown): Omit<PrReviewFindingInput, 'anchored' | 'codeContext'>[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Omit<PrReviewFindingInput, 'anchored' | 'codeContext'>[] = [];
  for (const item of raw as ReportedFinding[]) {
    if (typeof item?.file !== 'string' || typeof item?.summary !== 'string') return null;
    const suggestedComment = typeof item.suggestedComment === 'string' && item.suggestedComment.trim().length > 0
      ? item.suggestedComment
      : item.summary;
    out.push({
      file: item.file,
      line: typeof item.line === 'number' && Number.isFinite(item.line) ? item.line : undefined,
      category: typeof item.category === 'string' ? item.category : undefined,
      summary: item.summary,
      failureScenario: typeof item.failureScenario === 'string' ? item.failureScenario : undefined,
      suggestedComment,
    });
  }
  return out;
}

export function createPrReviewRouter(deps: PrReviewRouterDeps): Router {
  const router = Router();
  const { reviews, discovery, gh, ghReview, sessions, tracks, agents, filesystemScanner, settings, projectRoot, terminal } = deps;

  /** The dedicated system track that hosts analysis sessions (lazily created, id cached in settings). */
  function ensureReviewTrack(): TrackId {
    const cached = settings.get(TRACK_SETTING_KEY);
    if (cached && tracks.findById(cached as TrackId)) return cached as TrackId;
    const track = tracks.create({
      name: 'PR Reviews',
      description: 'Background analysis sessions dispatched from the PR Review dashboard.',
      label: 'system',
      status: 'active',
    });
    settings.set(TRACK_SETTING_KEY, track.id);
    return track.id;
  }

  router.get('/pr-reviews', (_req, res) => {
    const counts = reviews.countFindings();
    const rows = reviews.findAll().map((r) => ({
      ...r,
      findingCounts: counts.get(r.id) ?? { open: 0, total: 0 },
    }));
    res.json(rows);
  });

  router.get('/pr-reviews/:id', (req, res) => {
    const review = reviews.findById(req.params.id as PrReviewId);
    if (!review) {
      res.status(404).json({ error: 'PR review not found' });
      return;
    }
    // Session info lets the UI open a terminal to converse with the review agent.
    const session = review.sessionId ? sessions.findById(review.sessionId) : null;
    res.json({
      ...review,
      findings: reviews.findingsByReview(review.id),
      session: session
        ? { id: session.id, trackId: session.trackId, name: session.name, state: session.state }
        : null,
    });
  });

  router.post('/pr-reviews/poll-now', async (_req, res) => {
    const added = await discovery.pollNow();
    res.json({ added });
  });

  // Manual add by URL. Fetches metadata via gh so the sidebar entry is useful.
  router.post('/pr-reviews', async (req, res) => {
    try {
      const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
      const parsed = parsePrUrl(url);
      if (!parsed) {
        res.status(400).json({ error: 'Not a GitHub PR URL (expected https://github.com/owner/repo/pull/N)' });
        return;
      }
      const existing = reviews.findByUrl(url);
      if (existing) {
        res.json(existing);
        return;
      }
      const snapshot = await gh.fetchPrSnapshot(url);
      const review = reviews.upsertIncoming({
        prUrl: url,
        repoOwner: parsed.owner,
        repoName: parsed.repo,
        prNumber: parsed.number,
        prTitle: snapshot.prTitle,
        prAuthor: snapshot.prAuthor,
        prBranch: snapshot.headRefName,
        prBody: snapshot.prBody,
        discoveredVia: 'manual',
      });
      broadcast('pr-review:updated', EVENT_TRACK, { reviewId: review.id });
      res.status(201).json(review);
    } catch (err) {
      console.error('Failed to add PR for review:', err);
      res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to fetch PR metadata' });
    }
  });

  // Dispatch the pr-review agent in a background session.
  router.post('/pr-reviews/:id/analyze', async (req, res) => {
    try {
      const review = reviews.findById(req.params.id as PrReviewId);
      if (!review) {
        res.status(404).json({ error: 'PR review not found' });
        return;
      }
      let agent = agents.findById(PR_REVIEW_AGENT_ID);
      if (!agent) agent = filesystemScanner.findById(PR_REVIEW_AGENT_ID, projectRoot);
      if (!agent) {
        res.status(500).json({ error: `Agent ${PR_REVIEW_AGENT_ID} not found — restart the server to auto-install template agents` });
        return;
      }
      const trackId = ensureReviewTrack();
      const session = await terminal.createSession(trackId, {
        systemPrompt: `## Agent: ${agent.name}\n\n${agent.systemPrompt}`,
        background: true,
        initialPrompt: [
          `Review the pull request at ${review.prUrl}.`,
          `When done, report your structured findings, draft summary, and suggested verdict via the workshop_report_pr_review MCP tool (prUrl: ${review.prUrl}). Do not post anything to GitHub.`,
        ].join('\n\n'),
        name: `Review PR #${review.prNumber}: ${review.prTitle ?? ''}`.trim(),
        worktreeMode: false,
        dangerouslySkipPermissions: req.body?.dangerouslySkipPermissions === true,
      });
      const updated = reviews.update(review.id, { state: 'analyzing', sessionId: session.id });
      broadcast('pr-review:updated', EVENT_TRACK, { reviewId: review.id });
      broadcast('session:created', trackId, { sessionId: session.id });
      res.status(201).json({ review: updated, session });
    } catch (err) {
      console.error('Failed to dispatch PR review analysis:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to dispatch analysis' });
    }
  });

  // Structured findings arrive here (via the workshop_report_pr_review MCP tool).
  router.post('/pr-reviews/report', async (req, res) => {
    try {
      const { prUrl, draftSummary, suggestedVerdict } = (req.body ?? {}) as Record<string, unknown>;
      if (typeof prUrl !== 'string') {
        res.status(400).json({ error: 'prUrl is required' });
        return;
      }
      const review = reviews.findByUrl(prUrl);
      if (!review) {
        res.status(404).json({ error: `No PR review registered for ${prUrl} — add it on the PR Reviews dashboard first` });
        return;
      }
      const findings = parseReportedFindings(req.body?.findings ?? []);
      if (findings === null) {
        res.status(400).json({ error: 'findings must be an array of { file, summary, suggestedComment, line?, category?, failureScenario? }' });
        return;
      }

      // Anchor findings against the current diff and capture display context.
      let enriched: PrReviewFindingInput[];
      let headSha: string | undefined;
      try {
        const [diff, snapshot] = await Promise.all([ghReview.fetchPrDiff(prUrl), gh.fetchPrSnapshot(prUrl)]);
        const parsed = parseUnifiedDiff(diff);
        headSha = snapshot.headRefOid;
        enriched = findings.map((f) => ({
          ...f,
          anchored: isAnchorable(parsed, f.file, f.line),
          codeContext: extractHunkForLine(parsed, f.file, f.line),
        }));
      } catch (err) {
        // gh hiccup must not lose the agent's work — store unanchored, fix at submit.
        console.warn('[pr-review] Could not anchor findings against diff:', err instanceof Error ? err.message : err);
        enriched = findings.map((f) => ({ ...f, anchored: false }));
      }

      const stored = reviews.replaceFindings(review.id, enriched);
      const updated = reviews.update(review.id, {
        state: 'ready',
        headSha,
        draftSummary: typeof draftSummary === 'string' ? draftSummary : undefined,
        suggestedVerdict: VALID_VERDICTS.has(suggestedVerdict as PrReviewVerdict)
          ? (suggestedVerdict as PrReviewVerdict)
          : undefined,
      });
      broadcast('pr-review:updated', EVENT_TRACK, { reviewId: review.id });
      res.json({ review: updated, findings: stored });
    } catch (err) {
      console.error('Failed to record PR review report:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to record report' });
    }
  });

  // Edit draft summary / verdict, or dismiss/restore the whole PR.
  router.patch('/pr-reviews/:id', (req, res) => {
    const review = reviews.findById(req.params.id as PrReviewId);
    if (!review) {
      res.status(404).json({ error: 'PR review not found' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const state = body.state;
    if (state !== undefined && state !== 'dismissed' && state !== 'incoming') {
      res.status(400).json({ error: 'state may only be set to dismissed or incoming' });
      return;
    }
    const updated = reviews.update(review.id, {
      draftSummary: typeof body.draftSummary === 'string' ? body.draftSummary : undefined,
      suggestedVerdict: VALID_VERDICTS.has(body.suggestedVerdict as PrReviewVerdict)
        ? (body.suggestedVerdict as PrReviewVerdict)
        : undefined,
      state: state as 'dismissed' | 'incoming' | undefined,
    });
    broadcast('pr-review:updated', EVENT_TRACK, { reviewId: review.id });
    res.json(updated);
  });

  // Dismiss-as-meh / restore / edit a single finding.
  router.patch('/pr-reviews/:id/findings/:findingId', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const status = body.status;
    if (status !== undefined && status !== 'open' && status !== 'dismissed') {
      res.status(400).json({ error: 'status may only be set to open or dismissed' });
      return;
    }
    const updated = reviews.updateFinding(req.params.findingId as PrReviewFindingId, {
      status: status as 'open' | 'dismissed' | undefined,
      suggestedComment: typeof body.suggestedComment === 'string' ? body.suggestedComment : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: 'Finding not found' });
      return;
    }
    res.json(updated);
  });

  // Post ONE GitHub review: kept findings as inline comments + summary body + verdict.
  router.post('/pr-reviews/:id/submit', async (req, res) => {
    try {
      const review = reviews.findById(req.params.id as PrReviewId);
      if (!review) {
        res.status(404).json({ error: 'PR review not found' });
        return;
      }
      const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
      const verdict = req.body?.verdict as PrReviewVerdict;
      if (!VALID_VERDICTS.has(verdict)) {
        res.status(400).json({ error: 'verdict must be approve, request_changes, or comment' });
        return;
      }
      if (body.length === 0) {
        res.status(400).json({ error: 'Review body must not be empty' });
        return;
      }

      const openFindings = reviews.findingsByReview(review.id).filter((f) => f.status === 'open');

      // Re-validate anchors against a fresh diff — pushes since analysis would 422 the review.
      const diff = await ghReview.fetchPrDiff(review.prUrl);
      const parsed = parseUnifiedDiff(diff);
      const inline = openFindings.filter((f) => isAnchorable(parsed, f.file, f.line));
      const unanchored = openFindings.filter((f) => !isAnchorable(parsed, f.file, f.line));

      const fullBody = [
        body,
        ...(unanchored.length > 0
          ? ['\n---\n', ...unanchored.map((f) => `**${f.file}${f.line ? `:${f.line}` : ''}** — ${f.suggestedComment}`)]
          : []),
      ].join('\n');

      await ghReview.submitPrReview(review.repoOwner, review.repoName, review.prNumber, {
        body: fullBody,
        verdict,
        comments: inline.map((f) => ({ path: f.file, line: f.line!, side: f.side, body: f.suggestedComment })),
      });

      reviews.markOpenFindingsPosted(review.id);
      const updated = reviews.update(review.id, {
        state: 'submitted',
        submittedAt: new Date().toISOString(),
        draftSummary: body,
        suggestedVerdict: verdict,
      });
      broadcast('pr-review:updated', EVENT_TRACK, { reviewId: review.id });
      res.json({ review: updated, inlineCount: inline.length, bodyCount: unanchored.length });
    } catch (err) {
      console.error('Failed to submit PR review:', err);
      res.status(502).json({ error: err instanceof Error ? err.message : 'GitHub review submission failed' });
    }
  });

  return router;
}
