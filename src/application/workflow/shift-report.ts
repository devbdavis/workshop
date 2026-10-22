/**
 * Dark Factory "shift report" — a compact summary produced when an autonomous
 * issue comes to rest (waiting for merge, escalated, or done). The human's
 * interface to a lights-out run is this report, not the session transcripts.
 *
 * Reads only data already recorded: the transition audit log, the SubagentStop
 * progress feed (stateData.agentProgress), and PR links.
 */
import type { WorkflowIssue } from '@foundation/types.js';
import type { WorkflowTransitionRepository } from '@domain/workflow/issue-repository.js';
import type { TopologyLoader } from './topology-loader.js';
import { isTerminal } from '@domain/workflow/types.js';

export interface ShiftReport {
  generatedAt: string;
  reason: 'escalated' | 'awaiting-merge' | 'done';
  markdown: string;
  stepsUsed: number;
}

export interface ShiftReportDeps {
  transitions: WorkflowTransitionRepository;
  topologyLoader: TopologyLoader;
}

interface AgentProgressEntry {
  agentRole?: string;
  summary?: string;
  timestamp?: string;
}

const PR_URL_RE = /https?:\/\/\S+?\/(?:pull|pulls|merge_requests)\/\d+/g;

function detectReason(issue: WorkflowIssue, deps: ShiftReportDeps): ShiftReport['reason'] {
  const sd = (issue.stateData || {}) as Record<string, unknown>;
  if (sd.needsHuman === true) return 'escalated';
  try {
    const stages = deps.topologyLoader.loadForIssue(issue);
    if (isTerminal(stages, issue.state)) return 'done';
  } catch {
    if (['done', 'merged', 'cancelled'].includes(issue.state)) return 'done';
  }
  return 'awaiting-merge';
}

function findPrLinks(issue: WorkflowIssue): string[] {
  const haystack = JSON.stringify(issue.stateData ?? {}) + '\n' + (issue.description ?? '');
  const found = haystack.match(PR_URL_RE) ?? [];
  return Array.from(new Set(found));
}

export function generateShiftReport(
  issue: WorkflowIssue,
  deps: ShiftReportDeps,
  generatedAt: string = new Date().toISOString(),
): ShiftReport {
  const sd = (issue.stateData || {}) as Record<string, unknown>;
  const reason = detectReason(issue, deps);
  const stepsUsed = typeof sd.stepCount === 'number' ? sd.stepCount : 0;

  const progress = Array.isArray(sd.agentProgress) ? (sd.agentProgress as AgentProgressEntry[]) : [];
  const history = deps.transitions.findByIssue(issue.id, 100);
  const prLinks = findPrLinks(issue);

  const testTransition = [...history]
    .reverse()
    .find((t) => typeof t.comment === 'string' && /test|lint|typecheck|green|passing/i.test(t.comment));

  const lines: string[] = [];

  // Header
  const headline =
    reason === 'escalated'
      ? '⚠️ Escalated — needs your attention'
      : reason === 'done'
        ? '✅ Done'
        : '✅ Ready for your review — draft PR open, waiting to merge';
  lines.push(`## ${headline}`, '');
  lines.push(`**${issue.title}** · ${stepsUsed} step${stepsUsed === 1 ? '' : 's'} used`, '');

  // What happened
  lines.push('### What happened', '');
  if (progress.length > 0) {
    for (const p of progress.slice(-12)) {
      const role = p.agentRole ? `**${p.agentRole}**: ` : '';
      lines.push(`- ${role}${p.summary ?? ''}`.trimEnd());
    }
  } else {
    lines.push('- (no sub-agent progress recorded)');
  }
  lines.push('');

  // Timeline
  lines.push('### Timeline', '');
  for (const t of history.slice(0, 20)) {
    const actor = t.actor?.type ?? 'system';
    const note = t.comment ? ` — ${t.comment}` : '';
    lines.push(`- \`${t.fromState}\` → \`${t.toState}\` (${actor})${note}`);
  }
  lines.push('');

  // Result
  lines.push('### Result', '');
  if (testTransition) {
    lines.push(`- Tests/checks: ${testTransition.comment}`);
  }
  if (prLinks.length > 0) {
    lines.push('- Pull request(s):');
    for (const url of prLinks) lines.push(`  - ${url}`);
  } else {
    lines.push('- No PR link detected yet.');
  }
  lines.push('');

  // Needs attention
  if (reason === 'escalated') {
    const last = history[0];
    lines.push('### Needs your attention', '');
    lines.push(
      `- The run stopped early and is waiting for you at \`${issue.state}\`.` +
        (last?.comment ? ` Reason: ${last.comment}` : ''),
    );
    lines.push('');
  }

  return { generatedAt, reason, markdown: lines.join('\n').trim(), stepsUsed };
}
