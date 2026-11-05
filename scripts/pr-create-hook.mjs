#!/usr/bin/env node
// Claude PreToolUse hook: denies `gh pr create` / `tea pulls create` until the session has
// invoked the submit-for-review skill, so PRs get linked to their todo and the PR monitor.
// Fails open (exit 0, no stdout): subagents, no installed skill, no or unreadable transcript.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PR_CREATE = /\bgh\b[^|;&\n]*\bpr\s+(create|new)\b|\btea\b[^|;&\n]*\b(pulls?|pr)\s+create\b/;
const INVOKED =
  /"skill":\s*"([\w-]+:)?submit-for-review"|<command-name>\/([\w-]+:)?submit-for-review<\/command-name>/;

try {
  const input = JSON.parse(readFileSync(0, 'utf-8'));
  const skillHome = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  if (
    !input.agent_id &&
    input.transcript_path &&
    PR_CREATE.test(input.tool_input?.command ?? '') &&
    existsSync(join(skillHome, 'skills', 'submit-for-review', 'SKILL.md'))
  ) {
    if (!INVOKED.test(readFileSync(input.transcript_path, 'utf-8'))) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              'Open PRs through the submit-for-review skill (Skill tool, skill: "submit-for-review"), not by running the forge CLI directly. It links the PR to the Workshop todo and registers it with the PR monitor.',
          },
        }),
      );
    }
  }
} catch {
  /* fail open */
}
