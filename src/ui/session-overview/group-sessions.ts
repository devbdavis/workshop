import type { Session, Track } from '@foundation/types';

export interface TrackSessionGroup {
  track: Track;
  sessions: Session[];
}

/** Dead sessions are never shown on the overview page. Background (dispatched
    agent) sessions ARE shown — they're most of what the page is for. One-shot
    system-track background sessions stay hidden via the track filter below. */
export function isVisibleSession(session: Session): boolean {
  return session.state !== 'dead';
}

/** System tracks and profile-hidden tracks are never shown on the overview page. */
export function isVisibleTrack(track: Track): boolean {
  return !track.hidden && track.label !== 'system';
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

/** Groups visible sessions by visible track (no system/hidden tracks), tracks sorted A-Z, omitting empty tracks. */
export function groupSessionsByTrack(sessions: Session[], tracks: Track[]): TrackSessionGroup[] {
  const byTrack = new Map<string, Session[]>();
  for (const session of sessions) {
    if (!isVisibleSession(session)) continue;
    const list = byTrack.get(session.trackId);
    if (list) list.push(session);
    else byTrack.set(session.trackId, [session]);
  }

  const groups: TrackSessionGroup[] = [];
  for (const track of sortTracks(tracks.filter(isVisibleTrack))) {
    const list = byTrack.get(track.id);
    if (!list || list.length === 0) continue;
    groups.push({ track, sessions: sortSessions(list) });
  }
  return groups;
}

/** A-Z by name. */
export function sortTracks(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => a.name.localeCompare(b.name));
}
