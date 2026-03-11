import { useState } from 'react';
import type { Todo, TodoPriority, TodoStatus } from '@foundation/types';

interface Props {
  trackId: string;
  todos: Todo[];
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

export function TodoPanel({ trackId, todos, onUpdate }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const activeTodos = todos.filter((t) => t.status !== 'done');

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

  async function dispatchTodo(todoId: string) {
    await fetch(`/api/todos/${todoId}/dispatch`, { method: 'POST' });
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

  return (
    <div className="p-4 border-b border-gray-800">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-300">
          Todos
          {activeTodos.length > 0 && (
            <span className="ml-1.5 text-xs font-normal text-gray-500">({activeTodos.length})</span>
          )}
        </h3>
        <button onClick={() => setShowAdd(!showAdd)} className="text-xs text-blue-400 hover:text-blue-300">
          + Add
        </button>
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
                    <span className="text-gray-200 truncate">{todo.title}</span>
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
                      <button
                        onClick={() => dispatchTodo(todo.id)}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-green-900 text-green-300 hover:bg-green-800"
                      >
                        Dispatch
                      </button>
                    )}
                    {todo.sessionId && (
                      <span className="text-[10px] text-emerald-500">agent</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => deleteTodo(todo.id)}
                  className="text-xs text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 shrink-0 ml-2"
                >
                  x
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-gray-600 italic">No active todos.</p>
      )}
    </div>
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
