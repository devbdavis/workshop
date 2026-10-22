#!/usr/bin/env node
// Workshop permission hook: asks Workshop to decide on tool calls the CLI would not allow.
// Usage: permission-hook.mjs <claude-denied|claude-pretool|codex-request|gemini-before-tool>
// Fails open: any error exits 0 with no stdout so the CLI falls back to its normal flow.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MODES = {
  'claude-denied': {
    path: 'requests',
    secs: 590,
    out: (d) =>
      d === 'allow' && { hookSpecificOutput: { hookEventName: 'PermissionDenied', retry: true } },
  },
  'claude-pretool': {
    path: 'check',
    secs: 3,
    out: (d) =>
      d === 'allow' && {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'Approved in Workshop',
        },
      },
  },
  'codex-request': {
    path: 'requests',
    secs: 590,
    out: (d) =>
      (d === 'allow' || d === 'deny') && {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision:
            d === 'allow'
              ? { behavior: 'allow' }
              : { behavior: 'deny', message: 'Declined in Workshop' },
        },
      },
  },
  'gemini-before-tool': {
    path: 'check',
    secs: 3,
    out: (d) => d === 'allow' && { decision: 'allow' },
  },
};

async function main() {
  const mode = MODES[process.argv[2]];
  const sessionId = process.env.WORKSHOP_SESSION_ID ?? '';
  if (!mode || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) return;

  let token = process.env.WORKSHOP_AUTH_TOKEN;
  if (!token) {
    try {
      token = readFileSync(join(homedir(), '.workshop', 'auth-token'), 'utf-8').trim();
    } catch {
      /* no token */
    }
  }
  const input = JSON.parse(readFileSync(0, 'utf-8'));
  const harness = process.argv[2].split('-')[0];
  const res = await fetch(
    `${process.env.WORKSHOP_API_URL || 'http://localhost:3002'}/api/permissions/${mode.path}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workshop-Session': sessionId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        harness,
        toolName: input.tool_name,
        toolInput: input.tool_input ?? {},
        reason: input.reason,
      }),
      signal: AbortSignal.timeout(mode.secs * 1000),
    },
  );
  if (!res.ok) return;
  const out = mode.out((await res.json()).decision);
  if (out) process.stdout.write(JSON.stringify(out));
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
