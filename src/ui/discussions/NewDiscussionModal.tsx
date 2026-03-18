import { useState } from 'react';
import type { DiscussionTeam, DiscussionTeamId, DiscussionType } from '@foundation/discussion-types';
import type { Track } from '@foundation/types';

export interface CreateDiscussionData {
  teamId: string;
  title: string;
  type: DiscussionType;
  artifact?: string;
  trackId?: string;
  staleAfterMinutes?: number;
}

interface Props {
  teams: DiscussionTeam[];
  tracks: Track[];
  onSubmit: (data: CreateDiscussionData) => void;
  onClose: () => void;
}

const DISCUSSION_TYPES: { value: DiscussionType; label: string }[] = [
  { value: 'rfc', label: 'RFC' },
  { value: 'question', label: 'Question' },
  { value: 'review', label: 'Review' },
];

export function NewDiscussionModal({ teams, tracks, onSubmit, onClose }: Props) {
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<DiscussionType>('rfc');
  const [artifact, setArtifact] = useState('');
  const [trackId, setTrackId] = useState('');
  const [staleAfterMinutes, setStaleAfterMinutes] = useState(0);

  const activeTracks = tracks.filter((t) => t.status === 'active');
  const canSubmit = teamId && title.trim();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    onSubmit({
      teamId,
      title: title.trim(),
      type,
      artifact: artifact.trim() || undefined,
      trackId: trackId || undefined,
      staleAfterMinutes: staleAfterMinutes || undefined,
    });
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-gray-200">New Discussion</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-5 space-y-4 flex-1 overflow-y-auto">
            {/* Team */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Team</label>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value as DiscussionTeamId)}
                className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm"
                required
              >
                {teams.length === 0 ? (
                  <option value="" disabled>
                    (No teams — create one first)
                  </option>
                ) : (
                  teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Title */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. API pagination strategy — cursor vs offset"
                className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm"
                autoFocus
                required
              />
            </div>

            {/* Type */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Type</label>
              <div className="flex gap-1">
                {DISCUSSION_TYPES.map((dt) => (
                  <button
                    key={dt.value}
                    type="button"
                    onClick={() => setType(dt.value)}
                    className={`px-3 py-1 text-xs rounded transition-colors ${
                      type === dt.value
                        ? 'bg-indigo-900/60 text-indigo-300'
                        : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {dt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Artifact */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Artifact
                <span className="text-gray-600 ml-1">(optional)</span>
              </label>
              <textarea
                value={artifact}
                onChange={(e) => setArtifact(e.target.value)}
                placeholder="Paste the document, diff, plan, or proposal being discussed..."
                className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm font-mono"
                rows={6}
              />
            </div>

            {/* Track binding */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Track
                <span className="text-gray-600 ml-1">(optional)</span>
              </label>
              <select
                value={trackId}
                onChange={(e) => setTrackId(e.target.value)}
                className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm"
              >
                <option value="">None</option>
                {activeTracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-600 mt-1">
                Binding to a track gives agents extra context (summary, context field)
              </p>
            </div>

            {/* Stale timeout */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Stale timeout
                <span className="text-gray-600 ml-1">(optional)</span>
              </label>
              <input
                type="number"
                min={0}
                value={staleAfterMinutes}
                onChange={(e) => setStaleAfterMinutes(Number(e.target.value))}
                className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm"
              />
              <p className="text-[11px] text-gray-600 mt-1">
                Auto-close after N minutes of inactivity (0 = never)
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded transition-colors"
            >
              Create Discussion
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
