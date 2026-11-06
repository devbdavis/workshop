import { useEffect, useState } from 'react';

const TRACKER_LABELS: Record<string, string> = { linear: 'Linear', jira: 'Jira', github: 'GitHub' };

/** The configured issue tracker kind (undefined while loading, 'none' on error). */
export function useIssueTracker(): string | undefined {
  const [tracker, setTracker] = useState<string>();
  useEffect(() => {
    fetch('/api/settings/issue-tracker')
      .then((r) => r.json())
      .then((d: { tracker: string }) => setTracker(d.tracker))
      .catch(() => setTracker('none'));
  }, []);
  return tracker;
}

/** "Import from GitHub" etc., or a generic label when no tracker is configured. */
export function importLabel(tracker: string | undefined): string {
  const name = tracker && TRACKER_LABELS[tracker];
  return name ? `Import from ${name}` : 'Import issues';
}
