import type { PrReviewRepository } from '@domain/pr-review/repository';
import type { ReviewRequestDiscovery } from '@infrastructure/forge/forge-adapter';

/** Non-track event channel — the dashboard listens on event type, not trackId. */
const EVENT_TRACK = 'pr-reviews';

const DEFAULT_INTERVAL_MS = 5 * 60_000;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export interface PrReviewDiscoveryPollerDeps {
  reviews: PrReviewRepository;
  forge: { discoverReviewRequests(): Promise<ReviewRequestDiscovery> };
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
      const { prs: discovered, hosts } = await forge.discoverReviewRequests();
      let added = 0;
      for (const pr of discovered) {
        if (reviews.findByUrl(pr.url)) continue;
        reviews.upsertIncoming({
          prUrl: pr.url,
          repoOwner: pr.repoOwner,
          repoName: pr.repoName,
          prNumber: pr.number,
          prTitle: pr.title,
          prAuthor: pr.author,
          prBody: pr.body,
          discoveredVia: 'poll',
        });
        added++;
      }

      // Prune poll-discovered rows the user never touched (still 'incoming')
      // whose review request has vanished from search — PR closed, request
      // withdrawn, or reviewed elsewhere. Rows with user investment
      // (analyzing/ready/submitted) and manual adds are never pruned. Only hosts
      // that answered this pass are eligible: a forge that failed to respond
      // reports zero PRs, which must not be read as "everything went away".
      const liveUrls = new Set(discovered.map((pr) => pr.url));
      const searched = new Set(hosts);
      let pruned = 0;
      for (const row of reviews.findAll()) {
        if (row.state !== 'incoming' || row.discoveredVia !== 'poll') continue;
        if (!searched.has(hostOf(row.prUrl))) continue;
        if (liveUrls.has(row.prUrl)) continue;
        reviews.delete(row.id);
        pruned++;
      }

      if (added > 0 || pruned > 0) {
        broadcast('pr-review:updated', EVENT_TRACK, { added, pruned });
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
