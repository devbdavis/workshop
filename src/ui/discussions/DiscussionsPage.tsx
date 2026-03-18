import { useState, useCallback, useEffect } from 'react';
import type { ConsensusRule, DiscussionId, DiscussionTeamId } from '@foundation/discussion-types';
import type { Agent, AgentId, Track, TrackId } from '@foundation/types';
import { DiscussionList } from './DiscussionList';
import { DiscussionThread } from './DiscussionThread';
import { TeamManager } from './TeamManager';
import { NewDiscussionModal } from './NewDiscussionModal';
import type { CreateDiscussionData } from './NewDiscussionModal';
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

  // WebSocket: auto-refresh on discussion events
  useDiscussionWebSocket(
    useCallback(
      (_type: string, id: string) => {
        reloadDiscussions();
        if (selectedId === id) reloadState();
      },
      [selectedId, reloadDiscussions, reloadState],
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
        <div className="flex-1 min-w-0">
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
