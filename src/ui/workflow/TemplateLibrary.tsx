/**
 * TemplateLibrary — Card-based display of all workflow templates.
 */
import { useEffect, useState, useMemo } from 'react';

// Template type from server response (mirrors WorkflowTemplateRow)
interface WorkflowTemplate {
  rowId: string;
  id: string;
  version: number;
  name: string;
  description: string;
  ticketType: 'epic' | 'task';
  tags?: string[];
  usageCount: number;
  avgRating?: number;
  isLatest: boolean;
  createdAt: string;
}

type TicketTypeFilter = 'all' | 'epic' | 'task';

export function TemplateLibrary() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [ticketTypeFilter, setTicketTypeFilter] = useState<TicketTypeFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Load templates
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/workflow/templates');
        if (!res.ok) throw new Error('Failed to load templates');
        const data = await res.json();
        setTemplates(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load templates';
        setError(message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Filter templates
  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      // Type filter
      if (ticketTypeFilter !== 'all' && t.ticketType !== ticketTypeFilter) {
        return false;
      }

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = t.name.toLowerCase().includes(query);
        const matchesDescription = t.description.toLowerCase().includes(query);
        const matchesTags = t.tags?.some((tag) => tag.toLowerCase().includes(query));
        if (!matchesName && !matchesDescription && !matchesTags) {
          return false;
        }
      }

      return true;
    });
  }, [templates, ticketTypeFilter, searchQuery]);

  if (loading) {
    return (
      <div className="p-8 text-gray-400 flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
        Loading templates...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl">
      {/* Header and filters */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <h2 className="text-lg font-semibold text-gray-200">Workflow Templates</h2>
        <span className="text-sm text-gray-500">{filteredTemplates.length} templates</span>

        <div className="ml-auto flex items-center gap-3">
          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates..."
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-500 w-48 focus:outline-none focus:border-blue-500"
          />

          {/* Type filter */}
          <div className="flex items-center gap-1 p-0.5 bg-gray-800 rounded">
            {(['all', 'epic', 'task'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setTicketTypeFilter(type)}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  ticketTypeFilter === type
                    ? 'bg-gray-700 text-gray-200'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Template grid */}
      {filteredTemplates.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {templates.length === 0
            ? 'No workflow templates available.'
            : 'No templates match the current filters.'}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredTemplates.map((template) => (
            <TemplateCard key={template.rowId} template={template} />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({ template }: { template: WorkflowTemplate }) {
  const typeColor = template.ticketType === 'epic'
    ? 'bg-purple-900/50 text-purple-300'
    : 'bg-cyan-900/50 text-cyan-300';

  return (
    <div className="border border-gray-800 bg-gray-900 rounded-lg p-4 hover:border-gray-700 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-medium text-gray-200">{template.name}</h3>
        <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${typeColor}`}>
          {template.ticketType}
        </span>
      </div>

      {/* Description */}
      <p className="text-xs text-gray-500 line-clamp-2 mb-3">
        {template.description || 'No description'}
      </p>

      {/* Tags */}
      {template.tags && template.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {template.tags.slice(0, 5).map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded"
            >
              {tag}
            </span>
          ))}
          {template.tags.length > 5 && (
            <span className="text-[10px] text-gray-500">
              +{template.tags.length - 5} more
            </span>
          )}
        </div>
      )}

      {/* Footer stats */}
      <div className="flex items-center gap-3 text-[10px] text-gray-500">
        <span>v{template.version}</span>
        <span>{template.usageCount} uses</span>
        {template.avgRating != null && (
          <span>
            {template.avgRating.toFixed(1)} rating
          </span>
        )}
      </div>
    </div>
  );
}
