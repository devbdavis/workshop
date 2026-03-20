import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorkflowTicket, Track } from '@foundation/types';
import { CreateEpicModal, type CreateEpicData } from './CreateEpicModal.js';
import { EpicList, type FilterTab } from './EpicList.js';
import { StateDiagram } from './StateDiagram.js';

type SubTab = 'epics' | 'flow';

export function WorkflowPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<SubTab>('epics');
  const [epics, setEpics] = useState<WorkflowTicket[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [epicsRes, tracksRes] = await Promise.all([
        fetch('/api/workflow/tickets?type=epic'),
        fetch('/api/tracks'),
      ]);
      if (epicsRes.ok) setEpics(await epicsRes.json());
      if (tracksRes.ok) setTracks(await tracksRes.json());
    } catch (err) {
      console.error('Failed to load workflow data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // WebSocket for real-time updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data);
        if (event.type?.startsWith('workflow:')) loadData();
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }, [loadData]);

  async function handleCreate(data: CreateEpicData) {
    const isFromPlan = !!data.planDraft;
    const endpoint = isFromPlan ? '/api/workflow/tickets/from-plan' : '/api/workflow/tickets';
    const body = isFromPlan
      ? {
          title: data.title,
          description: data.description,
          planDraft: data.planDraft,
          trackId: data.trackId,
          priority: data.priority,
          provider: data.provider,
        }
      : { type: 'epic', ...data };

    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setShowCreateForm(false);
    loadData();
  }

  if (loading) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-4 px-6 py-2 border-b border-gray-800 shrink-0">
        <h1 className="text-lg font-semibold">Workflow</h1>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('epics')}
            className={`px-4 py-1.5 text-xs rounded-md transition-colors ${
              activeTab === 'epics'
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Epics
          </button>
          <button
            onClick={() => setActiveTab('flow')}
            className={`px-4 py-1.5 text-xs rounded-md transition-colors ${
              activeTab === 'flow'
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Flow Diagram
          </button>
        </div>
        {activeTab === 'flow' && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="ml-auto px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
          >
            + New Epic
          </button>
        )}
      </header>

      {activeTab === 'epics' ? (
        <EpicList
          epics={epics}
          tracks={tracks}
          filter={filter}
          onFilterChange={setFilter}
          onEpicClick={(id) => navigate(`/workflow/${id}`)}
          onCreateClick={() => setShowCreateForm(true)}
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6 max-w-4xl">
            <div>
              <h3 className="text-sm font-semibold mb-1">Epic Workflow</h3>
              <p className="text-xs text-gray-500 mb-3">
                States, transitions, and agent assignments for the epic lifecycle.
              </p>
              <StateDiagram ticketType="epic" />
            </div>
            <div className="border-t border-gray-800 pt-6">
              <h3 className="text-sm font-semibold mb-1">Task Workflow</h3>
              <p className="text-xs text-gray-500 mb-3">
                States and transitions for individual tasks within an epic.
              </p>
              <StateDiagram ticketType="task" />
            </div>
          </div>
        </div>
      )}

      {showCreateForm && (
        <CreateEpicModal
          tracks={tracks}
          onSave={handleCreate}
          onClose={() => setShowCreateForm(false)}
        />
      )}
    </div>
  );
}
