import type { PrReview, Session, Todo, Track, WorkflowIssue } from '@foundation/types';
import { groupSessionsByTrack, isVisibleTrack } from '../session-overview/group-sessions';

export type PaletteKind = 'Page' | 'Settings' | 'Track' | 'Session' | 'Todo' | 'Epic' | 'PR';

export interface PaletteItem {
  key: string;
  kind: PaletteKind;
  label: string;
  sub?: string;
  to: string;
  /** ISO timestamp used for recency ranking; static entries have none. */
  at?: string;
  activity?: Session['activityStatus'];
}

export interface PaletteData {
  tracks: Track[];
  sessions: Session[];
  todos: Todo[];
  epics: WorkflowIssue[];
  reviews: PrReview[];
}

export function buildItems(d: PaletteData, statics: PaletteItem[]): PaletteItem[] {
  const trackName = new Map(d.tracks.map((t) => [t.id as string, t.name]));
  return [
    ...d.tracks
      .filter((t) => t.status === 'active' && isVisibleTrack(t))
      .map((t): PaletteItem => ({ key: `t:${t.id}`, kind: 'Track', label: t.name, to: `/tracks/${t.id}`, at: t.updatedAt })),
    // Same filter as the Sessions navigator, so the deep link always lands on a selectable session.
    ...groupSessionsByTrack(d.sessions, d.tracks)
      .flatMap((g) => g.sessions)
      .map((s): PaletteItem => ({
        key: `s:${s.id}`,
        kind: 'Session',
        label: s.name ?? `Session ${s.id.slice(0, 8)}`,
        sub: trackName.get(s.trackId),
        to: `/sessions?session=${s.id}`,
        at: s.lastActivityAt ?? s.updatedAt,
        activity: s.activityStatus,
      })),
    ...d.todos
      .filter((t) => t.status !== 'done')
      .map((t): PaletteItem => ({ key: `d:${t.id}`, kind: 'Todo', label: t.title, sub: trackName.get(t.trackId), to: `/kanban?todo=${t.id}`, at: t.updatedAt })),
    ...d.epics.map((e): PaletteItem => ({ key: `e:${e.id}`, kind: 'Epic', label: e.title, sub: e.state, to: `/workflow/${e.id}`, at: e.updatedAt })),
    ...d.reviews
      .filter((r) => r.state !== 'removed' && r.state !== 'dismissed')
      .map((r): PaletteItem => ({
        key: `r:${r.id}`,
        kind: 'PR',
        label: r.prTitle ?? `#${r.prNumber}`,
        sub: `${r.repoOwner}/${r.repoName}#${r.prNumber}`,
        to: `/pr-reviews?review=${r.id}`,
        at: r.updatedAt,
      })),
    ...statics,
  ];
}

/** 3 = prefix, 2 = word-start, 1 = substring, 0.5 = in-order subsequence, 0 = no match. */
function matchScore(text: string, q: string): number {
  const t = text.toLowerCase();
  const i = t.indexOf(q);
  if (i === 0) return 3;
  if (i > 0) return /[\s/#\-_.]/.test(t[i - 1]) ? 2 : 1;
  let j = 0;
  for (const c of t) if (c === q[j]) j++;
  return j === q.length ? 0.5 : 0;
}

/** Filter + rank: best label/sub match first, ties broken by recency (undated entries last). */
export function rankItems(items: PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim().toLowerCase();
  const scored = items
    .map((item) => ({ item, score: q ? Math.max(matchScore(item.label, q), matchScore(item.sub ?? '', q) * 0.9) : 1 }))
    .filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || (b.item.at ?? '').localeCompare(a.item.at ?? ''));
  return scored.slice(0, 50).map((x) => x.item);
}
