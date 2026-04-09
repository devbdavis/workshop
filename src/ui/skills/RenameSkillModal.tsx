import { useState, useEffect } from 'react';
import type { Skill } from '@foundation/types';

interface Props {
  skill: Skill;
  onRename: (newName: string) => Promise<void>;
  onClose: () => void;
}

export function RenameSkillModal({ skill, onRename, onClose }: Props) {
  const [name, setName] = useState(skill.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === skill.name) { onClose(); return; }
    setSaving(true);
    setError('');
    try {
      await onRename(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed');
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-[420px] max-w-full">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-lg font-semibold">Rename Skill</h2>
            <p className="text-xs text-gray-400 mt-0.5 font-mono">{skill.id}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-2xl leading-none px-1">×</button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">New name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
              autoFocus
              autoComplete="off"
            />
            <p className="text-[10px] text-gray-500 mt-1">
              The skill folder will be renamed to match — all files inside are preserved.
            </p>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || saving}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors"
            >
              {saving ? 'Renaming…' : 'Rename'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
