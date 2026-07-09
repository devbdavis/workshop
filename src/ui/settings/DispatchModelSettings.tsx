import { useState, useEffect } from 'react';

export function DispatchModelSettings() {
  const [model, setModel] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [saved, setSaved] = useState<boolean>(false);

  useEffect(() => {
    fetch('/api/settings/dispatch-model')
      .then((r) => r.json())
      .then((d: { model: string }) => setModel(d.model))
      .catch(() => { /* keep default */ })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(): Promise<void> {
    try {
      await fetch('/api/settings/dispatch-model', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // leave the field as typed; next load shows the persisted value
    }
  }

  if (loading) {
    return <p className="text-xs text-gray-500">Loading…</p>;
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-200 mb-1">Dispatch Model</h2>
      <p className="text-xs text-gray-500 mb-4">
        Model for dispatched (orchestrator) sessions — passed to claude as <code>--model</code>. Subagents
        they spawn run on cheaper models. Leave empty to use the CLI&apos;s own default. Other providers ignore this.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onBlur={handleSave}
          placeholder="opus"
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 w-72"
        />
        {saved && <span className="text-xs text-green-400">Saved</span>}
      </div>
    </div>
  );
}
