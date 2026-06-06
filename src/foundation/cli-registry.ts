import type { SessionProvider } from '@foundation/types';

/**
 * Shared registry of AI CLIs ("agents") and common command-line tools that
 * Workshop can detect on PATH and authenticate via an interactive terminal
 * popup. Importable by both server (availability detection, auth routes) and
 * UI (settings, dropdown gating) so the two never drift.
 */

export type CliKind = 'agent' | 'tool';

export interface CliDescriptor {
  id: string;
  label: string;
  kind: CliKind;
  /** Binary name to look for on $PATH. */
  binary: string;
  /** Command run inside the auth terminal to start the login flow. */
  loginCommand: string;
  /** Set only for agents; always equal to the descriptor id. */
  provider?: SessionProvider;
}

/**
 * Login commands for non-Claude CLIs are best-effort — the exact subcommand
 * may vary by version. The auth terminal keeps a live shell open after the
 * command exits so the user can correct/re-run it if needed.
 */
export const CLI_REGISTRY: CliDescriptor[] = [
  // --- Agents (AI CLIs) ---
  // Claude shows its login prompt automatically when unauthenticated; once
  // signed in the user can run `/login` inside the TUI to re-authenticate.
  { id: 'claude', label: 'Claude Code', kind: 'agent', binary: 'claude', loginCommand: 'claude', provider: 'claude' },
  { id: 'codex', label: 'Codex CLI', kind: 'agent', binary: 'codex', loginCommand: 'codex login', provider: 'codex' },
  { id: 'gemini', label: 'Gemini CLI', kind: 'agent', binary: 'gemini', loginCommand: 'gemini', provider: 'gemini' },
  { id: 'cursor', label: 'Cursor CLI', kind: 'agent', binary: 'cursor-agent', loginCommand: 'cursor-agent login', provider: 'cursor' },

  // --- Tools ---
  { id: 'gh', label: 'GitHub CLI (gh)', kind: 'tool', binary: 'gh', loginCommand: 'gh auth login' },
  { id: 'glab', label: 'GitLab CLI (glab)', kind: 'tool', binary: 'glab', loginCommand: 'glab auth login' },
  { id: 'tea', label: 'Forgejo/Gitea CLI (tea)', kind: 'tool', binary: 'tea', loginCommand: 'tea login add' },
];

export function getCliDescriptor(id: string): CliDescriptor | undefined {
  return CLI_REGISTRY.find((c) => c.id === id);
}

/** Agent ids in registry order (these are exactly the SessionProvider values). */
export const AGENT_IDS: SessionProvider[] = CLI_REGISTRY.filter((c) => c.kind === 'agent').map(
  (c) => c.provider as SessionProvider,
);

/** Default set of enabled agents when the user has never customised the list. */
export const DEFAULT_AVAILABLE_AGENTS: SessionProvider[] = ['claude'];
