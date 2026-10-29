import type { PrReviewRepository } from '@domain/pr-review/repository';
import type { ReviewRequestDiscovery } from '@infrastructure/forge/forge-adapter';

/** Non-track event channel — the dashboard listens on event type, not trackId. */
const EVENT_TRACK = 'pr-reviews';

const DEFAULT_INTERVAL_MS = 5 * 60_000;
/** Search can lag a submit, so a request still listed this soon after is the old one, not a re-request. */
const REREQUEST_GRACE_MS = 10 * 60_000;
/** Rows the user has acted on: checked each pass for merge/close and fresh pushes. */
const TRACKED_STATES = new Set(['ready', 'submitted', 'needs_rereview', 'dismissed']);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export interface PrReviewDiscoveryPollerDeps {
  reviews: PrReviewRepository;
  forge: {
    discoverReviewRequests(): Promise<ReviewRequestDiscovery>;
    fetchPrSnapshot(prUrl: string): Promise<{ headRefOid?: string; finished?: boolean }>;
  };
  broadcast: (type: 'pr-review:updated', trackId: string, payload?: Record<string, unknown>) => void;
  intervalMs?: number;
}

export interface PrReviewDiscoveryPoller {
  start(): void;
  stop(): void;
  /** Runs one discovery pass; returns how many new PRs were registered. */
  pollNow(): Promise<number>;
}

export function createPrReviewDiscoveryPoller(deps: PrReviewDiscoveryPollerDeps): PrReviewDiscoveryPoller {
  const { reviews, forge, broadcast } = deps;
  const intervalMs = Math.max(60_000, deps.intervalMs ?? DEFAULT_INTERVAL_MS);
  let timer: ReturnType<typeof setInterval> | null = null;
  let polling = false;

  async function pollNow(): Promise<number> {
    if (polling) return 0;
    polling = true;
    try {
      const { prs: direct, hosts, teamPrs } = await forge.discoverReviewRequests();
      // Direct requests first so a PR asked of both you and your team registers as yours.
      const discovered = [...direct, ...(teamPrs ?? [])];
      let added = 0;
      let rereview = 0;
      for (const [i, pr] of discovered.entries()) {
        const existing = reviews.findByUrl(pr.url);
        // Asked of you directly now — it's no longer just a team request.
        if (existing?.discoveredVia === 'team' && i < direct.length) reviews.update(existing.id, { discoveredVia: 'poll' });
        // Submitting clears your request, so seeing it again means the author re-requested.
        if (
          existing?.state === 'submitted' &&
          i < direct.length &&
          Date.now() - Date.parse(existing.submittedAt ?? existing.updatedAt) > REREQUEST_GRACE_MS
        ) {
          reviews.update(existing.id, { state: 'needs_rereview' });
          rereview++;
        }
        if (existing) continue;
        reviews.upsertIncoming({
          prUrl: pr.url,
          repoOwner: pr.repoOwner,
          repoName: pr.repoName,
          prNumber: pr.number,
          prTitle: pr.title,
          prAuthor: pr.author,
          prBody: pr.body,
          discoveredVia: i >= direct.length ? 'team' : 'poll',
        });
        added++;
      }

      // Prune poll-discovered rows the user never touched (still 'incoming')
      // whose review request has vanished from search — PR closed, request
      // withdrawn, or reviewed elsewhere. Rows with user investment
      // (analyzing/ready/submitted) and manual adds are never pruned. Team rows also go
      // once a teammate reviews or comments. Only hosts
      // that answered this pass are eligible: a forge that failed to respond
      // reports zero PRs, which must not be read as "everything went away".
      const liveUrls = new Set(discovered.map((pr) => pr.url));
      const searched = new Set(hosts);
      let pruned = 0;
      const rows = reviews.findAll();
      for (const row of rows) {
        if (row.state !== 'incoming' || row.discoveredVia === 'manual') continue;
        if (!searched.has(hostOf(row.prUrl))) continue;
        // A failed team search must not prune team rows; a teammate engaging (or the request going away) does.
        if (row.discoveredVia === 'team' && !teamPrs) continue;
        if (liveUrls.has(row.prUrl)) continue;
        reviews.delete(row.id);
        pruned++;
      }

      // Merged/closed PRs leave the dashboard; a submitted review goes stale the moment
      // the author pushes, so flip those rows back onto the active list.
      // ponytail: one forge call per tracked row per pass; merged rows delete themselves, so the set stays open PRs only.
      const outcomes = await Promise.all(
        rows
          .filter((row) => TRACKED_STATES.has(row.state))
          .map(async (row): Promise<'pruned' | 'rereview' | null> => {
            try {
              const { headRefOid, finished } = await forge.fetchPrSnapshot(row.prUrl);
              if (finished) {
                reviews.delete(row.id);
                return 'pruned';
              }
              if (row.state !== 'submitted' || !row.headSha || !headRefOid || headRefOid === row.headSha) return null;
              reviews.update(row.id, { state: 'needs_rereview' });
              return 'rereview';
            } catch (err) {
              console.warn('[pr-review] Head check failed for', row.prUrl, err instanceof Error ? err.message : err);
              return null;
            }
          }),
      );
      pruned += outcomes.filter((o) => o === 'pruned').length;
      rereview += outcomes.filter((o) => o === 'rereview').length;

      if (added > 0 || pruned > 0 || rereview > 0) {
        broadcast('pr-review:updated', EVENT_TRACK, { added, pruned, rereview });
      }
      return added;
    } catch (err) {
      // gh being unauthenticated/offline must never crash the server loop.
      console.error('[pr-review] Discovery poll failed:', err instanceof Error ? err.message : err);
      return 0;
    } finally {
      polling = false;
    }
  }

  return {
    start(): void {
      if (timer) return;
      timer = setInterval(() => void pollNow(), intervalMs);
      timer.unref?.();
      void pollNow();
      console.log(`[pr-review] Discovery poller started (every ${Math.round(intervalMs / 1000)}s)`);
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
    pollNow,
  };
}
