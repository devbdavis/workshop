import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerWorkflowTools(
  server: McpServer,
  api: (path: string, options?: RequestInit) => Promise<any>,
): void {
  server.tool(
    'workshop_list_workflow_issues',
    'List workflow issues. Optionally filter by type (epic/task), state, trackId, or parentId.',
    {
      type: z.enum(['epic', 'task']).optional().describe('Filter by issue type'),
      state: z.string().optional().describe('Filter by workflow state'),
      trackId: z.string().optional().describe('Filter by track ID'),
      parentId: z.string().optional().describe('Filter by parent epic ID'),
    },
    async ({ type, state, trackId, parentId }) => {
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      if (state) params.set('state', state);
      if (trackId) params.set('trackId', trackId);
      if (parentId) params.set('parentId', parentId);
      const qs = params.toString();
      const path = `/workflow/issues${qs ? `?${qs}` : ''}`;
      const result = await api(path);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_get_workflow_issue',
    'Get a single workflow issue with its children and transition history.',
    {
      issueId: z.string().describe('The workflow issue ID'),
    },
    async ({ issueId }) => {
      const issue = await api(`/workflow/issues/${issueId}`);
      const history = await api(`/workflow/issues/${issueId}/transitions`);
      const deps = await api(`/workflow/issues/${issueId}/dependencies`);
      const result = { ...issue, transitions: history, dependencies: deps };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_update_issue',
    'Update a workflow issue\'s title, description, or stateData. Use this to refine the spec after triage Q&A loops. stateData fields are shallow-merged with existing values (won\'t wipe other fields).',
    {
      issueId: z.string().describe('The workflow issue ID'),
      title: z.string().optional().describe('Updated title'),
      description: z.string().optional().describe('Updated description / spec text'),
      stateData: z.record(z.unknown()).optional().describe('State data fields to merge (shallow merge with existing stateData)'),
    },
    async ({ issueId, title, description, stateData }) => {
      const body: Record<string, unknown> = {};
      if (title !== undefined) body.title = title;
      if (description !== undefined) body.description = description;
      // Merge stateData with existing to avoid wiping other fields
      if (stateData !== undefined) {
        const existing = await api(`/workflow/issues/${issueId}`);
        const existingStateData = (existing?.stateData ?? {}) as Record<string, unknown>;
        body.stateData = { ...existingStateData, ...stateData };
      }
      const result = await api(`/workflow/issues/${issueId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_create_epic',
    'Create a new workflow epic. Starts in idea state and auto-transitions to triaging.',
    {
      title: z.string().describe('Epic title'),
      description: z.string().describe('Epic description / spec'),
      trackId: z.string().optional().describe('Track ID to bind to'),
      provider: z.enum(['claude', 'codex']).optional().describe('AI CLI (default: claude)'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Priority'),
    },
    async ({ title, description, trackId, provider, priority }) => {
      const body: Record<string, unknown> = { type: 'epic', title, description };
      if (trackId) body.trackId = trackId;
      if (provider) body.provider = provider;
      if (priority) body.priority = priority;
      const result = await api('/workflow/issues', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_create_task',
    'Create an implementation task under a workflow epic.',
    {
      title: z.string().describe('Task title'),
      description: z.string().describe('Task description'),
      parentId: z.string().describe('Parent epic ID'),
      provider: z.enum(['claude', 'codex']).optional().describe('AI CLI (default: claude)'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Priority'),
      dependsOn: z.array(z.string()).optional().describe('IDs of issues this task depends on'),
    },
    async ({ title, description, parentId, provider, priority, dependsOn }) => {
      const body: Record<string, unknown> = { type: 'task', title, description, parentId };
      if (provider) body.provider = provider;
      if (priority) body.priority = priority;
      if (dependsOn) body.dependsOn = dependsOn;
      const result = await api('/workflow/issues', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_transition_issue',
    'Transition a workflow issue to a new state. Use the data param to pass structured state data (e.g. pendingQuestions for needs-input).',
    {
      issueId: z.string().describe('The workflow issue ID'),
      toState: z.string().describe('Target state'),
      comment: z.string().optional().describe('Transition comment'),
      data: z.record(z.unknown()).optional().describe('Structured state data to merge into issue stateData (e.g. { pendingQuestions: [{ text: "..." }] })'),
    },
    async ({ issueId, toState, comment, data }) => {
      const body: Record<string, unknown> = { toState };
      if (comment) body.comment = comment;
      if (data) body.data = data;
      const result = await api(`/workflow/issues/${issueId}/transition`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_approve_issue',
    'Approve a workflow issue at a human gate (spec-review, plan-review, final-review).',
    {
      issueId: z.string().describe('The workflow issue ID'),
      comment: z.string().optional().describe('Approval comment'),
    },
    async ({ issueId, comment }) => {
      const body: Record<string, unknown> = {};
      if (comment) body.comment = comment;
      const result = await api(`/workflow/issues/${issueId}/approve`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_reject_issue',
    'Reject a workflow issue at a human gate, sending it back for revision.',
    {
      issueId: z.string().describe('The workflow issue ID'),
      comment: z.string().optional().describe('Rejection feedback'),
    },
    async ({ issueId, comment }) => {
      const body: Record<string, unknown> = {};
      if (comment) body.comment = comment;
      const result = await api(`/workflow/issues/${issueId}/reject`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_add_dependency',
    'Add a blocked-by dependency between two workflow issues.',
    {
      issueId: z.string().describe('The issue that is blocked'),
      dependsOnId: z.string().describe('The issue it depends on'),
    },
    async ({ issueId, dependsOnId }) => {
      const result = await api(`/workflow/issues/${issueId}/dependencies`, {
        method: 'POST',
        body: JSON.stringify({ dependsOnId }),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_create_epic_from_plan',
    'Create a workflow epic starting at plan-review with a pre-written plan. Skips triage/spec/planning.',
    {
      title: z.string().describe('Epic title'),
      description: z.string().describe('Epic description / spec'),
      planDraft: z.string().describe('The pre-written implementation plan'),
      trackId: z.string().optional().describe('Track ID to bind to'),
      provider: z.enum(['claude', 'codex']).optional().describe('AI CLI (default: claude)'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Priority'),
    },
    async ({ title, description, planDraft, trackId, provider, priority }) => {
      const body: Record<string, unknown> = { title, description, planDraft };
      if (trackId) body.trackId = trackId;
      if (provider) body.provider = provider;
      if (priority) body.priority = priority;
      const result = await api('/workflow/issues/from-plan', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_create_epic_from_template',
    'Create an autonomous "Dark Factory" epic from a template (e.g. new-web-app). Runs the workflow with human gates auto-approved EXCEPT the final merge gate, until a draft PR is ready.',
    {
      title: z.string().describe('Epic title'),
      description: z.string().describe('Spec built from the template intake answers'),
      templateSlug: z.string().describe('Template slug, e.g. "new-web-app" or "feature-on-existing-repo"'),
      trackId: z.string().optional().describe('Track ID to bind to (must have a repo)'),
      provider: z.enum(['claude', 'codex']).optional().describe('AI CLI (default: claude)'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Priority'),
      autonomous: z.boolean().optional().describe('Run dark (default true); false = manual gates'),
      budget: z
        .object({ maxSteps: z.number(), maxWallClockMs: z.number() })
        .optional()
        .describe('Autonomy budget before forced escalation (default 40 steps / 4h)'),
    },
    async ({ title, description, templateSlug, trackId, provider, priority, autonomous, budget }) => {
      const body: Record<string, unknown> = { title, description, templateSlug };
      if (trackId) body.trackId = trackId;
      if (provider) body.provider = provider;
      if (priority) body.priority = priority;
      if (autonomous !== undefined) body.autonomous = autonomous;
      if (budget) body.budget = budget;
      const result = await api('/workflow/issues/from-template', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_list_workflow_pending',
    'List workflow issues at human gates needing approval.',
    {},
    async () => {
      const result = await api('/workflow/issues?state=spec-review');
      const planReview = await api('/workflow/issues?state=plan-review');
      const finalReview = await api('/workflow/issues?state=final-review');
      const all = [...result, ...planReview, ...finalReview];
      return { content: [{ type: 'text' as const, text: JSON.stringify(all, null, 2) }] };
    },
  );
}
