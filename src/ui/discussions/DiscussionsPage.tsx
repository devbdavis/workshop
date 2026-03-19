import { useState, useCallback, useEffect } from 'react';
import type { ConsensusRule, DiscussionId, DiscussionTeamId } from '@foundation/discussion-types';
import type { Agent, AgentId, PermissionRequest, Track, TrackId } from '@foundation/types';
import { DiscussionList } from './DiscussionList';
import { DiscussionThread } from './DiscussionThread';
import { TeamManager } from './TeamManager';
import { NewDiscussionModal } from './NewDiscussionModal';
import type { CreateDiscussionData } from './NewDiscussionModal';
import { PermissionPanel } from '../track-view/PermissionPanel';
import {
  useDiscussionTeams,
  useDiscussions,
  useDiscussionState,
  useDiscussionWebSocket,
  createTeam,
  updateTeam,
  deleteTeam,
  createDiscussion,
  postMessage,
  castVote,
  closeDiscussion,
} from './use-discussions';

export function DiscussionsPage() {
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showTeamManager, setShowTeamManager] = useState(false);
  const [showNewDiscussion, setShowNewDiscussion] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);

  const { teams, reload: reloadTeams } = useDiscussionTeams();
  const { discussions, reload: reloadDiscussions } = useDiscussions();
  const { state, reload: reloadState } = useDiscussionState(
    selectedId as DiscussionId | null,
  );

  // Load agents and tracks for forms
  useEffect(() => {
    Promise.all([
      fetch('/api/agents').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/tracks').then((r) => (r.ok ? r.json() : [])),
    ]).then(([a, t]) => {
      setAgents(a);
      setTracks(t);
    });
  }, []);

  // Fetch pending permissions for the selected discussion's agent sessions
  const loadPermissions = useCallback(async (discussionId: string) => {
    try {
      const sessRes = await fetch(`/api/discussions/${discussionId}/sessions`);
      if (!sessRes.ok) return;
      const sessions: { sessionId: string }[] = await sessRes.json();
      const allPending: PermissionRequest[] = [];
      for (const s of sessions) {
        const permRes = await fetch(`/api/permissions?sessionId=${s.sessionId}&status=pending`);
        if (permRes.ok) {
          allPending.push(...(await permRes.json()));
        }
      }
      setPendingPermissions(allPending);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (selectedId) loadPermissions(selectedId);
    else setPendingPermissions([]);
  }, [selectedId, loadPermissions]);

  // WebSocket: auto-refresh on discussion + permission events
  useDiscussionWebSocket(
    useCallback(
      (type: string, id: string) => {
        reloadDiscussions();
        if (selectedId === id) reloadState();
        if (type.startsWith('permission:') && selectedId) {
          loadPermissions(selectedId);
        }
      },
      [selectedId, reloadDiscussions, reloadState, loadPermissions],
    ),
  );

  // Filter discussions for the list
  const filtered = discussions.filter((d) => {
    if (filter === 'open') return d.status === 'open';
    if (filter === 'closed')
      return ['closed', 'consensus', 'stale', 'failed'].includes(d.status);
    return true;
  });

  // --- Handlers ---

  async function handleCreateTeam(data: {
    name: string;
    description?: string;
    consensusRule: ConsensusRule;
    memberAgentIds: string[];
  }) {
    try {
      await createTeam(data);
      reloadTeams();
    } catch (err) {
      console.error('Failed to create team:', err);
    }
  }

  async function handleUpdateTeam(
    id: string,
    data: {
      name: string;
      description?: string;
      consensusRule: ConsensusRule;
      memberAgentIds: string[];
    },
  ) {
    try {
      await updateTeam(id as DiscussionTeamId, {
        ...data,
        memberAgentIds: data.memberAgentIds as AgentId[],
      });
      reloadTeams();
    } catch (err) {
      console.error('Failed to update team:', err);
    }
  }

  async function handleDeleteTeam(id: string) {
    try {
      await deleteTeam(id as DiscussionTeamId);
      reloadTeams();
    } catch (err) {
      console.error('Failed to delete team:', err);
    }
  }

  async function handleCreateDiscussion(data: CreateDiscussionData) {
    try {
      const d = await createDiscussion({
        teamId: data.teamId as DiscussionTeamId,
        title: data.title,
        type: data.type,
        artifact: data.artifact,
        trackId: data.trackId as TrackId | undefined,
        staleAfterMinutes: data.staleAfterMinutes,
        createdByType: 'human',
      });
      setShowNewDiscussion(false);
      reloadDiscussions();
      setSelectedId(d.id);
    } catch (err) {
      console.error('Failed to create discussion:', err);
    }
  }

  async function handlePostMessage(data: {
    messageType: string;
    content: string;
  }) {
    if (!selectedId) return;
    try {
      await postMessage(selectedId as DiscussionId, {
        authorType: 'human',
        messageType: data.messageType,
        content: data.content,
      });
      reloadState();
    } catch (err) {
      console.error('Failed to post message:', err);
    }
  }

  async function handleCastVote(data: { vote: string; comment?: string }) {
    if (!selectedId) return;
    try {
      await castVote(selectedId as DiscussionId, {
        voterType: 'human',
        voterId: 'human',
        voterName: 'Human',
        vote: data.vote as 'satisfied' | 'unsatisfied' | 'abstain',
        comment: data.comment,
      });
      reloadState();
      reloadDiscussions();
    } catch (err) {
      console.error('Failed to cast vote:', err);
    }
  }

  async function handleClose() {
    if (!selectedId) return;
    try {
      await closeDiscussion(selectedId as DiscussionId);
      reloadState();
      reloadDiscussions();
    } catch (err) {
      console.error('Failed to close discussion:', err);
    }
  }

  async function resolvePermission(id: string, decision: 'approved' | 'denied', comment?: string) {
    try {
      await fetch(`/api/permissions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, comment }),
      });
      setPendingPermissions((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error('Failed to resolve permission:', err);
    }
  }

  async function allowAllForSession(sessionId: string) {
    try {
      await fetch(`/api/permissions/sessions/${sessionId}/auto-approve`, { method: 'POST' });
      setPendingPermissions((prev) => prev.filter((p) => p.sessionId !== sessionId));
    } catch (err) {
      console.error('Failed to set auto-approve:', err);
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header bar */}
      <header className="flex items-center gap-4 px-6 py-2 border-b border-gray-800 shrink-0">
        <h1 className="text-lg font-semibold">Discussions</h1>
        <span className="text-xs text-gray-500">
          {discussions.filter((d) => d.status === 'open').length} open
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowTeamManager(true)}
            className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-900 rounded transition-colors"
          >
            Teams
          </button>
          <button
            onClick={() => setShowNewDiscussion(true)}
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
          >
            + New Discussion
          </button>
        </div>
      </header>

      {/* Main content: sidebar + thread */}
      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <div className="w-80 shrink-0 border-r border-gray-800">
          <DiscussionList
            discussions={filtered}
            teams={teams}
            selectedId={selectedId ?? undefined}
            onSelect={setSelectedId}
            filter={filter}
            onFilterChange={setFilter}
          />
        </div>

        {/* Thread panel */}
        <div className="flex-1 min-w-0 flex flex-col">
          <PermissionPanel
            requests={pendingPermissions}
            onResolve={resolvePermission}
            onAllowAllForSession={allowAllForSession}
          />
          {state ? (
            <DiscussionThread
              state={state}
              onPostMessage={handlePostMessage}
              onCastVote={handleCastVote}
              onClose={handleClose}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500 text-sm">
              {discussions.length === 0
                ? 'No discussions yet. Create one to get started.'
                : 'Select a discussion to view its thread.'}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showTeamManager && (
        <TeamManager
          teams={teams}
          agents={agents}
          onCreateTeam={handleCreateTeam}
          onUpdateTeam={handleUpdateTeam}
          onDeleteTeam={handleDeleteTeam}
          onClose={() => setShowTeamManager(false)}
        />
      )}

      {showNewDiscussion && (
        <NewDiscussionModal
          teams={teams}
          tracks={tracks}
          onSubmit={handleCreateDiscussion}
          onClose={() => setShowNewDiscussion(false)}
        />
      )}
    </div>
  );
}
