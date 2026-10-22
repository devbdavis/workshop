#!/usr/bin/env node
/**
 * Workshop MCP Server
 *
 * Exposes Workshop's HTTP API as MCP tools so Claude Code can interact
 * with project tracks, context, and sessions.
 *
 * Usage: WORKSHOP_API_URL=http://localhost:3002 npx tsx src/mcp/server.ts
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'fs';
import path from 'path';
import { registerTodoTools } from './todo-tools.js';
import { registerPluginTools } from './plugin-tools.js';
import { registerVaultTools } from './vault-tools.js';
import { registerScheduledTaskTools } from './scheduled-task-tools.js';
import { registerWorkflowTools } from './workflow-tools.js';
import { registerPlaybookTools } from './workflow-playbook-tools.js';
import { registerDiscussionTools } from './discussion-tools.js';
import { registerPrReviewTools } from './pr-review-tools.js';

const API_URL = process.env.WORKSHOP_API_URL || 'http://localhost:3002';

// Read auth token from env var or ~/.workshop/auth-token
const AUTH_TOKEN = (() => {
  if (process.env.WORKSHOP_AUTH_TOKEN) return process.env.WORKSHOP_AUTH_TOKEN.trim();
  try {
    const tokenPath = path.join(process.env.HOME || '/tmp', '.workshop', 'auth-token');
    return readFileSync(tokenPath, 'utf-8').trim();
  } catch {
    return '';
  }
})();

// Log startup info to stderr (safe — MCP uses stdout for JSON-RPC)
console.error(`[workshop-mcp] API_URL: ${API_URL}`);
console.error(`[workshop-mcp] AUTH_TOKEN: ${AUTH_TOKEN ? `set (${AUTH_TOKEN.length} chars)` : 'NOT SET'}`);

async function api(apiPath: string, options?: RequestInit) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (AUTH_TOKEN) {
    headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }
  const url = `${API_URL}/api${apiPath}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: { ...headers, ...options?.headers },
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    const nested = (err as any)?.cause instanceof Error ? ` (cause: ${(err as any).cause.message})` : '';
    console.error(`[workshop-mcp] fetch error: ${options?.method ?? 'GET'} ${url} — ${cause}${nested}`);
    throw new Error(`Workshop API unreachable (${url}): ${cause}${nested}`);
  }
  if (!res.ok) {
    const body = await res.text();
    console.error(`[workshop-mcp] HTTP ${res.status}: ${options?.method ?? 'GET'} ${url} — ${body}`);
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
  'Get detailed info about a specific track (repos, paths, issues)',
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
  'Get the current context for a track',
  { trackId: z.string().describe('The track ID') },
  async ({ trackId }) => {
    const track = await api(`/tracks/${trackId}`);
    const result = {
      context: track.context || null,
      description: track.description || null,
    };
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// --- Update Track ---

server.tool(
  'workshop_update_track',
  'Update a track\'s name, description, context, matrixRoomId, or status',
  {
    trackId: z.string().describe('The track ID'),
    name: z.string().optional().describe('New track name'),
    description: z.string().optional().describe('New track description'),
    context: z.string().optional().describe('New freeform context'),
    matrixRoomId: z.string().optional().describe('Matrix room ID to bind to this track (e.g. !abc123:example.com)'),
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

// --- Lookup Track by Matrix Room ---

server.tool(
  'workshop_get_track_by_room',
  'Find the project track bound to a Matrix room ID. Returns the track with repos, paths, and context.',
  { roomId: z.string().describe('The Matrix room ID (e.g. !abc123:example.com)') },
  async ({ roomId }) => {
    try {
      const track = await api(`/tracks/by-room/${encodeURIComponent(roomId)}`);
      return { content: [{ type: 'text', text: JSON.stringify(track, null, 2) }] };
    } catch {
      return { content: [{ type: 'text', text: `No track bound to room ${roomId}` }] };
    }
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
  'Create a new AI terminal session in a track. System prompt is auto-composed from track context + template unless explicitly provided.',
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
      const prompt = await api(`/tracks/${trackId}/prompt`);
      if (prompt.interpolated) {
        parts.push(prompt.interpolated);
      }
    } catch {
      // No prompt template
    }

    const composed = parts.length > 0 ? parts.join('\n\n---\n\n') : '(empty — no context or template configured)';
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

// --- Add Path to Track ---

server.tool(
  'workshop_add_path',
  'Add a filesystem path to a track',
  {
    trackId: z.string().describe('The track ID'),
    path: z.string().describe('Absolute filesystem path to add'),
    label: z.string().optional().describe('Optional label for this path'),
  },
  async ({ trackId, path, label }) => {
    const body: Record<string, unknown> = { path };
    if (label) body.label = label;
    const result = await api(`/tracks/${trackId}/paths`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// --- Remove Repo from Track ---

server.tool(
  'workshop_remove_repo',
  'Remove a git repository from a track',
  {
    trackId: z.string().describe('The track ID'),
    repoId: z.string().describe('The repo ID to remove'),
  },
  async ({ trackId, repoId }) => {
    await api(`/tracks/${trackId}/repos/${repoId}`, { method: 'DELETE' });
    return { content: [{ type: 'text', text: `Repo ${repoId} removed from track ${trackId}.` }] };
  },
);

// --- Remove Path from Track ---

server.tool(
  'workshop_remove_path',
  'Remove a filesystem path from a track',
  {
    trackId: z.string().describe('The track ID'),
    pathId: z.string().describe('The path ID to remove'),
  },
  async ({ trackId, pathId }) => {
    await api(`/tracks/${trackId}/paths/${pathId}`, { method: 'DELETE' });
    return { content: [{ type: 'text', text: `Path ${pathId} removed from track ${trackId}.` }] };
  },
);

// --- List Global Repos ---

server.tool(
  'workshop_list_repos',
  'List all global repos in the Workshop registry',
  async () => {
    const repos = await api('/repos');
    return { content: [{ type: 'text', text: JSON.stringify(repos, null, 2) }] };
  },
);

// --- Create Global Repo ---

server.tool(
  'workshop_create_repo',
  'Register a git repository in the global Workshop repo registry',
  {
    path: z.string().describe('Absolute filesystem path to the git repository'),
  },
  async ({ path }) => {
    const repo = await api('/repos', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
    return { content: [{ type: 'text', text: JSON.stringify(repo, null, 2) }] };
  },
);

// --- Delete Global Repo ---

server.tool(
  'workshop_delete_repo',
  'Remove a git repository from the global Workshop repo registry',
  {
    repoId: z.string().describe('The global repo ID to delete'),
  },
  async ({ repoId }) => {
    await api(`/repos/${repoId}`, { method: 'DELETE' });
    return { content: [{ type: 'text', text: `Repo ${repoId} deleted from global registry.` }] };
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

// --- Marketplace Plugin Tools ---

registerPluginTools(server, api);

// --- Vault Tools ---

registerVaultTools(server, api);

// --- Scheduled Task & Automation Tools ---

registerScheduledTaskTools(server, api);

// --- Workflow Tools ---

registerWorkflowTools(server, api);

// --- Workflow Playbook Tools ---

registerPlaybookTools(server, api);

// --- Discussion Tools ---

registerDiscussionTools(server, api);

// --- PR Review Dashboard Tools ---

registerPrReviewTools(server, api);

// Start

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Workshop MCP server failed:', err);
  process.exit(1);
});
