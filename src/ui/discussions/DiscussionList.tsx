import type {
  Discussion,
  DiscussionStatus,
  DiscussionTeam,
} from '@foundation/discussion-types';

interface DiscussionListProps {
  discussions: Discussion[];
  teams: DiscussionTeam[];
  selectedId?: string;
  onSelect: (id: string) => void;
  filter: 'all' | 'open' | 'closed';
  onFilterChange: (f: 'all' | 'open' | 'closed') => void;
}

const FILTER_TABS: { value: DiscussionListProps['filter']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
];

const STATUS_STYLES: Record<DiscussionStatus, string> = {
  open: 'bg-blue-900/60 text-blue-300',
  consensus: 'bg-green-900/60 text-green-300',
  closed: 'bg-gray-700 text-gray-400',
  stale: 'bg-yellow-900/60 text-yellow-300',
  failed: 'bg-red-900/60 text-red-300',
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function DiscussionList({
  discussions,
  teams,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
}: DiscussionListProps) {
  const teamNames = Object.fromEntries(teams.map((t) => [t.id, t.name]));

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-800">
        {FILTER_TABS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onFilterChange(value)}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              filter === value
                ? 'bg-gray-800 text-gray-200'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Discussion list */}
      <div className="flex-1 overflow-y-auto">
        {discussions.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500">
            No discussions match the current filter.
          </div>
        ) : (
          discussions.map((d) => (
            <button
              key={d.id}
              onClick={() => onSelect(d.id)}
              className={`w-full text-left px-3 py-2.5 border-b border-gray-800 transition-colors ${
                selectedId === d.id
                  ? 'bg-gray-800'
                  : 'hover:bg-gray-900'
              }`}
            >
              {/* Title row */}
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm text-gray-100 truncate flex-1">
                  {d.title}
                </span>
                <span
                  className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLES[d.status]}`}
                >
                  {d.status}
                </span>
              </div>

              {/* Meta row */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded">
                  {d.type}
                </span>
                {teamNames[d.teamId] && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-cyan-900/50 text-cyan-300 rounded">
                    {teamNames[d.teamId]}
                  </span>
                )}
                <span className="text-[10px] text-gray-500">
                  {d.participantIds.length} participant{d.participantIds.length !== 1 ? 's' : ''}
                </span>
                <span className="text-[10px] text-gray-500 ml-auto">
                  {formatRelativeTime(d.lastActivityAt)}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
