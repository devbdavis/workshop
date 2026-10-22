import { useState, useEffect } from 'react';
import type { Track } from '@foundation/types';

interface Props {
  track: Track;
  onUpdate: () => void;
}

export function ContextPanel({ track, onUpdate }: Props) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Context</h3>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Project Context
          </h4>
          <button
            onClick={() => {
              setModalOpen(true);
            }}
            className="text-xs text-gray-500 hover:text-gray-400"
          >
            Edit
          </button>
        </div>
        {!track.context && (
          <p className="text-xs text-gray-600 italic">
            No context set. Click Edit to add project context that will be included in new Claude
            sessions.
          </p>
        )}
      </div>

{track.issues && track.issues.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
            Issues
          </h4>
          <ul className="space-y-1">
            {track.issues.map((issue) => (
              <li key={issue.id} className="text-sm text-gray-400">
                <span className="font-mono text-xs">{issue.externalId}</span>
                {issue.cachedTitle && (
                  <span className="ml-2">{issue.cachedTitle}</span>
                )}
                {issue.cachedStatus && (
                  <span className="ml-2 text-xs text-gray-500">{issue.cachedStatus}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {modalOpen && (
        <ContextEditModal
          trackId={track.id}
          initialContext={track.context || ''}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            onUpdate();
          }}
        />
      )}
    </div>
  );
}

function ContextEditModal({
  trackId,
  initialContext,
  onClose,
  onSaved,
}: {
  trackId: string;
  initialContext: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [context, setContext] = useState(initialContext);
  const [saving, setSaving] = useState(false);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/tracks/${trackId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      });
      onSaved();
    } catch (err) {
      console.error('Failed to save context:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl w-[80vw] h-[80vh] resize flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h2 className="text-sm font-semibold text-gray-200">Edit Project Context</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">
            &times;
          </button>
        </div>
        <div className="flex-1 overflow-hidden p-4">
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            className="block w-full h-full min-h-[300px] px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-300 font-mono resize-y"
            placeholder="Describe the project context, current focus, important notes..."
            autoFocus
          />
        </div>
        <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
