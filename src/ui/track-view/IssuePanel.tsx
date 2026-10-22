import { useState } from 'react';
import type { ExternalIssue, IssueSource, IssueRelationship } from '@foundation/types';

interface Props {
  trackId: string;
  issues: ExternalIssue[];
  onUpdate: () => void;
}

export function IssuePanel({ trackId, issues, onUpdate }: Props) {
  const [showAdd, setShowAdd] = useState(false);

  async function removeIssue(issueId: string) {
    await fetch(`/api/tracks/${trackId}/issues/${issueId}`, { method: 'DELETE' });
    onUpdate();
  }

  async function addIssue(
    source: IssueSource,
    externalId: string,
    relationship: IssueRelationship,
  ) {
    await fetch(`/api/tracks/${trackId}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, externalId, relationship }),
    });
    setShowAdd(false);
    onUpdate();
  }

  return (
    <div className="p-4 border-b border-gray-800">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-300">Issues</h3>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          + Link
        </button>
      </div>

      {showAdd && <AddIssueForm onAdd={addIssue} onCancel={() => setShowAdd(false)} />}

      {issues.length > 0 ? (
        <ul className="space-y-2">
          {issues.map((issue) => (
            <li
              key={issue.id}
              className="flex items-start justify-between group text-sm"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-blue-400">{issue.externalId}</span>
                  <span className="text-xs text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">
                    {issue.source}
                  </span>
                  <span className="text-xs text-gray-600">{issue.relationship}</span>
                </div>
                {issue.cachedTitle && (
                  <p className="text-xs text-gray-400 mt-0.5">{issue.cachedTitle}</p>
                )}
                {issue.cachedStatus && (
                  <span className="text-xs text-gray-500">{issue.cachedStatus}</span>
                )}
              </div>
              <button
                onClick={() => removeIssue(issue.id)}
                className="text-xs text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 shrink-0 ml-2"
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-gray-600 italic">No issues linked.</p>
      )}
    </div>
  );
}

function AddIssueForm({
  onAdd,
  onCancel,
}: {
  onAdd: (source: IssueSource, externalId: string, relationship: IssueRelationship) => void;
  onCancel: () => void;
}) {
  const [source, setSource] = useState<IssueSource>('jira');
  const [externalId, setExternalId] = useState('');
  const [relationship, setRelationship] = useState<IssueRelationship>('related');

  return (
    <div className="mb-3 space-y-2 p-2 bg-gray-800/50 rounded">
      <div className="flex gap-2">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as IssueSource)}
          className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs"
        >
          <option value="jira">Jira</option>
          <option value="linear">Linear</option>
          <option value="github">GitHub</option>
        </select>
        <input
          value={externalId}
          onChange={(e) => setExternalId(e.target.value)}
          placeholder="PROJ-123"
          className="flex-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs font-mono"
          autoFocus
        />
      </div>
      <select
        value={relationship}
        onChange={(e) => setRelationship(e.target.value as IssueRelationship)}
        className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs"
      >
        <option value="primary">Primary</option>
        <option value="related">Related</option>
        <option value="blocked-by">Blocked By</option>
      </select>
      <div className="flex gap-2">
        <button
          onClick={() => externalId.trim() && onAdd(source, externalId.trim(), relationship)}
          className="text-xs text-blue-400"
        >
          Link
        </button>
        <button onClick={onCancel} className="text-xs text-gray-500">
          Cancel
        </button>
      </div>
    </div>
  );
}
