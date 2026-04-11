import { useState, useEffect } from 'react';

type IssueTracker = 'linear' | 'jira' | 'none';

interface TrackerConfig {
  tracker: IssueTracker;
  orgName: string;
}

function buildPreviewUrl(tracker: IssueTracker, orgName: string): string | null {
  if (!orgName.trim()) return null;
  if (tracker === 'linear') return `https://linear.app/${orgName.trim()}/issue/TEAM-123`;
  if (tracker === 'jira') return `https://${orgName.trim()}.atlassian.net/browse/TEAM-123`;
  return null;
}

export function IssueTracking() {
  const [config, setConfig] = useState<TrackerConfig>({ tracker: 'linear', orgName: '' });
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/settings/issue-tracker')
      .then((r) => r.json())
      .then((data: TrackerConfig) => { setConfig(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    await fetch('/api/settings/issue-tracker', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const previewUrl = buildPreviewUrl(config.tracker, config.orgName);

  if (loading) {
    return <p className="text-xs text-gray-500">Loading…</p>;
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-200 mb-1">Issue Tracking</h2>
      <p className="text-xs text-gray-500 mb-5">
        Links issue keys (e.g. ASY-104) in session pane headers to your tracker.
      </p>

      <div className="space-y-5">
        {/* Provider */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Provider</label>
          <select
            value={config.tracker}
            onChange={(e) => setConfig((prev) => ({ ...prev, tracker: e.target.value as IssueTracker }))}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 w-48"
          >
            <option value="linear">Linear</option>
            <option value="jira">Jira</option>
            <option value="none">None</option>
          </select>
        </div>

        {/* Org / domain */}
        {config.tracker !== 'none' && (
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              {config.tracker === 'linear' ? 'Linear org name' : 'Jira domain'}
            </label>
            <input
              type="text"
              value={config.orgName}
              onChange={(e) => setConfig((prev) => ({ ...prev, orgName: e.target.value }))}
              placeholder={config.tracker === 'linear' ? 'e.g. myorg' : 'e.g. mycompany'}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 w-72"
            />
            {previewUrl && (
              <p className="text-[11px] text-gray-500 mt-2">
                Links will look like:{' '}
                <span className="text-blue-400 font-mono">{previewUrl}</span>
              </p>
            )}
          </div>
        )}

        <button
          onClick={handleSave}
          className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded transition-colors text-white"
        >
          {saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
    </div>
  );
}
