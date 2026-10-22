import { Router } from 'express';
import type { WorkflowIssueId, WorkflowState, WorkflowIssueType, TrackId, WorkflowIssue } from '@foundation/types.js';
import type {
  WorkflowIssueRepository,
  WorkflowTransitionRepository,
  IssueDependencyRepository,
} from '@domain/workflow/issue-repository.js';
import type { WorkflowEngine } from '@application/workflow/engine.js';
import type { DispatchCoordinator } from '@application/workflow/dispatch-coordinator.js';
import type { TopologyLoader } from '@application/workflow/topology-loader.js';
import type { PlaybookRepository } from '@domain/workflow/playbook-repository.js';
import { listTemplates, ensurePlaybookForTemplate } from '@application/workflow/template-loader.js';
import { DEFAULT_AUTONOMOUS_BUDGET } from '@application/workflow/autonomy.js';
import { broadcast } from './events.js';

export interface WorkflowRouterDeps {
  engine: WorkflowEngine;
  issues: WorkflowIssueRepository;
  transitions: WorkflowTransitionRepository;
  dependencies: IssueDependencyRepository;
  /** Unified dispatch coordinator — handles agent dispatch for all actionable states */
  dispatcher?: DispatchCoordinator;
  /** Optional topology loader for enriching responses with semantic info */
  topologyLoader?: TopologyLoader;
  /** Playbook registry — required for Dark Factory template seeding */
  playbooks?: PlaybookRepository;
  /** Repo root, used to locate templates/playbooks/*.json */
  projectRoot?: string;
}

/**
 * Enrich an issue with semantic role info from its workflow playbook.
 * This adds currentStateSemanticRole, currentStateHumanGate, currentStateAgentActionable
 * to the issue's stateData for UI rendering.
 */
function enrichIssueWithSemanticInfo(
  issue: WorkflowIssue,
  topologyLoader?: TopologyLoader
): WorkflowIssue {
  if (!topologyLoader || !issue.playbookRowId) {
    return issue;
  }

  try {
    const stages = topologyLoader.loadForIssue(issue);
    const stage = stages.find(s => s.state === issue.state);

    if (!stage) {
      return issue;
    }

    // Merge semantic info into stateData (don't overwrite existing stateData)
    const enrichedStateData = {
      ...issue.stateData,
      currentStateSemanticRole: stage.semanticRole,
      currentStateHumanGate: stage.humanGate,
      currentStateAgentActionable: stage.agentActionable,
    };

    return { ...issue, stateData: enrichedStateData };
  } catch {
    // Playbook not found or loading failed — return issue as-is
    return issue;
  }
}

