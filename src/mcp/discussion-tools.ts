import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerDiscussionTools(
  server: McpServer,
  api: (path: string, options?: RequestInit) => Promise<any>,
): void {
  // --- List discussions ---
  server.tool(
    'workshop_discussion_list',
    'List discussions, optionally filtered by status, teamId, or trackId.',
    {
      status: z.enum(['open', 'consensus', 'closed', 'stale', 'failed']).optional().describe('Filter by status'),
      teamId: z.string().optional().describe('Filter by team ID'),
      trackId: z.string().optional().describe('Filter by track ID'),
    },
    async ({ status, teamId, trackId }) => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (teamId) params.set('teamId', teamId);
      if (trackId) params.set('trackId', trackId);
      const qs = params.toString();
      const path = `/discussions${qs ? `?${qs}` : ''}`;
      const result = await api(path);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // --- Read discussion thread ---
  server.tool(
    'workshop_discussion_read',
    'Read a discussion thread including all messages, votes, and consensus status.',
    {
      discussionId: z.string().describe('The discussion ID'),
    },
    async ({ discussionId }) => {
      const result = await api(`/discussions/${discussionId}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // --- Post message ---
  server.tool(
    'workshop_discussion_post',
    'Post a message to an open discussion. You must be a participant.',
    {
      discussionId: z.string().describe('The discussion ID'),
      authorId: z.string().describe('Your agent ID (from the discussion protocol in your system prompt)'),
      authorName: z.string().describe('Your display name'),
      messageType: z.enum(['comment', 'suggestion', 'objection', 'revision', 'satisfied', 'unsatisfied']).describe('Message type'),
      content: z.string().describe('Message content'),
    },
    async ({ discussionId, authorId, authorName, messageType, content }) => {
      const result = await api(`/discussions/${discussionId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ authorType: 'agent', authorId, authorName, messageType, content }),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // --- Cast vote ---
  server.tool(
    'workshop_discussion_vote',
    'Cast or update your vote on a discussion. You must be a participant.',
    {
      discussionId: z.string().describe('The discussion ID'),
      voterId: z.string().describe('Your agent ID (from the discussion protocol in your system prompt)'),
      voterName: z.string().describe('Your display name'),
      vote: z.enum(['satisfied', 'unsatisfied', 'abstain']).describe('Your vote'),
      comment: z.string().optional().describe('Optional comment with your vote'),
    },
    async ({ discussionId, voterId, voterName, vote, comment }) => {
      const body: Record<string, unknown> = { voterType: 'agent', voterId, voterName, vote };
      if (comment) body.comment = comment;
      const result = await api(`/discussions/${discussionId}/votes`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // --- Create discussion ---
  server.tool(
    'workshop_discussion_create',
    'Start a new discussion with a team of agents.',
    {
      teamId: z.string().describe('The discussion team ID'),
      title: z.string().describe('Discussion title'),
      type: z.enum(['rfc', 'question', 'review']).optional().describe('Discussion type (default: rfc)'),
      artifact: z.string().optional().describe('The document/plan/diff being discussed'),
      trackId: z.string().optional().describe('Optional track ID for context binding'),
      staleAfterMinutes: z.number().optional().describe('Minutes of inactivity before auto-stale (0 = never)'),
    },
    async ({ teamId, title, type, artifact, trackId, staleAfterMinutes }) => {
      const body: Record<string, unknown> = { teamId, title };
      if (type) body.type = type;
      if (artifact) body.artifact = artifact;
      if (trackId) body.trackId = trackId;
      if (staleAfterMinutes !== undefined) body.staleAfterMinutes = staleAfterMinutes;
      const result = await api('/discussions', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // --- Discussion status ---
  server.tool(
    'workshop_discussion_status',
    'Check the consensus state and vote tally for a discussion.',
    {
      discussionId: z.string().describe('The discussion ID'),
    },
    async ({ discussionId }) => {
      const result = await api(`/discussions/${discussionId}`);
      // Extract just the status info
      const summary = {
        id: result.discussion?.id || result.id,
        title: result.discussion?.title || result.title,
        status: result.discussion?.status || result.status,
        consensusMet: result.consensusMet,
        participantCount: result.participantCount,
        votedCount: result.votedCount,
        satisfiedCount: result.satisfiedCount,
        votes: result.votes,
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
    },
  );
}
