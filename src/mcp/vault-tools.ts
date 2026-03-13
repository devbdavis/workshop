import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerVaultTools(server: McpServer, api: (path: string, options?: RequestInit) => Promise<any>) {
  server.tool(
    'workshop_vault_read',
    'Read a file from a track\'s Obsidian vault folder',
    {
      trackSlug: z.string().describe('The track slug (e.g. "kms-load-testing")'),
      filePath: z.string().describe('File path relative to the track folder (e.g. "decisions.md")'),
    },
    async ({ trackSlug, filePath }) => {
      const result = await api(`/vault/tracks/${trackSlug}/${filePath}`);
      return { content: [{ type: 'text' as const, text: result.content }] };
    },
  );

  server.tool(
    'workshop_vault_list',
    'List .md files in a track\'s Obsidian vault folder',
    {
      trackSlug: z.string().describe('The track slug (e.g. "kms-load-testing")'),
    },
    async ({ trackSlug }) => {
      const result = await api(`/vault/tracks/${trackSlug}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'workshop_vault_write',
    'Write (create or overwrite) a file in a track\'s Obsidian vault folder',
    {
      trackSlug: z.string().describe('The track slug (e.g. "kms-load-testing")'),
      filePath: z.string().describe('File path relative to the track folder (e.g. "new-topic.md")'),
      content: z.string().describe('The full file content to write'),
    },
    async ({ trackSlug, filePath, content }) => {
      const result = await api(`/vault/tracks/${trackSlug}/${filePath}`, {
        method: 'PUT',
        body: JSON.stringify({ content }),
      });
      return { content: [{ type: 'text' as const, text: `Written: ${result.filePath}` }] };
    },
  );

  server.tool(
    'workshop_vault_append',
    'Append a section to an existing file in a track\'s Obsidian vault folder. Use this for adding decisions, learnings, or progress entries.',
    {
      trackSlug: z.string().describe('The track slug (e.g. "kms-load-testing")'),
      filePath: z.string().describe('File path relative to the track folder (e.g. "decisions.md")'),
      content: z.string().describe('The content to append (typically a ### heading + body)'),
    },
    async ({ trackSlug, filePath, content }) => {
      const result = await api(`/vault/tracks/${trackSlug}/append/${filePath}`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      return { content: [{ type: 'text' as const, text: `Appended to: ${result.filePath}` }] };
    },
  );
}
