import { useState, useEffect } from 'react';

type IssueTracker = 'linear' | 'jira' | 'github' | 'none';

interface TrackerConfig {
  tracker: IssueTracker;
  orgName: string;
  githubRepo: string;
  githubLabels: string;
  linearApiKeyConfigured: boolean;
}

interface SavePayload {
  tracker: IssueTracker;
  orgName: string;
  githubRepo: string;
  githubLabels: string;
  linearApiKey?: string;
}

function buildPreviewUrl(tracker: IssueTracker, orgName: string): string | null {
  if (!orgName.trim()) return null;
  if (tracker === 'linear') return `https://linear.app/${orgName.trim()}/issue/TEAM-123`;
  if (tracker === 'jira') return `https://${orgName.trim()}.atlassian.net/browse/TEAM-123`;
  if (tracker === 'github') return `https://github.com/${orgName.trim() || 'owner'}/repo/issues/123`;
  return null;
}

export function IssueTracking() {
  const [config, setConfig] = useState<TrackerConfig>({
    tracker: 'linear',
    orgName: '',
    githubRepo: '',
    githubLabels: '',
    linearApiKeyConfigured: false,
  });
  const [linearApiKey, setLinearApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/settings/issue-tracker')
      .then((r) => r.json())
      .then((data: TrackerConfig) => { setConfig(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    const payload: SavePayload = {
      tracker: config.tracker,
      orgName: config.orgName,
      githubRepo: config.githubRepo,
      githubLabels: config.githubLabels,
    };
    // Only send the key when the user has typed something — lets them save
    // other fields without re-entering the secret.
    if (linearApiKey.length > 0) {
      payload.linearApiKey = linearApiKey;
    }
    const res = await fetch('/api/settings/issue-tracker', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = (await res.json()) as TrackerConfig;
      setConfig(data);
      setLinearApiKey('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  async function handleClearKey() {
    const res = await fetch('/api/settings/issue-tracker', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tracker: config.tracker,
        orgName: config.orgName,
        githubRepo: config.githubRepo,
        githubLabels: config.githubLabels,
        linearApiKey: '',
      } as SavePayload),
    });
    if (res.ok) {
      const data = (await res.json()) as TrackerConfig;
      setConfig(data);
      setLinearApiKey('');
    }
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
            <option value="github">GitHub</option>
            <option value="none">None</option>
          </select>
        </div>

        {/* Org / domain */}
        {config.tracker !== 'none' && (
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              {config.tracker === 'linear'
                ? 'Linear org name'
                : config.tracker === 'github'
                ? 'GitHub owner/org (optional)'
                : 'Jira domain'}
            </label>
            <input
              type="text"
              value={config.orgName}
              onChange={(e) => setConfig((prev) => ({ ...prev, orgName: e.target.value }))}
              placeholder={
                config.tracker === 'linear'
                  ? 'e.g. myorg'
                  : config.tracker === 'github'
                  ? 'e.g. my-org'
                  : 'e.g. mycompany'
              }
              className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 w-72"
            />
            {config.tracker === 'github' && (
              <p className="text-[11px] text-gray-500 mt-2">
                Optional — scopes imported issues to this owner. Leave blank for all issues assigned to you.
                Uses the local <span className="font-mono">gh</span> CLI, which must be authenticated
                (<span className="font-mono">gh auth login</span>).
              </p>
            )}
            {previewUrl && (
              <p className="text-[11px] text-gray-500 mt-2">
                Links will look like:{' '}
                <span className="text-blue-400 font-mono">{previewUrl}</span>
              </p>
            )}
          </div>
        )}

        {config.tracker === 'github' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Default repo for new issues
              </label>
              <input
                type="text"
                value={config.githubRepo}
                onChange={(e) => setConfig((prev) => ({ ...prev, githubRepo: e.target.value }))}
                placeholder="e.g. owner/repo"
                className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 w-72 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Default labels (comma-separated)
              </label>
              <input
                type="text"
                value={config.githubLabels}
                onChange={(e) => setConfig((prev) => ({ ...prev, githubLabels: e.target.value }))}
                placeholder="e.g. enhancement, triage"
                className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 w-72"
              />
              <p className="text-[11px] text-gray-500 mt-2">
                Prefilled when creating a GitHub issue from a todo; you confirm or change them each
                time.
              </p>
            </div>
          </div>
        )}

        {/* Linear API key — required for the Kanban "Import from Linear" feature */}
        {config.tracker === 'linear' && (
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              Linear API key{' '}
              {config.linearApiKeyConfigured && (
                <span className="text-emerald-400 text-[11px] ml-1">• configured</span>
              )}
            </label>
            <input
              type="password"
              value={linearApiKey}
              onChange={(e) => setLinearApiKey(e.target.value)}
              placeholder={
                config.linearApiKeyConfigured
                  ? '•••••••••••••••••• (leave blank to keep existing)'
                  : 'lin_api_...'
              }
              className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 w-96 font-mono"
            />
            <p className="text-[11px] text-gray-500 mt-2">
              {config.orgName.trim() ? (
                <>
                  Generate a Personal API key at{' '}
                  <a
                    href={`https://linear.app/${config.orgName.trim()}/settings/account/security`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    linear.app/{config.orgName.trim()}/settings/account/security
                  </a>
                  . Used to list and import tickets assigned to you.
                </>
              ) : (
                <>
                  Generate a Personal API key from Linear: open Linear, then go to
                  Settings → Account → Security &amp; access → Personal API keys.
                  Used to list and import tickets assigned to you.
                </>
              )}
            </p>
            {config.linearApiKeyConfigured && (
              <button
                onClick={handleClearKey}
                className="mt-2 text-[11px] text-red-400 hover:text-red-300"
              >
                Clear stored key
              </button>
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
