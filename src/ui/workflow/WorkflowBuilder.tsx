import { useState } from 'react';

interface Step {
  prompt: string;
  pauseAfter: boolean;
}

interface Props {
  onSaved: () => void;
  onClose: () => void;
}

export function WorkflowBuilder({ onSaved, onClose }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<Step[]>([{ prompt: '', pauseAfter: false }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function updateStep(i: number, patch: Partial<Step>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function move(i: number, delta: number) {
    setSteps((prev) => {
      const j = i + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/workflow/playbooks/chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim(), steps }),
      });
      if (!res.ok) {
        const body: { error?: string } = await res.json().catch(() => ({}));
        setError(body.error ?? 'Failed to save workflow');
        return;
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workflow');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 md:p-0">
      <form
        onSubmit={handleSubmit}
        className="bg-gray-900 border border-gray-700 rounded-lg p-4 md:p-6 w-full max-w-lg shadow-xl max-h-[90vh] flex flex-col"
      >
        <h2 className="text-sm font-semibold text-gray-200 mb-1">New Workflow</h2>
        <p className="text-[11px] text-gray-500 mb-3">
          Each step runs as its own Claude session, in order. Use a skill name like /egm-draft or plain
          instructions. You review the result at the end.
        </p>

        <div className="flex-1 overflow-y-auto space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={128}
              required
              autoFocus
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200"
            />
          </div>

          {steps.map((step, i) => (
            <div key={i} className="border border-gray-800 rounded p-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Step {i + 1}</span>
                <div className="flex gap-1 text-xs">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-1.5 text-gray-400 hover:text-gray-200 disabled:opacity-30" title="Move up">↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === steps.length - 1} className="px-1.5 text-gray-400 hover:text-gray-200 disabled:opacity-30" title="Move down">↓</button>
                  <button type="button" onClick={() => setSteps((p) => p.filter((_, idx) => idx !== i))} disabled={steps.length === 1} className="px-1.5 text-red-400 hover:text-red-300 disabled:opacity-30">Remove</button>
                </div>
              </div>
              <textarea
                value={step.prompt}
                onChange={(e) => updateStep(i, { prompt: e.target.value })}
                placeholder="/review-app"
                rows={2}
                required
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200"
              />
              <label className="flex items-center gap-2 text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={step.pauseAfter}
                  onChange={(e) => updateStep(i, { pauseAfter: e.target.checked })}
                  className="rounded border-gray-700 bg-gray-800"
                />
                Pause for my approval after this step
              </label>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setSteps((p) => [...p, { prompt: '', pauseAfter: false }])}
            disabled={steps.length >= 20}
            className="px-3 py-1 text-xs text-gray-300 border border-gray-700 rounded hover:border-gray-600 disabled:opacity-40"
          >
            Add step
          </button>
        </div>

        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-gray-800">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save workflow
          </button>
        </div>
      </form>
    </div>
  );
}
