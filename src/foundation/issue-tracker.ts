/**
 * Shared helpers for turning a todo's `issueKey` into a browser link, across the
 * three supported trackers. Kept dependency-free so both the server and the UI
 * can import it.
 *
 * Key formats:
 *   - linear / jira: "TEAM-123"          → base + key
 *   - github:        "owner/repo#123"    → base + "owner/repo/issues/123"
 */

/** Base URL (issueKey appended via {@link issueHref}) for the configured tracker. */
export function issueBaseUrlFor(tracker: string | undefined, orgName: string | undefined): string | undefined {
  const org = orgName?.trim();
  if (tracker === 'github') return 'https://github.com/';
  if (!org) return undefined;
  if (tracker === 'linear') return `https://linear.app/${org}/issue/`;
  if (tracker === 'jira') return `https://${org}.atlassian.net/browse/`;
  return undefined;
}

/** Full link to an issue, or undefined when we lack a base or key. */
export function issueHref(base: string | undefined, key: string | undefined): string | undefined {
  if (!base || !key) return undefined;
  // GitHub keys ("owner/repo#123") expand to a repo-scoped issue path.
  return base + (key.includes('#') ? key.replace('#', '/issues/') : key);
}

/** True when an issueKey belongs to GitHub (only GitHub keys carry a "#"). */
export function isGithubIssueKey(key: string | undefined): boolean {
  return !!key && key.includes('#');
}
