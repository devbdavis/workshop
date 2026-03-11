import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Todo, TodoStatus } from '@foundation/types';
import { KanbanCard } from './KanbanCard';

interface Props {
  status: TodoStatus;
  label: string;
  color: string;
  todos: Todo[];
  trackNames: Record<string, string>;
  onCardClick: (todo: Todo) => void;
}

export function KanbanColumn({ status, label, color, todos, trackNames, onCardClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col w-72 shrink-0 rounded-xl bg-gray-900/50 ${isOver ? 'ring-2 ring-blue-500/40' : ''}`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-800">
        <span className={`w-2 h-2 rounded-full ${color}`} />
        <h3 className="text-sm font-semibold text-gray-300">{label}</h3>
        <span className="text-xs text-gray-600 ml-auto">{todos.length}</span>
      </div>

      <SortableContext items={todos.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[200px]">
          {todos.map((todo) => (
            <KanbanCard
              key={todo.id}
              todo={todo}
              trackName={trackNames[todo.trackId]}
              onClick={onCardClick}
            />
          ))}
          {todos.length === 0 && (
            <div className="flex items-center justify-center h-20 text-xs text-gray-600 italic">
              No items
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}
