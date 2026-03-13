import { useEffect, useState, useCallback } from 'react';
import type { ScheduledTask, Track, Agent } from '@foundation/types';
import { ScheduledTaskCard } from './ScheduledTaskCard';
import { ScheduledTaskForm } from './ScheduledTaskForm';

export function ScheduledTasksPage() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all');

  const loadData = useCallback(async () => {
    try {
      const [tasksRes, tracksRes, agentsRes] = await Promise.all([
        fetch('/api/scheduled-tasks'),
        fetch('/api/tracks'),
        fetch('/api/agents'),
      ]);
      if (tasksRes.ok) setTasks(await tasksRes.json());
      if (tracksRes.ok) setTracks(await tracksRes.json());
      if (agentsRes.ok) setAgents(await agentsRes.json());
    } catch (err) {
      console.error('Failed to load scheduled tasks:', err);
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
        if (event.type?.startsWith('scheduled-task:')) {
          loadData();
        }
      } catch {
        // ignore
      }
    };
    return () => ws.close();
  }, [loadData]);

  const filtered = tasks.filter((t) => {
    if (filter === 'enabled') return t.enabled;
    if (filter === 'disabled') return !t.enabled;
    return true;
  });

  async function handleToggle(taskId: string) {
    await fetch(`/api/scheduled-tasks/${taskId}/toggle`, { method: 'POST' });
    loadData();
  }

  async function handleTrigger(taskId: string) {
    await fetch(`/api/scheduled-tasks/${taskId}/trigger`, { method: 'POST' });
    loadData();
  }

  async function handleDelete(taskId: string) {
    await fetch(`/api/scheduled-tasks/${taskId}`, { method: 'DELETE' });
    loadData();
  }

  async function handleSave(data: Record<string, unknown>) {
    if (editingTask) {
      await fetch(`/api/scheduled-tasks/${editingTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } else {
      await fetch('/api/scheduled-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    }
    setShowForm(false);
    setEditingTask(null);
    loadData();
  }

  if (loading) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  const trackNames = Object.fromEntries(tracks.map((t) => [t.id, t.name]));
  const agentNames = Object.fromEntries(agents.map((a) => [a.id, a.name]));

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-4 px-6 py-2 border-b border-gray-800 shrink-0">
        <h1 className="text-lg font-semibold">Schedules</h1>
        <span className="text-xs text-gray-500">
          {tasks.filter((t) => t.enabled).length} active
        </span>
        <div className="ml-auto flex items-center gap-2">
          <FilterButton label="All" value="all" current={filter} onChange={setFilter} />
          <FilterButton label="Enabled" value="enabled" current={filter} onChange={setFilter} />
          <FilterButton label="Disabled" value="disabled" current={filter} onChange={setFilter} />
          <button
            onClick={() => {
              setEditingTask(null);
              setShowForm(true);
            }}
            className="ml-2 px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
          >
            + New Schedule
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            {tasks.length === 0
              ? 'No scheduled tasks yet. Create one to get started.'
              : 'No tasks match the current filter.'}
          </div>
        ) : (
          <div className="grid gap-4 max-w-4xl">
            {filtered.map((task) => (
              <ScheduledTaskCard
                key={task.id}
                task={task}
                trackName={task.trackId ? trackNames[task.trackId] : undefined}
                agentName={task.agentId ? agentNames[task.agentId] : undefined}
                onToggle={() => handleToggle(task.id)}
                onTrigger={() => handleTrigger(task.id)}
                onEdit={() => {
                  setEditingTask(task);
                  setShowForm(true);
                }}
                onDelete={() => handleDelete(task.id)}
              />
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <ScheduledTaskForm
          task={editingTask}
          tracks={tracks}
          agents={agents}
          onSave={handleSave}
          onClose={() => {
            setShowForm(false);
            setEditingTask(null);
          }}
        />
      )}
    </div>
  );
}

function FilterButton({
  label,
  value,
  current,
  onChange,
}: {
  label: string;
  value: 'all' | 'enabled' | 'disabled';
  current: string;
  onChange: (v: 'all' | 'enabled' | 'disabled') => void;
}) {
  const isActive = value === current;
  return (
    <button
      onClick={() => onChange(value)}
      className={`px-2.5 py-1 text-xs rounded transition-colors ${
        isActive
          ? 'bg-gray-800 text-gray-200'
          : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'
      }`}
    >
      {label}
    </button>
  );
}
