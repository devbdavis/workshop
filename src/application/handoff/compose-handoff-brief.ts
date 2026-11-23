import type { TranscriptMessage, TranscriptBlock } from '@infrastructure/usage/transcript.js';

export interface HandoffBriefInput {
  todo: {
    title: string;
    description?: string | null;
    status: string;
    issueKey?: string | null;
    pullRequests?: { url: string; title?: string }[] | null;
  };
  fromProvider: string;
  fromSessionId: string;
  messages: TranscriptMessage[] | null;
  git: string | null;
}

export const MAX_BRIEF_CHARS = 12_000;
const USER_CLIP = 800;
const ASSISTANT_CLIP = 1500;
const MAX_USER = 15;
const MAX_ASSISTANT = 3;
const MAX_TOOLS = 8;
const EDIT_TOOL_RE = /^(edit|write|multiedit|notebookedit|apply_patch|write_file|replace|edit_file)$/i;

type ToolBlock = Extract<TranscriptBlock, { type: 'tool' }>;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function textOf(m: TranscriptMessage): string {
  return m.blocks
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('\n')
    .trim();
}

function digest(messages: TranscriptMessage[]): string {
  const real = messages.filter((m) => !m.note);
  const users = real.filter((m) => m.role === 'user').map(textOf).filter(Boolean).slice(-MAX_USER);
  const assistant = real.filter((m) => m.role === 'assistant').flatMap((m) => m.blocks.flatMap((b) => (b.type === 'text' && b.text.trim() ? [b.text.trim()] : []))).slice(-MAX_ASSISTANT);
  const tools: ToolBlock[] = real.flatMap((m) => m.blocks.filter((b): b is ToolBlock => b.type === 'tool'));
  const files = [...new Set(tools.filter((t) => EDIT_TOOL_RE.test(t.name) && t.hint).map((t) => t.hint as string))];
  const recent = tools.slice(-MAX_TOOLS).map((t) => `- ${t.name}${t.hint ? `: ${t.hint}` : ''}${t.isError ? ' (error)' : ''}`);

  const out: string[] = [];
  if (users.length) out.push(`### User messages\n\n${users.map((u) => `- ${clip(u, USER_CLIP).replace(/\n/g, '\n  ')}`).join('\n')}`);
  if (assistant.length) out.push(`### Last assistant messages\n\n${assistant.map((a) => clip(a, ASSISTANT_CLIP)).join('\n\n')}`);
  if (files.length) out.push(`Files touched:\n${files.map((f) => `- ${f}`).join('\n')}`);
  if (recent.length) out.push(`### Last tool calls\n\n${recent.join('\n')}`);
  return out.join('\n\n');
}

export function composeHandoffBrief(input: HandoffBriefInput): string {
  const { todo, fromProvider, fromSessionId, messages, git } = input;
  const card = [`- Title: ${todo.title}`, `- Status: ${todo.status}`];
  if (todo.issueKey) card.push(`- Issue: ${todo.issueKey}`);
  for (const pr of todo.pullRequests ?? []) card.push(`- PR: ${pr.title ? `${pr.title}: ` : ''}${pr.url}`);
  if (todo.description) card.push(`\n${todo.description}`);

  const sections = [
    `## Handoff\n\nYou are taking over this todo from a ${fromProvider} session (${fromSessionId}) that stopped (outage, usage limit or crash). The work so far is in the current working directory.\n\nRules:\n- Verify the state with git before acting.\n- Do not redo completed steps.\n- Do not revert the previous agent's uncommitted changes unless they are clearly broken.\n- Continue to the end of the original task and follow its completion instructions.`,
    `## Kanban card\n\n${card.join('\n')}`,
  ];
  if (git) sections.push(`## Repo state at handoff\n\n${git}`);
  sections.push(`## Previous conversation (digest)\n\n${messages ? digest(messages) || 'No messages recorded.' : 'Transcript unavailable.'}`);

  const brief = sections.join('\n\n');
  return brief.length > MAX_BRIEF_CHARS ? `${brief.slice(0, MAX_BRIEF_CHARS - 20)}\n…(truncated)` : brief;
}
