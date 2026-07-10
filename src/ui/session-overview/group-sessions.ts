import type { Session, Track } from '@foundation/types';

export interface TrackSessionGroup {
  track: Track;
  sessions: Session[];
}

/** Background sessions and dead sessions are never shown on the overview page. */
export function isVisibleSession(session: Session): boolean {
  return !session.background && session.state !== 'dead';
}

/** Attention-first, then most recently active. */
export function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    const attentionDelta = (b.attentionSince ? 1 : 0) - (a.attentionSince ? 1 : 0);
    if (attentionDelta !== 0) return attentionDelta;
    const aTime = a.lastActivityAt ?? a.updatedAt;
    const bTime = b.lastActivityAt ?? b.updatedAt;
    return bTime.localeCompare(aTime);
  });
}

/** Groups visible sessions by track, preserving track order, omitting empty and profile-hidden tracks. */
export function groupSessionsByTrack(sessions: Session[], tracks: Track[]): TrackSessionGroup[] {
  const byTrack = new Map<string, Session[]>();
  for (const session of sessions) {
    if (!isVisibleSession(session)) continue;
    const list = byTrack.get(session.trackId);
    if (list) list.push(session);
    else byTrack.set(session.trackId, [session]);
  }

  const groups: TrackSessionGroup[] = [];
  for (const track of tracks) {
    if (track.hidden) continue;
    const list = byTrack.get(track.id);
    if (!list || list.length === 0) continue;
    groups.push({ track, sessions: sortSessions(list) });
  }
  return groups;
}
