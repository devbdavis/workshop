import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrReviewTools(server: McpServer, api: (path: string, options?: RequestInit) => Promise<any>) {
  server.tool(
    'workshop_report_pr_review',
    'Report structured PR review findings to the Workshop PR Review dashboard. Called by the pr-review agent after analysis — the user curates the findings there and posts one GitHub review. Do NOT post to GitHub directly.',
    {
      prUrl: z.string().describe('The GitHub PR URL that was reviewed'),
      findings: z
        .array(
          z.object({
            file: z.string().describe('Repo-relative file path'),
            line: z.number().optional().describe('Line number in the PR head version of the file'),
            category: z.string().optional().describe('Short category, e.g. correctness, over-engineering, testing'),
            summary: z.string().describe('One-sentence statement of the issue'),
            failureScenario: z.string().optional().describe('Concrete failure scenario (correctness findings)'),
            suggestedComment: z.string().describe('The comment text to post inline on GitHub if the user keeps this finding'),
          }),
        )
        .describe('All findings from both review passes. Empty array when the PR is clean.'),
      draftSummary: z
        .string()
        .describe('Draft overall review comment — positive and supportive of the author; confirm what was tested, call out anything untested or missed'),
      suggestedVerdict: z.enum(['approve', 'request_changes', 'comment']).describe('Suggested review verdict'),
    },
    async (args) => {
      const result = await api('/pr-reviews/report', { method: 'POST', body: JSON.stringify(args) });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
