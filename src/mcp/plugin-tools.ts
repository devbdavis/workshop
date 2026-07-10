import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const PR_REVIEW_AGENT_ID = 'global:pr-review';

export function registerPluginTools(server: McpServer, api: (path: string, options?: RequestInit) => Promise<any>) {
  server.tool(
    'workshop_list_plugins',
    'List registered AI-CLI marketplace plugins (workshop-global defaults) with their enabled state and detected provider coverage',
    {},
    async () => {
      const plugins = await api('/plugins');
      return { content: [{ type: 'text' as const, text: JSON.stringify(plugins, null, 2) }] };
    },
  );

  server.tool(
    'workshop_dispatch_pr_review',
    'Launch a background PR review session using the pr-review agent (correctness pass + ponytail over-engineering pass). Creates a todo for the review if none is given.',
    {
      trackId: z.string().describe('The track to run the review under'),
      prUrl: z.string().describe('GitHub pull request URL to review'),
      todoId: z.string().optional().describe('Existing todo to dispatch the review from. If omitted, a new todo is created.'),
    },
    async ({ trackId, prUrl, todoId }) => {
      let effectiveTodoId = todoId;
      if (!effectiveTodoId) {
        const todo = await api(`/tracks/${trackId}/todos`, {
          method: 'POST',
          body: JSON.stringify({
            title: `PR Review: ${prUrl}`,
            description: `Review the pull request at ${prUrl}.`,
          }),
        });
        effectiveTodoId = todo.id;
        await api(`/todos/${effectiveTodoId}`, {
          method: 'PUT',
          body: JSON.stringify({ pullRequests: [{ url: prUrl }] }),
        });
      }
      const result = await api(`/todos/${effectiveTodoId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ agentId: PR_REVIEW_AGENT_ID }),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ todoId: effectiveTodoId, session: result }, null, 2) }] };
    },
  );
}
