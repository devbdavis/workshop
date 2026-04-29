import { useState, useEffect } from 'react';
import type { Skill } from '@foundation/types';

interface ImprovedData {
  name?: string;
  description?: string;
  content: string;
}

interface Props {
  skill: Skill;
  onApply: (data: ImprovedData) => void;
  onClose: () => void;
}

export function ImproveSkillModal({ skill, onApply, onClose }: Props) {
  const [feedback, setFeedback] = useState('');
  const [improving, setImproving] = useState(false);
  const [error, setError] = useState('');
  const [improved, setImproved] = useState<ImprovedData | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleImprove() {
    if (!feedback.trim()) return;
    setImproving(true);
    setError('');
    setImproved(null);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skill.id)}/improve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: feedback.trim() }),
      });
      if (!res.ok) {
        // Surface the server's actual error message so the user can tell
        // "claude not on the workshop server's PATH" from "CLI ran but
        // returned bad JSON" etc., instead of a generic catch-all.
        const body = await res.json().catch(() => null);
        setError(body?.error || `Improvement failed (HTTP ${res.status}). Check server logs.`);
        return;
      }
      setImproved(await res.json());
    } catch {
      setError('Improvement failed — check server logs.');
    } finally {
      setImproving(false);
    }
  }

  function handleApply() {
    if (improved) onApply(improved);
  }

  const changed = improved && (
    improved.content !== skill.content ||
    improved.name !== skill.name ||
    improved.description !== skill.description
  );

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-[700px] max-w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-lg font-semibold">Improve Skill</h2>
            <p className="text-xs text-gray-400 mt-0.5">{skill.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-2xl leading-none px-1">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Feedback input */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">What would you like to improve?</label>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleImprove(); }}
              placeholder="e.g. The skill is too verbose. Make it more concise and add better trigger conditions."
              rows={5}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-y"
              autoFocus
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] text-gray-500">⌘↵ to generate</span>
              <button
                type="button"
                onClick={handleImprove}
                disabled={!feedback.trim() || improving}
                className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded transition-colors"
              >
                {improving ? 'Improving…' : 'Improve with Claude'}
              </button>
            </div>
            {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
          </div>

          {/* Improved preview */}
          {improved && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-blue-400">
                {changed ? 'Changes suggested — review before applying' : 'No changes were necessary'}
              </p>

              {improved.name && improved.name !== skill.name && (
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Name</label>
                  <p className="text-sm text-gray-200 bg-gray-800 rounded px-3 py-1.5">{improved.name}</p>
                </div>
              )}

              {improved.description && improved.description !== skill.description && (
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Description</label>
                  <p className="text-sm text-gray-200 bg-gray-800 rounded px-3 py-1.5">{improved.description}</p>
                </div>
              )}

              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Content</label>
                <pre className="text-xs text-gray-200 bg-gray-800 rounded px-3 py-2 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto">
                  {improved.content}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-800 shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">
            Cancel
          </button>
          {improved && (
            <button
              type="button"
              onClick={handleApply}
              disabled={!changed}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors"
            >
              Apply Changes
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
