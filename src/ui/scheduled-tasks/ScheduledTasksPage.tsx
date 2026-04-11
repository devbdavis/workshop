import { useEffect, useState, useCallback } from 'react';
import type { ScheduledTask, Track, Agent, ScheduleConfig } from '@foundation/types';
import { ScheduledTaskCard } from './ScheduledTaskCard';
import { ScheduledTaskForm } from './ScheduledTaskForm';

interface ScheduleTemplate {
  name: string;
  description?: string;
  scheduleConfig: ScheduleConfig;
  scheduleDescription: string;
  taskPrompt: string;
}

const HIDDEN_KEY = 'workshop:hidden-schedule-templates';

function getHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    return new Set(raw ? JSON.parse(raw) as string[] : []);
  } catch { return new Set(); }
}

function saveHidden(s: Set<string>) {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s]));
}

export function ScheduledTasksPage() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(getHidden);
  const [showTemplates, setShowTemplates] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all');

  const loadData = useCallback(async () => {
    try {
      const [tasksRes, tracksRes, agentsRes, templatesRes] = await Promise.all([
        fetch('/api/scheduled-tasks'),
        fetch('/api/tracks'),
        fetch('/api/agents'),
        fetch('/api/scheduled-tasks/templates'),
      ]);
      if (tasksRes.ok) setTasks(await tasksRes.json());
      if (tracksRes.ok) setTracks(await tracksRes.json());
      if (agentsRes.ok) setAgents(await agentsRes.json());
      if (templatesRes.ok) setTemplates(await templatesRes.json());
    } catch (err) {
      console.error('Failed to load scheduled tasks:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // WebSocket for real-time updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data);
        if (event.type?.startsWith('scheduled-task:')) loadData();
      } catch { /* ignore */ }
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

  async function handleSyncFromTemplate(taskId: string) {
    await fetch(`/api/scheduled-tasks/${taskId}/sync-from-template`, { method: 'POST' });
    loadData();
  }

  async function handleSaveAsTemplate(taskId: string) {
    await fetch(`/api/scheduled-tasks/${taskId}/save-as-template`, { method: 'POST' });
    loadData();
  }

  async function handleAddTemplate(template: ScheduleTemplate) {
    await fetch('/api/scheduled-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: template.name,
        description: template.description,
        scheduleConfig: template.scheduleConfig,
        taskPrompt: template.taskPrompt,
        enabled: false,
        templateName: template.name,
      }),
    });
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

  function hideTemplate(name: string) {
    const next = new Set(hidden);
    next.add(name);
    setHidden(next);
    saveHidden(next);
  }

  if (loading) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  const trackNames = Object.fromEntries(tracks.map((t) => [t.id, t.name]));
  const agentNames = Object.fromEntries(agents.map((a) => [a.id, a.name]));

  const visibleTemplates = templates.filter((t) => !hidden.has(t.name));
  const hiddenCount = templates.filter((t) => hidden.has(t.name)).length;

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
                onSyncFromTemplate={task.isOutOfSync ? () => handleSyncFromTemplate(task.id) : undefined}
              />
            ))}
          </div>
        )}

        {/* Templates section — always below real tasks */}
        {templates.length > 0 && (
          <div className="mt-8 max-w-4xl">
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className="w-full flex items-center justify-between text-left group mb-2"
            >
              <span className="text-xs text-gray-500 uppercase tracking-wider group-hover:text-gray-300 transition-colors">
                Templates
                <span className="ml-2 normal-case text-gray-600">
                  ({visibleTemplates.length} available{hiddenCount > 0 ? `, ${hiddenCount} hidden` : ''})
                </span>
              </span>
              <svg
                className={`w-4 h-4 text-gray-600 transition-transform ${showTemplates ? 'rotate-180' : ''}`}
                viewBox="0 0 20 20" fill="currentColor"
              >
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>

            {showTemplates && (
              <div className="grid gap-2">
                {visibleTemplates.length === 0 && (
                  <p className="text-xs text-gray-600 italic">All templates are hidden.</p>
                )}
                {visibleTemplates.map((t) => (
                  <div
                    key={t.name}
                    className="flex items-center gap-4 px-4 py-3 rounded-lg bg-gray-900/50 border border-gray-800/50"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-gray-300">{t.name}</span>
                      {t.description && (
                        <span className="ml-2 text-xs text-gray-500">{t.description}</span>
                      )}
                      <span className="ml-2 text-xs text-gray-600">&mdash; {t.scheduleDescription}</span>
                    </div>
                    <button
                      onClick={() => handleAddTemplate(t)}
                      className="shrink-0 px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
                    >
                      + Add
                    </button>
                    <button
                      onClick={() => hideTemplate(t.name)}
                      className="shrink-0 text-xs text-gray-600 hover:text-gray-400 transition-colors"
                      title="Hide this template"
                    >
                      Hide
                    </button>
                  </div>
                ))}
                {hiddenCount > 0 && (
                  <button
                    onClick={() => { setHidden(new Set()); saveHidden(new Set()); }}
                    className="text-xs text-gray-600 hover:text-gray-400 transition-colors text-left mt-1"
                  >
                    Show {hiddenCount} hidden template{hiddenCount !== 1 ? 's' : ''}
                  </button>
                )}
              </div>
            )}
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
          onSaveAsTemplate={editingTask ? () => handleSaveAsTemplate(editingTask.id) : undefined}
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
