import { useState, useEffect } from 'react';
import type { Todo, TodoPriority, TodoStatus, Session, Agent, Track } from '@foundation/types';
import { TerminalModal } from './TerminalModal';
import { TodoDetailModal } from '../kanban/TodoDetailModal';
import { ImportFromLinearModal } from '../kanban/ImportFromLinearModal';
import { DispatchDropdown, type DispatchOptions } from './DispatchDropdown';

interface Props {
  track: Track;
  todos: Todo[];
  sessions: Session[];
  onUpdate: () => void;
}

const STATUS_LABELS: Record<TodoStatus, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  'in-progress': 'Active',
  review: 'Review',
  done: 'Done',
};

const STATUS_COLORS: Record<TodoStatus, string> = {
  backlog: 'bg-gray-700 text-gray-300',
  ready: 'bg-blue-900 text-blue-300',
  'in-progress': 'bg-amber-900 text-amber-300',
  review: 'bg-purple-900 text-purple-300',
  done: 'bg-green-900 text-green-300',
};

const PRIORITY_COLORS: Record<TodoPriority, string> = {
  low: 'text-gray-500',
  medium: 'text-yellow-500',
  high: 'text-red-400',
};

export function TodoPanel({ track, todos, sessions, onUpdate }: Props) {
  const trackId = track.id;
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [terminalSessionId, setTerminalSessionId] = useState<string | null>(null);
  const [terminalTodoTitle, setTerminalTodoTitle] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [dispatchingTodoId, setDispatchingTodoId] = useState<string | null>(null);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const activeTodos = todos.filter((t) => t.status !== 'done');

  // Build a set of active session IDs for quick lookup
  const activeSessionIds = new Set(
    sessions.filter((s) => s.state === 'active' && s.background).map((s) => s.id),
  );

  // Load agents on mount
  useEffect(() => {
    fetch('/api/agents')
      .then((res) => res.json())
      .then(setAgents)
      .catch((err) => console.error('Failed to load agents:', err));
  }, []);

  async function deleteTodo(todoId: string) {
    await fetch(`/api/todos/${todoId}`, { method: 'DELETE' });
    onUpdate();
  }

  async function updateStatus(todoId: string, status: TodoStatus) {
    await fetch(`/api/todos/${todoId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    onUpdate();
  }

  async function dispatchTodo(todoId: string, opts: DispatchOptions) {
    await fetch(`/api/todos/${todoId}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    setDispatchingTodoId(null);
    onUpdate();
  }

  async function addTodo(title: string, description: string, priority: TodoPriority) {
    await fetch(`/api/tracks/${trackId}/todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, priority }),
    });
    setShowAdd(false);
    onUpdate();
  }

  async function saveTodo(todoId: string, data: Partial<Todo>) {
    await fetch(`/api/todos/${todoId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setEditingTodo(null);
    onUpdate();
  }

  async function dispatchTodoFromModal(todoId: string, opts: DispatchOptions) {
    await fetch(`/api/todos/${todoId}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    setEditingTodo(null);
    onUpdate();
  }

  return (
    <div className="p-4 border-b border-gray-800">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-300">
          Todos
          {activeTodos.length > 0 && (
            <span className="ml-1.5 text-xs font-normal text-gray-500">({activeTodos.length})</span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowImport(true)} className="text-xs text-blue-400 hover:text-blue-300">
            Import from Linear
          </button>
          <button onClick={() => setShowAdd(!showAdd)} className="text-xs text-blue-400 hover:text-blue-300">
            + Add
          </button>
        </div>
      </div>

      {showAdd && <AddTodoForm onAdd={addTodo} onCancel={() => setShowAdd(false)} />}

      {activeTodos.length > 0 ? (
        <ul className="space-y-2">
          {activeTodos.map((todo) => (
            <li key={todo.id} className="group text-sm">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs ${PRIORITY_COLORS[todo.priority]}`}>
                      {todo.priority === 'high' ? '!!!' : todo.priority === 'medium' ? '!!' : '!'}
                    </span>
                    <button
                      onClick={() => setEditingTodo(todo)}
                      className="text-gray-200 truncate text-left hover:text-blue-300 transition-colors"
                    >
                      {todo.title}
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <button
                      onClick={() => {
                        const statuses: TodoStatus[] = ['backlog', 'ready', 'in-progress', 'review', 'done'];
                        const idx = statuses.indexOf(todo.status);
                        if (idx < statuses.length - 1) updateStatus(todo.id, statuses[idx + 1]);
                      }}
                      className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_COLORS[todo.status]} hover:opacity-80`}
                    >
                      {STATUS_LABELS[todo.status]}
                    </button>
                    {todo.refined && todo.status === 'ready' && (
                      <div className="relative">
                        <button
                          onClick={() => setDispatchingTodoId(dispatchingTodoId === todo.id ? null : todo.id)}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-green-900 text-green-300 hover:bg-green-800"
                        >
                          Dispatch
                        </button>
                        {dispatchingTodoId === todo.id && (
                          <DispatchDropdown
                            agents={agents}
                            defaultAgent={agents.find((a) => a.id === track.defaultAgentId)}
                            onSelect={(opts) => dispatchTodo(todo.id, opts)}
                            onClose={() => setDispatchingTodoId(null)}
                          />
                        )}
                      </div>
                    )}
                    {todo.sessionId && activeSessionIds.has(todo.sessionId) ? (
                      <button
                        onClick={() => {
                          setTerminalSessionId(todo.sessionId!);
                          setTerminalTodoTitle(todo.title);
                        }}
                        className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5"
                        title="Open agent terminal"
                      >
                        <TerminalIcon className="w-3 h-3" />
                        <span>agent</span>
                      </button>
                    ) : todo.sessionId ? (
                      <span className="text-[10px] text-gray-500">agent</span>
                    ) : null}
                  </div>
                </div>
                {confirmDeleteId === todo.id ? (
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <button
                      onClick={() => { deleteTodo(todo.id); setConfirmDeleteId(null); }}
                      className="text-[10px] px-1.5 py-0.5 bg-red-700 hover:bg-red-600 text-white rounded transition-colors"
                      autoFocus
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-[10px] px-1.5 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(todo.id)}
                    className="text-xs text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 shrink-0 ml-2"
                  >
                    x
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-gray-600 italic">No active todos.</p>
      )}

      {terminalSessionId && (
        <TerminalModal
          trackId={trackId}
          sessionId={terminalSessionId}
          title={`Agent: ${terminalTodoTitle}`}
          onClose={() => setTerminalSessionId(null)}
        />
      )}

      {showImport && (
        <ImportFromLinearModal
          tracks={[track]}
          onClose={() => setShowImport(false)}
          onImported={onUpdate}
        />
      )}

      <TodoDetailModal
        todo={editingTodo}
        tracks={[track]}
        onClose={() => setEditingTodo(null)}
        onSave={saveTodo}
        onDelete={(todoId) => {
          deleteTodo(todoId);
          setEditingTodo(null);
        }}
        onDispatch={dispatchTodoFromModal}
      />
    </div>
  );
}

/** Inline terminal SVG icon */
function TerminalIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M7 9l3 3-3 3" />
      <path d="M13 15h4" />
    </svg>
  );
}

function AddTodoForm({
  onAdd,
  onCancel,
}: {
  onAdd: (title: string, description: string, priority: TodoPriority) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TodoPriority>('medium');

  return (
    <div className="mb-3 space-y-2 p-2 bg-gray-800/50 rounded">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Todo title..."
        className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs"
        autoFocus
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description / task prompt..."
        className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs"
        rows={2}
      />
      <div className="flex gap-2 items-center">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TodoPriority)}
          className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <button
          onClick={() => title.trim() && onAdd(title.trim(), description.trim(), priority)}
          className="text-xs text-blue-400"
        >
          Add
        </button>
        <button onClick={onCancel} className="text-xs text-gray-500">
          Cancel
        </button>
      </div>
    </div>
  );
}

