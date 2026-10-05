import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const scheduleConfigSchema = z
  .object({
    preset: z.enum(['interval', 'daily', 'weekly', 'monthly', 'cron']).describe('Schedule type'),
    intervalMinutes: z.number().optional().describe('For interval: run every N minutes'),
    time: z.string().optional().describe('HH:MM time for daily/weekly/monthly'),
    daysOfWeek: z.array(z.number()).optional().describe('Days of week (0=Sun..6=Sat) for daily preset'),
    dayOfWeek: z.number().optional().describe('Day of week for weekly preset (0-6)'),
    monthRule: z.enum(['day-of-month', 'weekday-of-month']).optional(),
    dayOfMonth: z.number().optional().describe('Day of month (1-31, -1 for last)'),
    weekOfMonth: z.number().optional().describe('Week of month (1-4, -1 for last)'),
    cronExpression: z.string().optional().describe('Raw cron expression for cron preset'),
  })
  .describe('Schedule configuration');

export function registerScheduledTaskTools(
  server: McpServer,
  api: (path: string, options?: RequestInit) => Promise<any>,
) {
  server.tool(
    'workshop_list_scheduled_tasks',
    'List all scheduled/recurring tasks. Optionally filter by trackId.',
    {
      trackId: z.string().optional().describe('Filter by track ID'),
    },
    async ({ trackId }) => {
      let path = '/scheduled-tasks';
      if (trackId) path += `?trackId=${trackId}`;
      const tasks = await api(path);
      return { content: [{ type: 'text' as const, text: JSON.stringify(tasks, null, 2) }] };
    },
  );

  server.tool(
    'workshop_create_scheduled_task',
    'Create a new recurring/scheduled task that dispatches agent sessions on a schedule.',
    {
      name: z.string().describe('Task name'),
      taskPrompt: z.string().describe('The instruction/prompt to send to the agent'),
      scheduleConfig: scheduleConfigSchema,
      description: z.string().optional().describe('Task description'),
      trackId: z.string().optional().describe('Track ID to bind to (pulls context into prompt)'),
      agentId: z.string().optional().describe('Agent ID to use'),
      provider: z.enum(['claude', 'codex']).optional().describe('AI CLI (default: claude)'),
      systemPromptOverride: z.string().optional().describe('Custom system prompt (overrides auto-compose)'),
      scriptContent: z.string().optional().describe('Bash script run before the agent; its stdout is prepended to the task prompt'),
      skipOnNonZero: z.boolean().optional().describe('Treat scriptContent as a precheck: non-zero exit skips the run (no session spawned)'),
      enabled: z.boolean().optional().describe('Enable immediately (default: true)'),
    },
    async ({ name, taskPrompt, scheduleConfig, description, trackId, agentId, provider, systemPromptOverride, scriptContent, skipOnNonZero, enabled }) => {
      const body: Record<string, unknown> = { name, taskPrompt, scheduleConfig };
      if (description) body.description = description;
      if (trackId) body.trackId = trackId;
      if (agentId) body.agentId = agentId;
      if (provider) body.provider = provider;
      if (systemPromptOverride) body.systemPromptOverride = systemPromptOverride;
      if (scriptContent) body.scriptContent = scriptContent;
      if (skipOnNonZero !== undefined) body.skipOnNonZero = skipOnNonZero;
      if (enabled !== undefined) body.enabled = enabled;

      const task = await api('/scheduled-tasks', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }] };
    },
  );

  server.tool(
    'workshop_trigger_scheduled_task',
    'Manually trigger a scheduled task to run immediately',
    {
      taskId: z.string().describe('The scheduled task ID'),
    },
    async ({ taskId }) => {
      const result = await api(`/scheduled-tasks/${taskId}/trigger`, { method: 'POST' });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_toggle_scheduled_task',
    'Enable or disable a scheduled task',
    {
      taskId: z.string().describe('The scheduled task ID'),
    },
    async ({ taskId }) => {
      const result = await api(`/scheduled-tasks/${taskId}/toggle`, { method: 'POST' });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_update_scheduled_task',
    'Update fields of a scheduled task. Only provided fields change.',
    {
      taskId: z.string().describe('The scheduled task ID'),
      name: z.string().optional(),
      taskPrompt: z.string().optional().describe('The instruction/prompt to send to the agent'),
      scheduleConfig: scheduleConfigSchema.optional(),
      description: z.string().optional(),
      trackId: z.string().optional().describe('Track ID to bind to; empty string unbinds'),
      agentId: z.string().optional().describe('Agent ID; empty string clears'),
      provider: z.enum(['claude', 'codex']).optional(),
      systemPromptOverride: z.string().optional(),
      scriptContent: z.string().optional().describe('Pre-run bash script; empty string removes it'),
      skipOnNonZero: z.boolean().optional(),
      enabled: z.boolean().optional(),
      templateName: z.string().optional().describe('Link to templates/schedules/<slug>.json (slug only); empty string unlinks'),
    },
    async ({ taskId, ...body }) => {
      const task = await api(`/scheduled-tasks/${taskId}`, { method: 'PUT', body: JSON.stringify(body) });
      return { content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }] };
    },
  );

  server.tool(
    'workshop_delete_scheduled_task',
    'Permanently delete a scheduled task',
    {
      taskId: z.string().describe('The scheduled task ID'),
    },
    async ({ taskId }) => {
      await api(`/scheduled-tasks/${taskId}`, { method: 'DELETE' });
      return { content: [{ type: 'text' as const, text: `Deleted scheduled task ${taskId}` }] };
    },
  );

  server.tool(
    'workshop_sync_scheduled_task_from_template',
    'Reset a scheduled task to its linked template: overwrites prompt, schedule, description and script from templates/schedules/<templateName>.json',
    {
      taskId: z.string().describe('The scheduled task ID'),
    },
    async ({ taskId }) => {
      const task = await api(`/scheduled-tasks/${taskId}/sync-from-template`, { method: 'POST' });
      return { content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }] };
    },
  );

  // --- Automation rule triggering ---

  server.tool(
    'workshop_list_automation_rules',
    'List automation rules for a track (schedule, git-change, ticket-status-change triggers)',
    {
      trackId: z.string().describe('The track ID'),
    },
    async ({ trackId }) => {
      const rules = await api(`/tracks/${trackId}/automations`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(rules, null, 2) }] };
    },
  );

  server.tool(
    'workshop_trigger_automation_rule',
    'Manually trigger an automation rule to execute its action',
    {
      trackId: z.string().describe('The track ID'),
      ruleId: z.string().describe('The automation rule ID'),
    },
    async ({ trackId, ruleId }) => {
      const result = await api(`/tracks/${trackId}/automations/${ruleId}/trigger`, { method: 'POST' });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
