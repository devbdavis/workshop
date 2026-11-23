import { useState } from 'react';
import type { Track } from '@foundation/types.js';

interface Props {
  playbook: { rowId: string; name: string };
  tracks: Track[];
  onClose: () => void;
}

export function RunWorkflowModal({ playbook, tracks, onClose }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [trackId, setTrackId] = useState('');
  const [autonomous, setAutonomous] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/workflow/issues/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          trackId: trackId || undefined,
          playbookRowId: playbook.rowId,
          autonomous,
        }),
      });
      if (!res.ok) {
        const body: { error?: string } = await res.json().catch(() => ({}));
        setError(body.error ?? 'Failed to run workflow');
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run workflow');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 md:p-0">
      <form
        onSubmit={handleSubmit}
        className="bg-gray-900 border border-gray-700 rounded-lg p-4 md:p-6 w-full max-w-lg shadow-xl max-h-[90vh] flex flex-col"
      >
        <h2 className="text-sm font-semibold text-gray-200 mb-3">Run: {playbook.name}</h2>
        <div className="flex-1 overflow-y-auto space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Title *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">What should it work on? *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              required
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200"
            />
          </div>
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
          <label className="flex items-center gap-2 text-xs text-gray-300">
            <input
              type="checkbox"
              checked={autonomous}
              onChange={(e) => setAutonomous(e.target.checked)}
              className="rounded border-gray-700 bg-gray-800"
            />
            Run autonomously (skip review gates that allow it)
          </label>
        </div>

        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-gray-800">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            disabled={running}
            className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Run
          </button>
        </div>
      </form>
    </div>
  );
}
