import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerTodoTools(server: McpServer, api: (path: string, options?: RequestInit) => Promise<any>) {
  server.tool(
    'workshop_list_todos',
    'List todos, optionally filtered by trackId or status',
    {
      trackId: z.string().optional().describe('Filter by track ID'),
      status: z.string().optional().describe('Filter by status: backlog, ready, in-progress, review, done'),
    },
    async ({ trackId, status }) => {
      let path = '/todos';
      const params = new URLSearchParams();
      if (trackId) params.set('trackId', trackId);
      if (status) params.set('status', status);
      const qs = params.toString();
      if (qs) path += `?${qs}`;
      const todos = await api(path);
      return { content: [{ type: 'text' as const, text: JSON.stringify(todos, null, 2) }] };
    },
  );

  server.tool(
    'workshop_create_todo',
    'Create a new todo/task for a track. Todos can later be dispatched to an agent session.',
    {
      trackId: z.string().describe('The track ID to create the todo under'),
      title: z.string().describe('Short title of the task'),
      description: z.string().optional().describe('Detailed description / prompt for the agent'),
      priority: z.enum(['low', 'medium', 'high']).optional().describe('Priority level (default: medium)'),
    },
    async ({ trackId, title, description, priority }) => {
      const body: Record<string, unknown> = { title };
      if (description) body.description = description;
      if (priority) body.priority = priority;
      const todo = await api(`/tracks/${trackId}/todos`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(todo, null, 2) }] };
    },
  );

  server.tool(
    'workshop_update_todo',
    'Update a todo\'s title, description, resolution, status, priority, or associated pull requests',
    {
      todoId: z.string().describe('The todo ID'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      resolution: z.string().optional().describe('Resolution notes — what happened or why the todo was completed/stopped. Only meaningful for ready/done status.'),
      issueKey: z.string().optional().describe('Issue key to associate with this todo: Linear/Jira "ASY-1402" or GitHub "owner/repo#123". Appended to the worktree branch name when dispatched.'),
      pullRequests: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional().describe('Pull requests associated with this todo. Each entry has a url and optional display title.'),
      status: z.enum(['backlog', 'ready', 'in-progress', 'review', 'done']).optional().describe('New status'),
      priority: z.enum(['low', 'medium', 'high']).optional().describe('New priority'),
    },
    async ({ todoId, ...data }) => {
      const todo = await api(`/todos/${todoId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(todo, null, 2) }] };
    },
  );

  server.tool(
    'workshop_dispatch_todo',
    'Dispatch a todo to an agent session. Creates a Claude session with the track context + todo description as the task prompt.',
    {
      todoId: z.string().describe('The todo ID to dispatch'),
    },
    async ({ todoId }) => {
      const result = await api(`/todos/${todoId}/dispatch`, { method: 'POST' });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_report_issue',
    'Report a Linear or GitHub issue created from a todo back to Workshop, so the issue modal can display it and the issue links to the todo. Call this once, after the issue has been filed.',
    {
      todoId: z.string().describe('The Workshop todo id the issue was created from (given in the task prompt)'),
      issueKey: z
        .string()
        .describe('The created issue key: Linear "ASY-1402" or GitHub "owner/repo#123"'),
      url: z.string().describe('The full URL of the created issue'),
      title: z.string().describe('The issue title'),
      body: z.string().describe('The full issue description/body in Markdown'),
    },
    async (args) => {
      const result = await api('/todos/report-issue', { method: 'POST', body: JSON.stringify(args) });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_delete_todo',
    'Delete a todo',
    {
      todoId: z.string().describe('The todo ID to delete'),
    },
    async ({ todoId }) => {
      await api(`/todos/${todoId}`, { method: 'DELETE' });
      return { content: [{ type: 'text' as const, text: `Todo ${todoId} deleted.` }] };
    },
  );
}
