/**
 * Prepares per-session Matrix MCP configuration so each dedicated session
 * only sees messages from its assigned room.
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import path from 'path';
import { homedir } from 'os';

/** Path to the shared Matrix MCP server entry point */
const MATRIX_MCP_SERVER = path.join(
  homedir(),
  'projects',
  'matrix-claude-channels',
  'dist',
  'server.js',
);

/** Path to the shared Matrix credentials */
const SHARED_MATRIX_DIR = path.join(homedir(), '.claude', 'channels', 'matrix');

/**
 * Create a room-scoped Matrix state directory inside the session data dir.
 * Writes an access.json that only allows the given room, and copies credentials.
 */
export function prepareMatrixStateDir(
  sessionDir: string,
  roomId: string,
  allowFrom: string[] = [],
): string {
  const matrixDir = path.join(sessionDir, 'matrix-state');
  mkdirSync(matrixDir, { recursive: true });

  // Copy credentials from the shared Matrix dir
  const sharedEnv = path.join(SHARED_MATRIX_DIR, '.env');
  if (existsSync(sharedEnv)) {
    copyFileSync(sharedEnv, path.join(matrixDir, '.env'));
  }

  // Write room-scoped access.json — only allow this one room
  const access = {
    dmPolicy: 'allowlist',
    allowFrom,
    rooms: {
      [roomId]: { requireMention: false, allowFrom: [] },
    },
    pending: {},
    ackReaction: '👀',
    replyToMode: 'first',
    chunkMode: 'newline',
  };
  writeFileSync(
    path.join(matrixDir, 'access.json'),
    JSON.stringify(access, null, 2),
    'utf-8',
  );

  return matrixDir;
}

/**
 * Build the MCP server config object for a room-scoped Matrix session.
 * This gets injected into the session's settings.json under mcpServers.
 */
export function buildMatrixMcpConfig(matrixStateDir: string): Record<string, unknown> {
  return {
    matrix: {
      command: 'node',
      args: [MATRIX_MCP_SERVER],
      env: {
        MATRIX_STATE_DIR: matrixStateDir,
        MATRIX_ACCESS_MODE: 'static',
      },
    },
  };
}

/**
 * Build the Matrix-specific system prompt addition for a dedicated room session.
 */
export function buildMatrixPromptBlock(roomId: string, trackName: string): string {
  return [
    '## Matrix Channel Session',
    '',
    `You are the dedicated assistant for the **${trackName}** project track.`,
    `You are connected to Matrix room \`${roomId}\` and will receive messages from that room.`,
    '',
    'When you receive a `<channel>` message:',
    '- Read and understand the request in context of this project',
    '- Use the `mcp__matrix__reply` tool to respond (pass the room_id from the message)',
    '- Use `mcp__matrix__react` to acknowledge messages when appropriate',
    '- Use `mcp__matrix__fetch_messages` if you need recent context',
    '',
    'You have full access to Workshop MCP tools for managing tracks, todos, vault, and workflows.',
    'Use them to take action on requests, not just discuss them.',
  ].join('\n');
}
