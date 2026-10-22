/**
 * Resolves inter-issue dependencies and detects when blocked issues become unblocked.
 */
import type { WorkflowIssueId } from '@foundation/types.js';
import type { WorkflowIssueRepository, IssueDependencyRepository } from '@domain/workflow/issue-repository.js';
import type { TopologyLoader } from './topology-loader.js';
import { isTerminal } from '@domain/workflow/types.js';

export interface DependencyResolver {
  /** Check if all dependencies for an issue are resolved */
  allResolved(issueId: WorkflowIssueId): boolean;

  /** Resolve dependency and return issues that became unblocked */
  resolveAndUnblock(completedIssueId: WorkflowIssueId): WorkflowIssueId[];

  /** Check if all child tasks of an epic are done */
  allChildrenDone(epicId: WorkflowIssueId): boolean;
}

export interface DependencyResolverDeps {
  issues: WorkflowIssueRepository;
  dependencies: IssueDependencyRepository;
  topologyLoader: TopologyLoader;
}

export function createDependencyResolver(deps: DependencyResolverDeps): DependencyResolver {
  const { issues, dependencies, topologyLoader } = deps;

  /** Check if an issue is in a terminal state using topology or fallback. */
  function checkIsTerminal(issue: { state: string; playbookRowId?: string }): boolean {
    try {
      if (issue.playbookRowId) {
        const stages = topologyLoader.loadByPlaybookRowId(issue.playbookRowId);
        return isTerminal(stages, issue.state);
      }
    } catch {
      // Playbook not found — fall through to hardcoded check
    }
    return issue.state === 'done' || issue.state === 'cancelled' || issue.state === 'merged';
  }

  return {
    allResolved(issueId: WorkflowIssueId): boolean {
      const unresolved = dependencies.findUnresolved(issueId);
      return unresolved.length === 0;
    },

    resolveAndUnblock(completedIssueId: WorkflowIssueId): WorkflowIssueId[] {
      const dependents = dependencies.findDependents(completedIssueId);
      const unblockedIds: WorkflowIssueId[] = [];

      for (const dep of dependents) {
        dependencies.resolve(dep.issueId, completedIssueId);

        const remaining = dependencies.findUnresolved(dep.issueId);
        if (remaining.length === 0) {
          const issue = issues.findById(dep.issueId);
          if (issue && issue.state === 'blocked') {
            unblockedIds.push(dep.issueId);
          }
        }
      }

      return unblockedIds;
    },

    allChildrenDone(epicId: WorkflowIssueId): boolean {
      const children = issues.findChildren(epicId);
      if (children.length === 0) return false;
      return children.every((child) => checkIsTerminal(child));
    },
  };
}
