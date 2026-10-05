import { useEffect, useState } from 'react';

interface Usage {
  windowTokens: number;
  ceilingTokens: number | null;
  calibrated: boolean;
  fraction: number | null;
  threshold: number;
  overThreshold: boolean;
  drainsAt: string | null;
}

const POLL_MS = 60_000;
const WARN_RATIO = 0.8; // warn at 80% of the dispatch threshold
const fmtTokens = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const pct = (f: number): string => `${Math.round(f * 100)}%`;

function fmtDuration(ms: number): string {
  const mins = Math.round(ms / 60_000);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

export function UsageChip() {
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    const load = (): void => {
      fetch('/api/usage')
        .then((r) => (r.ok ? r.json() : null))
        .then((u: Usage | null) => setUsage(u))
        .catch(() => setUsage(null)); // hide rather than show stale headroom
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, []);

  if (!usage) return null;

  const { fraction, threshold, calibrated, overThreshold } = usage;
  const warn = fraction !== null && fraction >= threshold * WARN_RATIO;
  const tone = !calibrated
    ? 'text-gray-500 border-dashed border-gray-700'
    : overThreshold
      ? 'text-red-400 border-red-800'
      : warn
        ? 'text-amber-400 border-amber-800'
        : 'text-emerald-400 border-gray-800';
  const label = calibrated && fraction !== null ? pct(fraction) : `${fmtTokens.format(usage.windowTokens)} · ?`;
  const verdict = !calibrated
    ? 'Unknown — no ceiling learned yet, so dispatch is not gated. The first wall-hit pauses work and calibrates it.'
    : overThreshold
      ? `Paused — over the ${pct(threshold)} threshold. New autonomous work waits for the window to drain.`
      : warn
        ? `Yes, but close — another agent may push past ${pct(threshold)}.`
        : 'Yes — plenty of headroom.';

  return (
    <>
      <button
        popoverTarget="usage-popover"
        title={calibrated ? 'Usage in trailing 5h window' : 'Usage ceiling not yet calibrated'}
        className={`px-2 py-0.5 text-[11px] font-medium tabular-nums border rounded hover:bg-gray-900 ${tone}`}
      >
        {label}
      </button>
      <div
        id="usage-popover"
        popover="auto"
        className="fixed inset-auto top-10 right-4 m-0 w-72 p-3 text-xs text-gray-300 bg-gray-950 border border-gray-800 rounded shadow-lg space-y-2"
      >
        <div className="font-semibold text-gray-100">Usage — trailing 5h window</div>
        <dl className="grid grid-cols-2 gap-x-2 gap-y-1">
          <dt className="text-gray-500">Tokens in window</dt>
          <dd className="tabular-nums">{fmtTokens.format(usage.windowTokens)}</dd>
          <dt className="text-gray-500">Learned ceiling</dt>
          <dd className="tabular-nums">
            {usage.ceilingTokens !== null ? fmtTokens.format(usage.ceilingTokens) : 'not calibrated'}
          </dd>
          <dt className="text-gray-500">Used</dt>
          <dd className="tabular-nums">{fraction !== null ? pct(fraction) : '—'}</dd>
          <dt className="text-gray-500">Dispatch threshold</dt>
          <dd className="tabular-nums">{pct(threshold)}</dd>
          <dt className="text-gray-500">Oldest usage ages out</dt>
          <dd className="tabular-nums">{usage.drainsAt ? `in ${fmtDuration(Math.max(0, Date.parse(usage.drainsAt) - Date.now()))}` : "—"}</dd>
        </dl>
        <div>
          <span className="text-gray-500">Dispatch another agent? </span>
          {verdict}
        </div>
        <div className="text-gray-500">
          Account-wide: interactive sessions count against the same window.
        </div>
      </div>
    </>
  );
}