export function createWorkflowRouter(deps: WorkflowRouterDeps): Router {
  const router = Router();
  const { engine, issues, transitions, dependencies, dispatcher, topologyLoader, playbooks, projectRoot } = deps;

  // --- Dark Factory: list available templates ---

  router.get('/workflow/templates', (_req, res) => {
    if (!projectRoot) {
      res.json([]);
      return;
    }
    res.json(listTemplates(projectRoot));
  });

  // --- Dark Factory: create an autonomous epic from a template ---

  router.post('/workflow/issues/from-template', async (req, res) => {
    const { title, description, trackId, provider, priority, templateSlug, autonomous, budget } = req.body;

    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    if (!templateSlug || typeof templateSlug !== 'string') {
      res.status(400).json({ error: 'templateSlug is required' });
      return;
    }
    if (!playbooks || !projectRoot) {
      res.status(503).json({ error: 'Template seeding not available' });
      return;
    }

    try {
      const playbookRowId = ensurePlaybookForTemplate(projectRoot, templateSlug, playbooks);

      let issue = engine.createEpic({
        title,
        description: description || '',
        trackId: trackId as TrackId | undefined,
        provider,
        priority,
        playbookRowId,
      });

      // Mark the epic autonomous (opt-out via autonomous:false) and set the budget.
      const updated = issues.update(issue.id, {
        stateData: {
          ...(issue.stateData || {}),
          autonomous: autonomous !== false,
          autonomousBudget: budget ?? DEFAULT_AUTONOMOUS_BUDGET,
        },
      });
      if (updated) issue = updated;

      // Kick off the pipeline; the coordinator auto-advances gates for autonomous epics.
      if (dispatcher) {
        await dispatcher.dispatchForCurrentState(issue.id);
        const refreshed = issues.findById(issue.id);
        if (refreshed) issue = refreshed;
      }

      broadcast('workflow:created', issue.id);
      res.status(201).json(issue);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create issue from template';
      res.status(400).json({ error: message });
    }
  });

  // --- List all workflow issues ---

  router.get('/workflow/issues', (req, res) => {
    const { type, state, trackId, parentId } = req.query;
    const filters: {
      type?: WorkflowIssueType;
      state?: WorkflowState;
      trackId?: TrackId;
      parentId?: WorkflowIssueId;
    } = {};

    if (type) filters.type = type as WorkflowIssueType;
    if (state) filters.state = state as WorkflowState;
    if (trackId) filters.trackId = trackId as TrackId;
    if (parentId) filters.parentId = parentId as WorkflowIssueId;

    const rawIssues = issues.findAll(filters);
    // Enrich each issue with semantic info from its playbook
    const enrichedIssues = rawIssues.map(t => enrichIssueWithSemanticInfo(t, topologyLoader));
    res.json(enrichedIssues);
  });

  // --- Get single workflow issue ---

  router.get('/workflow/issues/:id', (req, res) => {
    const issue = issues.findById(req.params.id as WorkflowIssueId);
    if (!issue) {
      res.status(404).json({ error: 'Workflow issue not found' });
      return;
    }

    // Populate childIds
    const children = issues.findChildren(issue.id);
    issue.childIds = children.map((c) => c.id);

    // Enrich with semantic info from playbook
    const enriched = enrichIssueWithSemanticInfo(issue, topologyLoader);
    res.json(enriched);
  });

  // --- Create epic from pre-written plan (starts at plan-review) ---

  router.post('/workflow/issues/from-plan', (req, res) => {
    const { title, description, planDraft, trackId, provider, priority } = req.body;

    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    if (!planDraft || typeof planDraft !== 'string') {
      res.status(400).json({ error: 'planDraft is required' });
      return;
    }

    try {
      const issue = engine.createEpicAtPlanReview({
        title,
        description: description || '',
        planDraft,
        trackId: trackId as TrackId | undefined,
        provider,
        priority,
      });

      broadcast('workflow:created', issue.id);
      res.status(201).json(issue);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create issue';
      res.status(400).json({ error: message });
    }
  });

  // --- Create workflow issue (epic or task) ---

  router.post('/workflow/issues', async (req, res) => {
    const { type, title, description, trackId, parentId, provider, priority, dependsOn } = req.body;

    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    if (!type || (type !== 'epic' && type !== 'task')) {
      res.status(400).json({ error: "type must be 'epic' or 'task'" });
      return;
    }

    try {
      let issue;
      if (type === 'epic') {
        issue = engine.createEpic({
          title,
          description: description || '',
          trackId: trackId as TrackId | undefined,
          provider,
          priority,
        });
      } else {
        if (!parentId) {
          res.status(400).json({ error: 'parentId is required for tasks' });
          return;
        }
        issue = engine.createTask({
          title,
          description: description || '',
          parentId: parentId as WorkflowIssueId,
          provider,
          priority,
          dependsOn: dependsOn as WorkflowIssueId[] | undefined,
        });
      }

      // Dispatch agents if the initial state is agent-actionable (e.g. epic → triaging)
      if (dispatcher) {
        await dispatcher.dispatchForCurrentState(issue.id);
        // Re-read to get updated stateData with session IDs
        const refreshed = issues.findById(issue.id);
        if (refreshed) issue = refreshed;
      }

      broadcast('workflow:created', issue.id);
      res.status(201).json(issue);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create issue';
      res.status(400).json({ error: message });
    }
  });

  // --- Update workflow issue ---

  router.put('/workflow/issues/:id', (req, res) => {
    const issueId = req.params.id as WorkflowIssueId;
    const existing = issues.findById(issueId);
    if (!existing) {
      res.status(404).json({ error: 'Workflow issue not found' });
      return;
    }

    const { title, description, trackId, priority, labels, sortOrder, stateData,
      assignedAgentRole, assignedAgentIds, provider, state, playbookRowId } = req.body;

    const updated = issues.update(issueId, {
      title,
      description,
      trackId: trackId !== undefined ? (trackId || undefined) as TrackId : undefined,
      priority,
      labels,
      sortOrder,
      stateData,
      playbookRowId,
      assignedAgentRole,
      assignedAgentIds,
      provider,
      ...(state && { state, stateChangedAt: new Date().toISOString() }),
    });

    if (!updated) {
      res.status(500).json({ error: 'Failed to update issue' });
      return;
    }

    broadcast('workflow:updated', issueId);
    res.json(updated);
  });

  // --- Delete workflow issue ---

  router.delete('/workflow/issues/:id', (req, res) => {
    const issueId = req.params.id as WorkflowIssueId;
    const deleted = issues.delete(issueId);
    if (!deleted) {
      res.status(404).json({ error: 'Workflow issue not found' });
      return;
    }
    broadcast('workflow:deleted', issueId);
    res.status(204).send();
  });

  // --- Transition issue to new state ---

  router.post('/workflow/issues/:id/transition', async (req, res) => {
    const issueId = req.params.id as WorkflowIssueId;
    const { toState, comment, actor, data } = req.body;

    if (!toState || typeof toState !== 'string') {
      res.status(400).json({ error: 'toState is required' });
      return;
    }

    try {
      const transitionActor = actor || { type: 'human' as const };
      let updated;

      if (dispatcher) {
        updated = await dispatcher.transitionWithDispatch(
          issueId,
          toState as WorkflowState,
          transitionActor,
          comment,
          data,
        );
      } else {
        updated = engine.transition(issueId, toState as WorkflowState, transitionActor, comment, data);
        if (toState === 'done') engine.onTaskCompleted(issueId);
      }

      broadcast('workflow:transitioned', issueId);
      res.json(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transition failed';
      res.status(400).json({ error: message });
    }
  });

  // --- Approve at human gate ---

  router.post('/workflow/issues/:id/approve', async (req, res) => {
    const issueId = req.params.id as WorkflowIssueId;
    const { comment } = req.body || {};

    try {
      let updated;
      if (dispatcher) {
        updated = await dispatcher.approveWithDispatch(issueId, comment);
      } else {
        updated = engine.approve(issueId, comment);
      }
      broadcast('workflow:approved', issueId);
      res.json(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Approval failed';
      res.status(400).json({ error: message });
    }
  });

  // --- Reject at human gate ---

  router.post('/workflow/issues/:id/reject', async (req, res) => {
    const issueId = req.params.id as WorkflowIssueId;
    const { comment } = req.body || {};

    try {
      let updated;
      if (dispatcher) {
        updated = await dispatcher.reject(issueId, comment);
      } else {
        updated = engine.reject(issueId, comment);
      }
      broadcast('workflow:rejected', issueId);
      res.json(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Rejection failed';
      res.status(400).json({ error: message });
    }
  });

  // --- Dispatch agents for current state (retry / manual trigger) ---

  router.post('/workflow/issues/:id/dispatch', async (req, res) => {
    const issueId = req.params.id as WorkflowIssueId;
    if (!dispatcher) {
      res.status(503).json({ error: 'Dispatch coordinator not available' });
      return;
    }
    try {
      await dispatcher.dispatchForCurrentState(issueId);
      const refreshed = issues.findById(issueId);
      broadcast('workflow:dispatched', issueId);
      res.json(refreshed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Dispatch failed';
      res.status(400).json({ error: message });
    }
  });

  // --- Get transition history ---

  router.get('/workflow/issues/:id/transitions', (req, res) => {
    const issueId = req.params.id as WorkflowIssueId;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const history = transitions.findByIssue(issueId, limit);
    res.json(history);
  });

  // --- Get dependencies ---

  router.get('/workflow/issues/:id/dependencies', (req, res) => {
    const issueId = req.params.id as WorkflowIssueId;
    const deps = dependencies.findByIssue(issueId);
    res.json(deps);
  });

  // --- Add dependency ---

  router.post('/workflow/issues/:id/dependencies', (req, res) => {
    const issueId = req.params.id as WorkflowIssueId;
    const { dependsOnId } = req.body;

    if (!dependsOnId || typeof dependsOnId !== 'string') {
      res.status(400).json({ error: 'dependsOnId is required' });
      return;
    }

    // Verify both issues exist
    const issue = issues.findById(issueId);
    if (!issue) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }
    const depIssue = issues.findById(dependsOnId as WorkflowIssueId);
    if (!depIssue) {
      res.status(404).json({ error: 'Dependency issue not found' });
      return;
    }

    const dep = dependencies.create(issueId, dependsOnId as WorkflowIssueId);
    broadcast('workflow:updated', issueId);
    res.status(201).json(dep);
  });

  // --- Remove dependency ---

  router.delete('/workflow/issues/:id/dependencies/:depId', (req, res) => {
    const issueId = req.params.id as WorkflowIssueId;
    const dependsOnId = req.params.depId as WorkflowIssueId;

    const deleted = dependencies.delete(issueId, dependsOnId);
    if (!deleted) {
      res.status(404).json({ error: 'Dependency not found' });
      return;
    }
    broadcast('workflow:updated', issueId);
    res.status(204).send();
  });

  return router;
}
