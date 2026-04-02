import { useState, useEffect } from 'react';
import type { Skill } from '@foundation/types';

export interface SkillFormData {
  name: string;
  description: string;
  content: string;
}

interface Props {
  initial?: Skill;
  onSave: (data: SkillFormData) => void;
  onClose: () => void;
}

export function SkillFormModal({ initial, onSave, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [generateInput, setGenerateInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleGenerate() {
    if (!generateInput.trim()) return;
    setGenerating(true);
    setGenerateError('');
    try {
      const res = await fetch('/api/skills/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: generateInput }),
      });
      if (!res.ok) {
        setGenerateError('Generation failed — check that the Claude CLI is available.');
        return;
      }
      const data = await res.json();
      if (data.name) setName(data.name);
      if (data.description) setDescription(data.description);
      if (data.content) setContent(data.content);
    } catch {
      setGenerateError('Generation failed — check server logs.');
    } finally {
      setGenerating(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !description.trim() || !content.trim()) return;
    onSave({
      name: name.trim(),
      description: description.trim(),
      content: content.trim(),
    });
  }

  const isValid = name.trim() && description.trim() && content.trim();
  const inputCls = 'block w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500';

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-[700px] max-w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <h2 className="text-lg font-semibold">{initial ? 'Edit Skill' : 'New Skill'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-2xl leading-none px-1">×</button>
        </div>

        {/* Scrollable form body */}
        <form id="skill-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Generate with Claude — new skills only */}
          {!initial && (
            <div className="border border-gray-700 bg-gray-800/60 rounded-lg p-3 space-y-2">
              <p className="text-xs font-medium text-blue-400">Generate with Claude</p>
              <p className="text-[11px] text-gray-400">Describe what you want the skill to do and Claude will draft the full definition.</p>
              <textarea
                value={generateInput}
                onChange={(e) => setGenerateInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
                placeholder="e.g. A skill that enforces strict TypeScript best practices: no any, explicit return types, prefer interfaces over type aliases for object shapes."
                rows={3}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-y"
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500">⌘↵ to generate</span>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!generateInput.trim() || generating}
                  className="px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded transition-colors"
                >
                  {generating ? 'Generating…' : 'Generate'}
                </button>
              </div>
              {generateError && <p className="text-xs text-red-400">{generateError}</p>}
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1">Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} required />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Description *</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} required />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Content *</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={14}
              className="block w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 font-mono focus:outline-none focus:border-blue-500 resize-y"
              required
            />
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-800 shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            form="skill-form"
            disabled={!isValid}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors"
          >
            {initial ? 'Save Changes' : 'Create Skill'}
          </button>
        </div>
      </div>
    </div>
  );
}
