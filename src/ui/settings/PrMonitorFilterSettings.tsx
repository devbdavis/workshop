import { useState, useEffect } from 'react';

export function PrMonitorFilterSettings() {
  const [authorsText, setAuthorsText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [saved, setSaved] = useState<boolean>(false);

  useEffect(() => {
    fetch('/api/settings/pr-monitor-ignored-authors')
      .then((r) => r.json())
      .then((d: { authors: string[] }) => setAuthorsText(d.authors.join('\n')))
      .catch(() => { /* keep default */ })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(): Promise<void> {
    const authors = authorsText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    try {
      const res = await fetch('/api/settings/pr-monitor-ignored-authors', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authors }),
      });
      const d = (await res.json()) as { authors: string[] };
      setAuthorsText(d.authors.join('\n'));
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
      <h2 className="text-sm font-semibold text-gray-200 mb-1">PR Monitor Comment Filter</h2>
      <p className="text-xs text-gray-500 mb-4">
        Author-login substrings to hide from the PR monitor&apos;s comment feed (your own outgoing PRs), one per
        line. Matching is a case-insensitive substring against the GitHub comment author&apos;s login — GitHub
        doesn&apos;t flag bots, so this is the only way to tell them apart. Humans and unlisted bots (CodeRabbit,
        Cursor/bugbot) are always kept. CI failures come from checks, not comments, so this list has no effect
        on them.
      </p>
      <textarea
        value={authorsText}
        onChange={(e) => setAuthorsText(e.target.value)}
        onBlur={handleSave}
        rows={6}
        placeholder="trunk-io"
        className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 w-72 font-mono"
      />
      {saved && <span className="ml-2 text-xs text-green-400">Saved</span>}
    </div>
  );
}
