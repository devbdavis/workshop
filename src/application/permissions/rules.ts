import type { PermissionRule } from '@foundation/permission-types';

const SHELL_TOOLS = new Set(['Bash', 'run_shell_command', 'shell', 'exec_command', 'local_shell']);
// Any of these lets a prefix rule smuggle in a second command.
const SHELL_META = /[;&|`$<>\n]/;

export function normalizeTool(toolName: string): string {
  return SHELL_TOOLS.has(toolName) ? 'shell' : toolName;
}

export function commandOf(toolInput: unknown): string | null {
  const c = (toolInput as { command?: unknown } | null)?.command;
  if (typeof c === 'string') return c;
  return Array.isArray(c) ? c.join(' ') : null;
}

export function summarize(toolName: string, toolInput: unknown): string {
  if (normalizeTool(toolName) === 'shell') return commandOf(toolInput) ?? '';
  const i = (toolInput ?? {}) as { file_path?: unknown; path?: unknown };
  if (typeof i.file_path === 'string') return i.file_path;
  if (typeof i.path === 'string') return i.path;
  return (JSON.stringify(toolInput) ?? '').slice(0, 300);
}

export function suggestPattern(toolName: string, toolInput: unknown): string | null {
  if (normalizeTool(toolName) !== 'shell') return null;
  const tokens: string[] = [];
  for (const t of (commandOf(toolInput) ?? '').trim().split(/\s+/)) {
    if (tokens.length >= 3 || t.startsWith('-') || /["']/.test(t)) break;
    tokens.push(t);
  }
  return tokens.join(' ') || null;
}

export function ruleMatches(
  rule: Pick<PermissionRule, 'toolName' | 'pattern'>,
  toolName: string,
  toolInput: unknown,
): boolean {
  if (rule.toolName !== normalizeTool(toolName)) return false;
  if (rule.pattern === null) return true;
  if (rule.toolName !== 'shell') return false;
  const cmd = commandOf(toolInput)?.trim();
  if (!cmd || SHELL_META.test(cmd)) return false;
  return cmd === rule.pattern || cmd.startsWith(rule.pattern + ' ');
}
