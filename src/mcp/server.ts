#!/usr/bin/env node
/**
 * Workshop MCP Server
 *
 * Exposes Workshop's HTTP API as MCP tools so Claude Code can interact
 * with project tracks, context, summaries, and sessions.
 *
 * Usage: WORKSHOP_API_URL=http://localhost:3002 npx tsx src/mcp/server.ts
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { registerTodoTools } from './todo-tools.js';
import { registerVaultTools } from './vault-tools.js';
import { registerScheduledTaskTools } from './scheduled-task-tools.js';

const API_URL = process.env.WORKSHOP_API_URL || 'http://localhost:3002';

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Workshop API ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

const server = new McpServer(
  { name: 'workshop', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// --- List Tracks ---

server.tool(
  'workshop_list_tracks',
  'List all active project tracks in Workshop',
  async () => {
    const tracks = await api('/tracks');
    return { content: [{ type: 'text', text: JSON.stringify(tracks, null, 2) }] };
  },
);

// --- Get Track ---

server.tool(
  'workshop_get_track',
  'Get detailed info about a specific track (repos, paths, tickets)',
  { trackId: z.string().describe('The track ID') },
  async ({ trackId }) => {
    const track = await api(`/tracks/${trackId}`);
    return { content: [{ type: 'text', text: JSON.stringify(track, null, 2) }] };
  },
);

// --- Set Track Context ---

server.tool(
  'workshop_set_context',
  'Set the freeform context for a project track. This context is included as system prompt in new Claude sessions.',
  {
    trackId: z.string().describe('The track ID'),
    context: z.string().describe('The context text to set for this track'),
  },
  async ({ trackId, context }) => {
    const track = await api(`/tracks/${trackId}`, {
      method: 'PUT',
      body: JSON.stringify({ context }),
    });
    return {
      content: [{ type: 'text', text: `Context updated for track "${track.name}".\n\nContext:\n${track.context}` }],
    };
  },
);

// --- Get Track Context ---

server.tool(
  'workshop_get_context',
  'Get the current context and summary for a track',
  { trackId: z.string().describe('The track ID') },
  async ({ trackId }) => {
    const track = await api(`/tracks/${trackId}`);
    let summaryText = 'No summary available.';
    try {
      const summary = await api(`/tracks/${trackId}/summary`);
      summaryText = `v${summary.version} (${summary.createdAt}):\n${summary.content}`;
    } catch {
      // No summary yet
    }
    const result = {
      context: track.context || null,
      summary: summaryText,
      description: track.description || null,
    };
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// --- Get Summary ---

server.tool(
  'workshop_get_summary',
  'Get the latest AI-generated summary for a track',
  { trackId: z.string().describe('The track ID') },
  async ({ trackId }) => {
    const summary = await api(`/tracks/${trackId}/summary`);
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
  },
);

// --- Refresh Summary ---

server.tool(
  'workshop_refresh_summary',
  'Regenerate the AI summary for a track (calls claude CLI)',
  { trackId: z.string().describe('The track ID') },
  async ({ trackId }) => {
    const summary = await api(`/tracks/${trackId}/summary/refresh`, { method: 'POST' });
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
  },
);

// --- Update Track ---

server.tool(
  'workshop_update_track',
  'Update a track\'s name, description, context, or status',
  {
    trackId: z.string().describe('The track ID'),
    name: z.string().optional().describe('New track name'),
    description: z.string().optional().describe('New track description'),
    context: z.string().optional().describe('New freeform context'),
    status: z.enum(['active', 'archived']).optional().describe('New status'),
  },
  async ({ trackId, ...data }) => {
    const track = await api(`/tracks/${trackId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return { content: [{ type: 'text', text: JSON.stringify(track, null, 2) }] };
  },
);

// --- List Sessions ---

server.tool(
  'workshop_list_sessions',
  'List terminal sessions for a track',
  { trackId: z.string().describe('The track ID') },
  async ({ trackId }) => {
    const sessions = await api(`/tracks/${trackId}/sessions`);
    return { content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }] };
  },
);

// --- Create Session ---

server.tool(
  'workshop_create_session',
  'Create a new AI terminal session in a track. System prompt is auto-composed from track context + summary + template unless explicitly provided.',
  {
    trackId: z.string().describe('The track ID'),
    systemPrompt: z.string().optional().describe('Custom system prompt (overrides auto-compose)'),
    provider: z.enum(['claude', 'codex']).optional().describe('AI CLI to use (default: claude)'),
  },
  async ({ trackId, systemPrompt, provider }) => {
    const body: Record<string, unknown> = {};
    if (systemPrompt) body.systemPrompt = systemPrompt;
    if (provider) body.provider = provider;
    const session = await api(`/tracks/${trackId}/sessions`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { content: [{ type: 'text', text: JSON.stringify(session, null, 2) }] };
  },
);

// --- Get Composed Prompt ---

server.tool(
  'workshop_get_composed_prompt',
  'Preview the auto-composed system prompt that would be used for a new session in this track',
  { trackId: z.string().describe('The track ID') },
  async ({ trackId }) => {
    const track = await api(`/tracks/${trackId}`);
    const parts: string[] = [];

    if (track.context) {
      parts.push(track.context);
    }

    try {
      const summary = await api(`/tracks/${trackId}/summary`);
      parts.push(`## Current Status\n\n${summary.content}`);
    } catch {
      // No summary
    }

    try {
      const prompt = await api(`/tracks/${trackId}/prompt`);
      if (prompt.interpolated) {
        parts.push(prompt.interpolated);
      }
    } catch {
      // No prompt template
    }

    const composed = parts.length > 0 ? parts.join('\n\n---\n\n') : '(empty — no context, summary, or template configured)';
    return { content: [{ type: 'text', text: composed }] };
  },
);

// --- Add Repo to Track ---

server.tool(
  'workshop_add_repo',
  'Link a git repository to a track',
  {
    trackId: z.string().describe('The track ID'),
    path: z.string().describe('Absolute filesystem path to the repo'),
    remoteUrl: z.string().optional().describe('Remote URL'),
  },
  async ({ trackId, path, remoteUrl }) => {
    const body: Record<string, unknown> = { path };
    if (remoteUrl) body.remoteUrl = remoteUrl;
    const repo = await api(`/tracks/${trackId}/repos`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { content: [{ type: 'text', text: JSON.stringify(repo, null, 2) }] };
  },
);

// --- Create Track ---

server.tool(
  'workshop_create_track',
  'Create a new project track',
  {
    name: z.string().describe('Track name'),
    description: z.string().optional().describe('Track description'),
  },
  async ({ name, description }) => {
    const track = await api('/tracks', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
    return { content: [{ type: 'text', text: JSON.stringify(track, null, 2) }] };
  },
);

// --- Todo Tools ---

registerTodoTools(server, api);

// --- Vault Tools ---

registerVaultTools(server, api);

// --- Scheduled Task & Automation Tools ---

registerScheduledTaskTools(server, api);

// Start

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Workshop MCP server failed:', err);
  process.exit(1);
});
