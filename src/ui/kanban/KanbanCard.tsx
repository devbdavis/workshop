import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Todo, TodoPriority } from '@foundation/types';

interface Props {
  todo: Todo;
  trackName?: string;
  onClick: (todo: Todo) => void;
}

const PRIORITY_STYLES: Record<TodoPriority, { border: string; badge: string; label: string }> = {
  high: { border: 'border-l-red-500', badge: 'bg-red-900/50 text-red-300', label: 'High' },
  medium: { border: 'border-l-yellow-500', badge: 'bg-yellow-900/50 text-yellow-300', label: 'Med' },
  low: { border: 'border-l-gray-600', badge: 'bg-gray-800 text-gray-400', label: 'Low' },
};

export function KanbanCard({ todo, trackName, onClick }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: todo.id,
    data: { type: 'todo', todo },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const ps = PRIORITY_STYLES[todo.priority];

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(todo)}
      className={`p-3 bg-gray-900 border border-gray-800 border-l-2 ${ps.border} rounded-lg cursor-grab active:cursor-grabbing hover:border-gray-600 transition-colors`}
    >
      <p className="text-sm text-gray-200 font-medium leading-snug mb-2">{todo.title}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        {trackName && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 truncate max-w-[120px]">
            {trackName}
          </span>
        )}
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${ps.badge}`}>{ps.label}</span>
        {todo.refined && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-300">
            Refined
          </span>
        )}
        {todo.sessionId && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Agent
          </span>
        )}
      </div>
    </div>
  );
}
