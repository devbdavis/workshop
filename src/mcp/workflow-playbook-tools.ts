import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPlaybookTools(
  server: McpServer,
  api: (path: string, options?: RequestInit) => Promise<any>,
): void {
  server.tool(
    'workshop_list_playbooks',
    'List all latest workflow playbooks. Filter by ticket_type (epic/task) or tags.',
    {
      issueType: z.enum(['epic', 'task']).optional().describe('Filter by issue type'),
      tags: z.array(z.string()).optional().describe('Filter by tags (all must match)'),
    },
    async ({ issueType, tags }) => {
      const params = new URLSearchParams();
      if (issueType) params.set('issueType', issueType);
      if (tags && tags.length > 0) params.set('tags', tags.join(','));
      const qs = params.toString();
      const path = `/workflow/playbooks${qs ? `?${qs}` : ''}`;
      const result = await api(path);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_list_agent_roles',
    'List all reusable agent roles. Filter by capabilityTier or reusable flag.',
    {
      capabilityTier: z
        .enum(['advisory', 'code-modification', 'infrastructure'])
        .optional()
        .describe('Filter by capability tier'),
      reusable: z.boolean().optional().describe('Filter by reusable flag'),
    },
    async ({ capabilityTier, reusable }) => {
      const params = new URLSearchParams();
      if (capabilityTier) params.set('capabilityTier', capabilityTier);
      if (reusable !== undefined) params.set('reusable', String(reusable));
      const qs = params.toString();
      const path = `/workflow/agent-roles${qs ? `?${qs}` : ''}`;
      const result = await api(path);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_validate_workflow',
    'Validate a workflow graph definition. Returns validation result with errors and warnings.',
    {
      stageDefinitions: z
        .array(z.record(z.unknown()))
        .describe('Array of stage definition objects to validate'),
    },
    async ({ stageDefinitions }) => {
      const result = await api('/workflow/validate-graph', {
        method: 'POST',
        body: JSON.stringify({ stageDefinitions }),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_propose_playbook',
    'Propose a workflow playbook for an epic. Stores the proposal for human approval.',
    {
      epicId: z.string().describe('The epic issue ID to propose a workflow for'),
      epicTemplate: z.record(z.unknown()).describe('The workflow playbook for the epic'),
      taskTemplate: z
        .record(z.unknown())
        .optional()
        .describe('Optional companion task playbook'),
      agentRoles: z
        .array(z.record(z.unknown()))
        .optional()
        .describe('New agent roles to create with this workflow'),
      rationale: z.string().describe('Explanation of why this workflow was chosen/designed'),
    },
    async ({ epicId, epicTemplate, taskTemplate, agentRoles, rationale }) => {
      const body: Record<string, unknown> = {
        epicTemplate,
        rationale,
      };
      if (taskTemplate) body.taskTemplate = taskTemplate;
      if (agentRoles) body.agentRoles = agentRoles;

      const result = await api(`/workflow/issues/${epicId}/propose-workflow`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_approve_playbook_assignment',
    'Approve a pending workflow proposal for an epic. Creates the playbook(s) and binds to the issue.',
    {
      epicId: z.string().describe('The epic issue ID with a pending workflow proposal'),
    },
    async ({ epicId }) => {
      const result = await api(`/workflow/issues/${epicId}/approve-workflow`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
