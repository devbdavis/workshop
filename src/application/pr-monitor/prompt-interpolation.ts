import type { PrComment, PrCheckSummary, PrMonitor } from '@foundation/types';

export interface PrPromptContext {
  monitor: PrMonitor;
  /** Subset of comments to interpolate; defaults to `monitor.unresolvedComments`. */
  comments?: PrComment[];
}

function formatChecks(checks: PrCheckSummary[]): string {
  if (checks.length === 0) return '_(no failing checks reported)_';
  return checks
    .map((c) => {
      const link = c.detailsUrl ? ` ([details](${c.detailsUrl}))` : '';
      const verdict = c.conclusion ?? c.status ?? 'failed';
      const summary = c.summary ? `\n  > ${c.summary.replace(/\n/g, '\n  > ')}` : '';
      return `- **${c.name}** — ${verdict}${link}${summary}`;
    })
    .join('\n');
}

function formatComments(comments: PrComment[]): string {
  if (comments.length === 0) return '_(no unresolved comments)_';
  return comments
    .map((c) => {
      const location = c.path
        ? ` on \`${c.path}${c.line !== undefined ? `:${c.line}` : ''}\``
        : '';
      const link = c.url ? ` ([link](${c.url}))` : '';
      const body = c.body.trim().length > 0 ? c.body : '_(empty body)_';
      return `### ${c.author}${location} (id: \`${c.id}\`)${link}\n\n${body}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Replace `{{pr.*}}` placeholders in a template that has already been run
 * through {@link interpolateTemplate} (for track/todo vars). Unknown PR vars
 * are left in place so a typo in a custom template is visible to the user
 * rather than silently dropped.
 */
export function interpolatePrTemplate(template: string, ctx: PrPromptContext): string {
  const m = ctx.monitor;
  const comments = ctx.comments ?? m.unresolvedComments;

  return template.replace(/\{\{pr\.([^}]+)\}\}/g, (match, rawKey: string) => {
    const key = rawKey.trim();
    switch (key) {
      case 'url':
        return m.prUrl;
      case 'title':
        return m.prTitle ?? `PR #${m.prNumber}`;
      case 'number':
        return String(m.prNumber);
      case 'branch':
        return m.prBranch ?? '';
      case 'repo':
        return `${m.repoOwner}/${m.repoName}`;
      case 'state':
        return m.state;
      case 'check_status':
        return m.checkStatus;
      case 'failing_checks':
        return formatChecks(m.failingChecks);
      case 'comments':
        return formatComments(comments);
      default:
        return match;
    }
  });
}
