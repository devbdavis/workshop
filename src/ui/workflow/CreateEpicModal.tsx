import { useState } from 'react';
import type { Track } from '@foundation/types';

type CreateMode = 'standard' | 'from-plan';

export interface CreateEpicData {
  title: string;
  description: string;
  trackId?: string;
  priority: string;
  provider: string;
  /** If set, creates epic at plan-review with this as the pre-written plan */
  planDraft?: string;
}

interface Props {
  tracks: Track[];
  onSave: (data: CreateEpicData) => void;
  onClose: () => void;
}

export function CreateEpicModal({ tracks, onSave, onClose }: Props) {
  const [mode, setMode] = useState<CreateMode>('standard');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [planDraft, setPlanDraft] = useState('');
  const [trackId, setTrackId] = useState('');
  const [priority, setPriority] = useState('medium');
  const [provider, setProvider] = useState('claude');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (mode === 'standard' && !description.trim()) return;
    if (mode === 'from-plan' && !planDraft.trim()) return;

    onSave({
      title: title.trim(),
      description: description.trim(),
      trackId: trackId || undefined,
      priority,
      provider,
      planDraft: mode === 'from-plan' ? planDraft.trim() : undefined,
    });
  }

  const isFromPlan = mode === 'from-plan';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <form
        onSubmit={handleSubmit}
        className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-lg shadow-xl max-h-[90vh] flex flex-col"
      >
        <h2 className="text-sm font-semibold text-gray-200 mb-3">New Epic</h2>

        {/* Mode toggle */}
        <div className="flex gap-1 mb-4 p-0.5 bg-gray-800 rounded w-fit">
          <button
            type="button"
            onClick={() => setMode('standard')}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              !isFromPlan
                ? 'bg-gray-700 text-gray-200'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Standard
          </button>
          <button
            type="button"
            onClick={() => setMode('from-plan')}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              isFromPlan
                ? 'bg-gray-700 text-gray-200'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            From Plan
          </button>
        </div>

        {isFromPlan && (
          <p className="text-[11px] text-amber-400/80 mb-3">
            Skips triage, spec, and planning phases. Epic starts at plan-review for your approval.
          </p>
        )}

        <div className="flex-1 overflow-y-auto space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Title *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Description {!isFromPlan && '*'}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200"
              rows={isFromPlan ? 2 : 4}
              required={!isFromPlan}
              placeholder={isFromPlan ? 'Optional summary of what the epic covers' : undefined}
            />
          </div>

          {isFromPlan && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Implementation Plan *</label>
              <textarea
                value={planDraft}
                onChange={(e) => setPlanDraft(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 font-mono"
                rows={8}
                required
                placeholder="Paste your implementation plan here..."
              />
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Track</label>
              <select
                value={trackId}
                onChange={(e) => setTrackId(e.target.value)}
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300"
              >
                <option value="">None</option>
                {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300"
              >
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
          >
            {isFromPlan ? 'Create at Plan Review' : 'Create Epic'}
          </button>
        </div>
      </form>
    </div>
  );
}
