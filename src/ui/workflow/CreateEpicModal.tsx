import { useState } from 'react';
import type { Track } from '@foundation/types';

interface Props {
  tracks: Track[];
  onSave: (data: {
    title: string;
    description: string;
    trackId?: string;
    priority: string;
    provider: string;
  }) => void;
  onClose: () => void;
}

export function CreateEpicModal({ tracks, onSave, onClose }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [trackId, setTrackId] = useState('');
  const [priority, setPriority] = useState('medium');
  const [provider, setProvider] = useState('claude');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    onSave({
      title: title.trim(),
      description: description.trim(),
      trackId: trackId || undefined,
      priority,
      provider,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <form
        onSubmit={handleSubmit}
        className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-lg shadow-xl"
      >
        <h2 className="text-sm font-semibold text-gray-200 mb-4">New Epic</h2>

        <label className="block text-xs text-gray-400 mb-1">Title *</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 mb-3"
          autoFocus
          required
        />

        <label className="block text-xs text-gray-400 mb-1">Description *</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 mb-3"
          rows={4}
          required
        />

        <div className="grid grid-cols-3 gap-3 mb-4">
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

        <div className="flex justify-end gap-2">
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
            Create Epic
          </button>
        </div>
      </form>
    </div>
  );
}
