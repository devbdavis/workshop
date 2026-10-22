import { useEffect, useState } from 'react';
import { useAvailableClis } from '../hooks/useAvailableClis';

interface PrReviewSettingsData {
  provider: string;
  model: string;
  team: string;
}

export function PrReviewSettings() {
  const [data, setData] = useState<PrReviewSettingsData>({ provider: '', model: '', team: '' });
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const { clis } = useAvailableClis();

  useEffect(() => {
    fetch('/api/settings/pr-review')
      .then((r) => r.json())
      .then((d: PrReviewSettingsData) => setData(d))
      .catch(() => {
        /* keep defaults */
      })
      .finally(() => setLoading(false));
  }, []);

  async function save(next: Partial<PrReviewSettingsData>) {
    const merged = { ...data, ...next };
    setData(merged);
    setSaved(false);
    try {
      const res = await fetch('/api/settings/pr-review', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (res.ok) {
        setData((await res.json()) as PrReviewSettingsData);
        setSaved(true);
      }
    } catch {
      /* leave optimistic value; next load corrects it */
    }
  }

  if (loading) return <p className="text-xs text-gray-500">Loading…</p>;

  const enabledAgents = clis.filter((c) => c.kind === 'agent' && c.enabled);

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-200 mb-1">PR Review Agent</h2>
      <p className="text-xs text-gray-500 mb-4">
        Which CLI and model run the analysis when you click Analyze on the PR Reviews dashboard.
      </p>
      <div className="flex items-end gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">CLI</label>
          <select
            value={data.provider}
            onChange={(e) => save({ provider: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 w-52"
          >
            <option value="">Use default CLI</option>
            {enabledAgents.map((c) => (
              <option key={c.provider} value={c.provider}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Model (Claude only)</label>
          <input
            value={data.model}
            onChange={(e) => setData((d) => ({ ...d, model: e.target.value }))}
            onBlur={(e) => save({ model: e.target.value })}
            placeholder="opus"
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 w-52"
          />
        </div>
        {saved && <span className="text-xs text-emerald-400 pb-2">Saved</span>}
      </div>
      <p className="text-[11px] text-gray-600 mt-2">
        Passed to the claude CLI as <code>--model</code> (e.g. "opus", "sonnet", or a full model id). Leave empty for the CLI's default.
      </p>
      <div className="mt-4">
        <label className="block text-xs text-gray-400 mb-1.5">Review team (GitHub)</label>
        <input
          value={data.team}
          onChange={(e) => setData((d) => ({ ...d, team: e.target.value }))}
          onBlur={(e) => save({ team: e.target.value })}
          placeholder="grafana/syseng"
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 w-52"
        />
        <p className="text-[11px] text-gray-600 mt-2">
          PRs requesting this team show up on the dashboard while no teammate has reviewed or commented. Needs the
          <code> read:org</code> gh scope.
        </p>
      </div>
    </div>
  );
}
