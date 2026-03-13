import { useEffect, useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import type { Todo, TodoStatus, Track, SessionProvider } from '@foundation/types';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { TodoDetailModal } from './TodoDetailModal';

const COLUMNS: { status: TodoStatus; label: string; color: string }[] = [
  { status: 'backlog', label: 'Backlog', color: 'bg-gray-500' },
  { status: 'ready', label: 'Ready', color: 'bg-blue-500' },
  { status: 'in-progress', label: 'In Progress', color: 'bg-amber-500' },
  { status: 'review', label: 'Review', color: 'bg-purple-500' },
  { status: 'done', label: 'Done', color: 'bg-green-500' },
];

export function KanbanBoard() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [filterTrackId, setFilterTrackId] = useState<string>('');
  const [activeDrag, setActiveDrag] = useState<Todo | null>(null);
  const [selectedTodo, setSelectedTodo] = useState<Todo | null>(null);
  const [loading, setLoading] = useState(true);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const loadData = useCallback(async () => {
    try {
      const [todosRes, tracksRes] = await Promise.all([
        fetch('/api/todos'),
        fetch('/api/tracks'),
      ]);
      if (todosRes.ok) setTodos(await todosRes.json());
      if (tracksRes.ok) setTracks(await tracksRes.json());
    } catch (err) {
      console.error('Failed to load kanban data:', err);
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
        if (event.type?.startsWith('todo:')) {
          loadData();
        }
      } catch {
        // ignore
      }
    };
    return () => ws.close();
  }, [loadData]);

  const trackNames = Object.fromEntries(tracks.map((t) => [t.id, t.name]));

  const filteredTodos = filterTrackId
    ? todos.filter((t) => t.trackId === filterTrackId)
    : todos;

  const todosByStatus = (status: TodoStatus) =>
    filteredTodos.filter((t) => t.status === status);

  function handleDragStart(event: DragStartEvent) {
    const todo = todos.find((t) => t.id === event.active.id);
    setActiveDrag(todo || null);
  }

  function handleDragOver(_event: DragOverEvent) {
    // Optional: could do optimistic column previews here
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;

    const todoId = active.id as string;
    const todo = todos.find((t) => t.id === todoId);
    if (!todo) return;

    // Determine target status: drop onto column or onto another card
    let targetStatus: TodoStatus | null = null;

    // Check if dropped on a column directly
    if (COLUMNS.some((c) => c.status === over.id)) {
      targetStatus = over.id as TodoStatus;
    } else {
      // Dropped on another card — find that card's status
      const targetTodo = todos.find((t) => t.id === over.id);
      if (targetTodo) {
        targetStatus = targetTodo.status;
      }
    }

    if (!targetStatus || targetStatus === todo.status) return;

    // Optimistic update
    setTodos((prev) =>
      prev.map((t) => (t.id === todoId ? { ...t, status: targetStatus! } : t)),
    );

    try {
      await fetch(`/api/todos/${todoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStatus }),
      });
    } catch {
      // Rollback on failure
      loadData();
    }
  }

  async function handleSaveTodo(todoId: string, data: Partial<Todo>) {
    await fetch(`/api/todos/${todoId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setSelectedTodo(null);
    loadData();
  }

  async function handleDeleteTodo(todoId: string) {
    await fetch(`/api/todos/${todoId}`, { method: 'DELETE' });
    setSelectedTodo(null);
    loadData();
  }

  async function handleDispatchTodo(todoId: string, agentId?: string, provider?: SessionProvider) {
    await fetch(`/api/todos/${todoId}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, provider }),
    });
    setSelectedTodo(null);
    loadData();
  }

  if (loading) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-4 px-6 py-2 border-b border-gray-800 shrink-0">
        <h1 className="text-lg font-semibold">Kanban</h1>
        <span className="text-xs text-gray-500">{filteredTodos.length} todos</span>
        <div className="ml-auto flex items-center gap-3">
          <select
            value={filterTrackId}
            onChange={(e) => setFilterTrackId(e.target.value)}
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300"
          >
            <option value="">All tracks</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </header>

      <div className="flex-1 overflow-x-auto p-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 h-full">
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.status}
                status={col.status}
                label={col.label}
                color={col.color}
                todos={todosByStatus(col.status)}
                trackNames={trackNames}
                onCardClick={setSelectedTodo}
              />
            ))}
          </div>

          <DragOverlay>
            {activeDrag ? (
              <KanbanCard
                todo={activeDrag}
                trackName={trackNames[activeDrag.trackId]}
                onClick={() => {}}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {selectedTodo && (
        <TodoDetailModal
          todo={selectedTodo}
          tracks={tracks}
          onClose={() => setSelectedTodo(null)}
          onSave={handleSaveTodo}
          onDelete={handleDeleteTodo}
          onDispatch={handleDispatchTodo}
        />
      )}
    </div>
  );
}
