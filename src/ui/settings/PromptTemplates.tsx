import { useEffect, useState } from 'react';
import type { PromptTemplate } from '@foundation/types';

export function PromptTemplates() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadTemplates() {
    try {
      const res = await fetch('/api/templates');
      if (res.ok) setTemplates(await res.json());
    } catch (err) {
      console.error('Failed to load templates:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTemplates();
  }, []);

  async function handleCreate(data: { name: string; description: string; content: string }) {
    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setCreating(false);
        loadTemplates();
      }
    } catch (err) {
      console.error('Failed to create template:', err);
    }
  }

  async function handleUpdate(id: string, data: { name: string; description: string; content: string }) {
    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setEditingId(null);
        loadTemplates();
      }
    } catch (err) {
      console.error('Failed to update template:', err);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this template?')) return;
    try {
      const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (editingId === id) setEditingId(null);
        loadTemplates();
      }
    } catch (err) {
      console.error('Failed to delete template:', err);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-500">Loading templates...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Prompt Templates</h2>
          <p className="text-sm text-gray-400 mt-1">
            Manage system prompt templates for Claude sessions.
          </p>
        </div>
        {!creating && (
          <button
            onClick={() => { setCreating(true); setEditingId(null); }}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
          >
            New Template
          </button>
        )}
      </div>

      {creating && (
        <TemplateForm
          onSave={handleCreate}
          onCancel={() => setCreating(false)}
        />
      )}

      {templates.length === 0 && !creating && (
        <p className="text-sm text-gray-500 italic">No templates yet.</p>
      )}

      <div className="space-y-3">
        {templates.map((tpl) =>
          editingId === tpl.id ? (
            <TemplateForm
              key={tpl.id}
              initial={tpl}
              onSave={(data) => handleUpdate(tpl.id, data)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <TemplateCard
              key={tpl.id}
              template={tpl}
              onEdit={() => { setEditingId(tpl.id); setCreating(false); }}
              onDelete={() => handleDelete(tpl.id)}
            />
          ),
        )}
      </div>

      <div className="mt-4 p-3 bg-gray-800/50 rounded-lg">
        <p className="text-xs font-semibold text-gray-400 mb-1">Available Variables</p>
        <div className="text-xs text-gray-500 font-mono space-y-0.5">
          <p>{'{{track.name}}'} &mdash; Track name</p>
          <p>{'{{track.description}}'} &mdash; Track description</p>
          <p>{'{{track.id}}'} &mdash; Track ID</p>
          <p>{'{{track.repos}}'} &mdash; Comma-separated repo paths</p>
          <p>{'{{track.repos[0].path}}'} &mdash; First repo path</p>
          <p>{'{{track.repos[0].branch}}'} &mdash; First repo branch</p>
          <p>{'{{track.paths}}'} &mdash; Comma-separated track paths (with labels)</p>
          <p>{'{{track.issues}}'} &mdash; Comma-separated issue IDs</p>
          <p>{'{{todo.id}}'} &mdash; Todo ID (dispatch only)</p>
          <p>{'{{todo.title}}'} &mdash; Todo title (dispatch only)</p>
          <p>{'{{todo.description}}'} &mdash; Todo description (dispatch only)</p>
          <p className="text-gray-600 pt-1">PR templates (build-fix / comment-response):</p>
          <p>{'{{pr.url}}'} &mdash; PR URL</p>
          <p>{'{{pr.title}}'} &mdash; PR title</p>
          <p>{'{{pr.number}}'} &mdash; PR number</p>
          <p>{'{{pr.branch}}'} &mdash; PR head branch</p>
          <p>{'{{pr.repo}}'} &mdash; owner/name</p>
          <p>{'{{pr.failing_checks}}'} &mdash; markdown list of failing checks</p>
          <p>{'{{pr.comments}}'} &mdash; markdown list of comments to address</p>
        </div>
      </div>
    </div>
  );
}

const SYSTEM_KIND_LABEL: Record<string, string> = {
  todo: 'Todo dispatch',
  'pr-build-fix': 'PR build fix',
  'pr-comment-response': 'PR comment response',
};

function TemplateCard({
  template,
  onEdit,
  onDelete,
}: {
  template: PromptTemplate;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const systemKind = template.systemKind;
  const isSystem = !!systemKind;

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-200">{template.name}</h3>
            {isSystem && (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300">
                System · {SYSTEM_KIND_LABEL[systemKind] ?? systemKind}
              </span>
            )}
          </div>
          {template.description && (
            <p className="text-xs text-gray-400 mt-0.5">{template.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-3 shrink-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            {expanded ? 'Collapse' : 'Preview'}
          </button>
          <button onClick={onEdit} className="text-xs text-blue-400 hover:text-blue-300">
            Edit
          </button>
          {!isSystem && (
            <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-400">
              Delete
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <pre className="mt-3 p-3 bg-gray-900 rounded text-xs text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-60 overflow-y-auto">
          {template.content}
        </pre>
      )}
    </div>
  );
}

function TemplateForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: { name: string; description?: string; content: string };
  onSave: (data: { name: string; description: string; content: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [content, setContent] = useState(initial?.content ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !content.trim()) return;
    onSave({ name: name.trim(), description: description.trim(), content });
  }

  return (
    <form onSubmit={handleSubmit} className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
      <div>
        <label className="block text-xs text-gray-400 mb-1">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="block w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          autoFocus
          required
        />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Description</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="block w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          placeholder="Optional"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Template Content</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={10}
          className="block w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-100 font-mono focus:outline-none focus:border-blue-500 resize-y"
          required
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!name.trim() || !content.trim()}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors"
        >
          {initial ? 'Save Changes' : 'Create Template'}
        </button>
      </div>
    </form>
  );
}
