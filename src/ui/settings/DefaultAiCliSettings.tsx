import { useState, useEffect } from 'react';
import type { DefaultAiCli } from '@foundation/types';

export function DefaultAiCliSettings() {
  const [provider, setProvider] = useState<DefaultAiCli>('claude');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    function load() {
      fetch('/api/settings/default-ai-cli')
        .then((r) => r.json())
        .then((d: { provider: DefaultAiCli }) => setProvider(d.provider))
        .catch(() => { /* keep default */ })
        .finally(() => setLoading(false));
    }
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, []);

  async function handleChange(next: DefaultAiCli) {
    setProvider(next);
    try {
      await fetch('/api/settings/default-ai-cli', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: next }),
      });
    } catch {
      // revert on failure
      const r = await fetch('/api/settings/default-ai-cli');
      if (r.ok) {
        const d = (await r.json()) as { provider: DefaultAiCli };
        setProvider(d.provider);
      }
    }
  }

  if (loading) {
    return <p className="text-xs text-gray-500">Loading…</p>;
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-200 mb-1">Default AI CLI</h2>
      <p className="text-xs text-gray-500 mb-4">
        Controls which CLI is used by default for new sessions, including the primary New Session button
        and any session creation flow where no CLI is explicitly selected.
      </p>
      <label className="block text-xs text-gray-400 mb-1.5">Preferred CLI</label>
      <select
        value={provider}
        onChange={(e) => handleChange(e.target.value as DefaultAiCli)}
        className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 w-72"
      >
        <option value="claude">Claude Code (default)</option>
        <option value="cursor">Cursor CLI</option>
      </select>
    </div>
  );
}
