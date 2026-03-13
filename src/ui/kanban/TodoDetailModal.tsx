import { useState, useEffect } from 'react';
import type { Todo, TodoStatus, TodoPriority, Track, Agent } from '@foundation/types';
import { DispatchDropdown, type DispatchOptions } from '../track-view/DispatchDropdown';

interface Props {
  todo: Todo | null;
  tracks: Track[];
  onClose: () => void;
  onSave: (todoId: string, data: Partial<Todo>) => void;
  onDelete: (todoId: string) => void;
  onDispatch: (todoId: string, opts: DispatchOptions) => void;
}

const STATUSES: { value: TodoStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'ready', label: 'Ready' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
];

const PRIORITIES: { value: TodoPriority; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export function TodoDetailModal({ todo, tracks, onClose, onSave, onDelete, onDispatch }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TodoStatus>('backlog');
  const [priority, setPriority] = useState<TodoPriority>('medium');
  const [refined, setRefined] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showDispatch, setShowDispatch] = useState(false);

  useEffect(() => {
    if (todo) {
      setTitle(todo.title);
      setDescription(todo.description || '');
      setStatus(todo.status);
      setPriority(todo.priority);
      setRefined(todo.refined);
      setShowDispatch(false);
    }
  }, [todo]);

  // Load agents when dispatch might be needed
  useEffect(() => {
    if (!todo) return;
    fetch('/api/agents')
      .then((res) => res.json())
      .then(setAgents)
      .catch(() => {});
  }, [todo]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  if (!todo) return null;

  const trackName = tracks.find((t) => t.id === todo.trackId)?.name || 'Unknown';
  const canDispatch = refined && (status === 'ready' || status === 'backlog');

  function handleSave() {
    onSave(todo!.id, { title, description: description || undefined, status, priority, refined });
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-[80vw] h-[80vh] mx-4 overflow-hidden resize flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 shrink-0">
          <h2 className="text-sm font-semibold text-gray-200">Edit Todo</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">&times;</button>
        </div>

        <div className="p-5 space-y-4 flex-1 overflow-y-auto">
          <div className="text-xs text-gray-500">
            Track: <span className="text-gray-300">{trackName}</span>
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1">Description / Task Prompt</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 font-mono"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-xs text-gray-400 block mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TodoStatus)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm"
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-400 block mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TodoPriority)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="refined"
              checked={refined}
              onChange={(e) => setRefined(e.target.checked)}
              className="rounded border-gray-600 bg-gray-800"
            />
            <label htmlFor="refined" className="text-sm text-gray-300">
              Refined (ready for agent dispatch)
            </label>
          </div>

          {todo.sessionId && (
            <div className="text-xs text-emerald-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Agent session active
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800 shrink-0">
          <button
            onClick={() => onDelete(todo.id)}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Delete
          </button>
          <div className="flex gap-2">
            {canDispatch && (
              <div className="relative">
                <button
                  onClick={() => setShowDispatch(!showDispatch)}
                  className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded-lg transition-colors"
                >
                  Dispatch to Agent
                </button>
                {showDispatch && (
                  <DispatchDropdown
                    agents={agents}
                    popUp
                    onSelect={(opts) => {
                      setShowDispatch(false);
                      onDispatch(todo.id, opts);
                    }}
                    onClose={() => setShowDispatch(false)}
                  />
                )}
              </div>
            )}
            <button
              onClick={handleSave}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
