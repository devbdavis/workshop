import { useEffect, useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  rectIntersection,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type CollisionDetection,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import type { Todo, TodoStatus, Track } from '@foundation/types';
import type { DispatchOptions } from '../track-view/DispatchDropdown';
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

const COLUMN_IDS = new Set(['backlog', 'ready', 'in-progress', 'review', 'done']);

export function KanbanBoard() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [filterTrackId, setFilterTrackId] = useState<string>('');
  const [activeDrag, setActiveDrag] = useState<Todo | null>(null);
  const [selectedTodo, setSelectedTodo] = useState<Todo | null>(null);
  const [loading, setLoading] = useState(true);

  // Cards win over columns for precise within-column reordering.
  // The source column is excluded so you can't accidentally drop back into it;
  // all other columns remain valid targets anywhere on their body.
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const sourceStatus = activeDrag?.status;
    const cardHits = pointerWithin(args).filter((h) => !COLUMN_IDS.has(String(h.id)));
    if (cardHits.length > 0) return cardHits;
    const colHits = pointerWithin(args).filter(
      (h) => COLUMN_IDS.has(String(h.id)) && h.id !== sourceStatus,
    );
    if (colHits.length > 0) return colHits;
    return rectIntersection(args).filter(
      (h) => !COLUMN_IDS.has(String(h.id)) || h.id !== sourceStatus,
    );
  }, [activeDrag]);

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
    filteredTodos
      .filter((t) => t.status === status)
      .sort((a, b) => a.sortOrder - b.sortOrder || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

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
    if (!over || active.id === over.id) return;

    const todoId = active.id as string;
    const todo = todos.find((t) => t.id === todoId);
    if (!todo) return;

    const isColumnDrop = COLUMNS.some((c) => c.status === over.id);
    const targetTodo = !isColumnDrop ? todos.find((t) => t.id === over.id) : null;
    const targetStatus: TodoStatus = isColumnDrop
      ? (over.id as TodoStatus)
      : (targetTodo?.status ?? todo.status);

    if (targetStatus !== todo.status) {
      // Cross-column: update status only
      setTodos((prev) =>
        prev.map((t) => (t.id === todoId ? { ...t, status: targetStatus } : t)),
      );
      try {
        await fetch(`/api/todos/${todoId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: targetStatus }),
        });
      } catch {
        loadData();
      }
    } else if (!isColumnDrop && targetTodo) {
      // Same-column: reorder
      const columnTodos = todos
        .filter((t) => t.status === todo.status)
        .sort((a, b) => a.sortOrder - b.sortOrder || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const oldIndex = columnTodos.findIndex((t) => t.id === todoId);
      const newIndex = columnTodos.findIndex((t) => t.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(columnTodos, oldIndex, newIndex);
      const updates = reordered.map((t, i) => ({ id: t.id, sortOrder: i }));

      // Optimistic update
      setTodos((prev) => {
        const orderMap = new Map(updates.map((u) => [u.id, u.sortOrder]));
        return prev.map((t) => (orderMap.has(t.id) ? { ...t, sortOrder: orderMap.get(t.id)! } : t));
      });

      try {
        await fetch('/api/todos/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates }),
        });
      } catch {
        loadData();
      }
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

  async function handleDispatchTodo(todoId: string, opts: DispatchOptions) {
    await fetch(`/api/todos/${todoId}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
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
          collisionDetection={collisionDetection}
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
