import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorkflowTicket, Track } from '@foundation/types.js';
import { CreateEpicModal, type CreateEpicData } from './CreateEpicModal.js';
import { EpicList, type FilterTab } from './EpicList.js';
import { PlaybookLibrary } from './PlaybookLibrary.js';

type SubTab = 'epics' | 'playbooks';

export function WorkflowPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<SubTab>('epics');
  const [epics, setEpics] = useState<WorkflowTicket[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Also fetch all tasks so we can surface child-level human gates on epics
  const [allTasks, setAllTasks] = useState<WorkflowTicket[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [epicsRes, tracksRes, tasksRes] = await Promise.all([
        fetch('/api/workflow/tickets?type=epic'),
        fetch('/api/tracks'),
        fetch('/api/workflow/tickets?type=task'),
      ]);
      if (epicsRes.ok) setEpics(await epicsRes.json());
      if (tracksRes.ok) setTracks(await tracksRes.json());
      if (tasksRes.ok) setAllTasks(await tasksRes.json());
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
            onClick={() => setActiveTab('playbooks')}
            className={`px-4 py-1.5 text-xs rounded-md transition-colors ${
              activeTab === 'playbooks'
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Playbooks
          </button>
        </div>
      </header>

      {activeTab === 'epics' && (
        <EpicList
          epics={epics}
          tracks={tracks}
          allTasks={allTasks}
          filter={filter}
          onFilterChange={setFilter}
          onEpicClick={(id) => navigate(`/workflow/${id}`)}
          onCreateClick={() => setShowCreateForm(true)}
        />
      )}

      {activeTab === 'playbooks' && (
        <div className="flex-1 overflow-y-auto">
          <PlaybookLibrary />
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
