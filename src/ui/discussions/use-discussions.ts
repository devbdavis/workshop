import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  Discussion,
  DiscussionId,
  DiscussionTeam,
  DiscussionTeamId,
  DiscussionStatus,
} from '@foundation/discussion-types';
import type { TrackId } from '@foundation/types';
import type { DiscussionState } from '@application/discussion/discussion-service';

// === Hooks ===

export function useDiscussionTeams() {
  const [teams, setTeams] = useState<DiscussionTeam[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/discussion-teams');
      if (res.ok) setTeams(await res.json());
    } catch (err) {
      console.error('Failed to load discussion teams:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { teams, loading, reload };
}

export interface DiscussionFilters {
  status?: DiscussionStatus;
  teamId?: DiscussionTeamId;
  trackId?: TrackId;
}

export function useDiscussions(filters?: DiscussionFilters) {
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filters?.status) params.set('status', filters.status);
      if (filters?.teamId) params.set('teamId', filters.teamId);
      if (filters?.trackId) params.set('trackId', filters.trackId);
      const qs = params.toString();
      const url = qs ? `/api/discussions?${qs}` : '/api/discussions';
      const res = await fetch(url);
      if (res.ok) setDiscussions(await res.json());
    } catch (err) {
      console.error('Failed to load discussions:', err);
    } finally {
      setLoading(false);
    }
  }, [filters?.status, filters?.teamId, filters?.trackId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { discussions, loading, reload };
}

export function useDiscussionState(discussionId: DiscussionId | null) {
  const [state, setState] = useState<DiscussionState | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!discussionId) {
      setState(null);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/discussions/${discussionId}`);
      if (res.ok) setState(await res.json());
      else setState(null);
    } catch (err) {
      console.error('Failed to load discussion state:', err);
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [discussionId]);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  return { state, loading, reload };
}

export function useDiscussionWebSocket(onEvent: (type: string, id: string) => void) {
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data);
        if (event.type?.startsWith('discussion:')) {
          callbackRef.current(event.type, event.id);
        }
      } catch {
        // ignore parse errors
      }
    };
    return () => ws.close();
  }, []);
}

// === Mutation functions ===

export async function createTeam(data: {
  name: string;
  description?: string;
  consensusRule: { type: string; threshold?: number; minVotes?: number };
  memberAgentIds: string[];
}): Promise<DiscussionTeam> {
  const res = await fetch('/api/discussion-teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to create team');
  return res.json();
}

export async function updateTeam(
  id: DiscussionTeamId,
  data: Partial<Pick<DiscussionTeam, 'name' | 'description' | 'consensusRule' | 'memberAgentIds'>>,
): Promise<DiscussionTeam> {
  const res = await fetch(`/api/discussion-teams/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to update team');
  return res.json();
}

export async function deleteTeam(id: DiscussionTeamId): Promise<void> {
  const res = await fetch(`/api/discussion-teams/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to delete team');
}

export async function createDiscussion(data: {
  teamId: DiscussionTeamId;
  title: string;
  type?: 'rfc' | 'question' | 'review';
  artifact?: string;
  trackId?: TrackId;
  staleAfterMinutes?: number;
  createdByType?: 'agent' | 'human';
  createdById?: string;
}): Promise<Discussion> {
  const res = await fetch('/api/discussions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to create discussion');
  return res.json();
}

export async function postMessage(
  discussionId: DiscussionId,
  data: {
    authorType?: 'agent' | 'human';
    authorId?: string;
    authorName?: string;
    messageType: string;
    content: string;
  },
): Promise<unknown> {
  const res = await fetch(`/api/discussions/${discussionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to post message');
  return res.json();
}

export async function castVote(
  discussionId: DiscussionId,
  data: {
    voterType?: 'agent' | 'human';
    voterId: string;
    voterName?: string;
    vote: 'satisfied' | 'unsatisfied' | 'abstain';
    comment?: string;
  },
): Promise<unknown> {
  const res = await fetch(`/api/discussions/${discussionId}/votes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to cast vote');
  return res.json();
}

export async function closeDiscussion(discussionId: DiscussionId): Promise<void> {
  const res = await fetch(`/api/discussions/${discussionId}/close`, { method: 'POST' });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to close discussion');
}

export async function deleteDiscussion(discussionId: DiscussionId): Promise<void> {
  const res = await fetch(`/api/discussions/${discussionId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to delete discussion');
}
