import type { DiscussionState } from './discussion-service.js';

/**
 * Build a system prompt for the "act on consensus" agent that analyzes
 * a completed discussion and decides how to implement the outcome.
 */
export function buildActOnConsensusPrompt(
  state: DiscussionState,
  trackContext?: string,
  summary?: string,
): string {
  const parts: string[] = [];

  parts.push(buildCoreInstructions());
  parts.push(buildDiscussionTranscript(state));

  if (trackContext) {
    parts.push(`## Project Context\n\n${trackContext}`);
  }

  if (summary) {
    parts.push(`## Current Project Status\n\n${summary}`);
  }

  parts.push(buildStrategyGuidance());

  return parts.join('\n\n---\n\n');
}

function buildCoreInstructions(): string {
  return `## Role: Discussion Implementation Agent

You are a senior technical lead. A team discussion has reached consensus and
your job is to analyze the outcome and turn it into concrete action.

Read the discussion transcript below carefully. Identify:
1. What was decided (the consensus position)
2. The scope and complexity of the work
3. Any specific technical approaches agreed upon
4. Any constraints or preferences expressed

Then choose the RIGHT execution strategy and execute it.`;
}

function buildDiscussionTranscript(state: DiscussionState): string {
  const { discussion, messages, votes } = state;
  const lines: string[] = [];

  lines.push(`## Discussion: "${discussion.title}"`);
  lines.push(`Type: ${discussion.type} | Status: ${discussion.status}`);
  lines.push(`Participants: ${discussion.participantIds.join(', ')}`);
  lines.push('');

  lines.push('### Messages\n');
  for (const msg of messages) {
    const author = msg.authorName || msg.authorId || 'Unknown';
    const tag = msg.authorType === 'human' ? '[human]' : '[agent]';
    lines.push(`**${author}** ${tag} (${msg.messageType}):`);
    lines.push(msg.content);
    lines.push('');
  }

  if (votes.length > 0) {
    lines.push('### Final Votes\n');
    for (const v of votes) {
      const voter = v.voterName || v.voterId;
      lines.push(`- **${voter}**: ${v.vote}${v.comment ? ` — ${v.comment}` : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function buildStrategyGuidance(): string {
  return `## Execution Strategy

Choose ONE of these approaches based on the complexity of what was decided:

### Option A: Direct Implementation
Use when the consensus describes a small, well-defined change (a single component,
a config tweak, a bug fix). Just start coding — you have all the tools you need.

### Option B: Create a Todo
Use when the work is moderate scope — a feature that one agent can handle but
that benefits from being tracked. Call \`workshop_create_todo\` with a clear title
and description summarizing the consensus, then call \`workshop_dispatch_todo\`
to assign it to an appropriate agent.

### Option C: Create a Workflow Epic
Use when the consensus describes significant work that needs planning, multiple
implementation tasks, or review stages. Call \`workshop_create_epic\` with:
- A clear title capturing the feature/change
- A thorough description that includes the full consensus context, technical
  approach agreed upon, and any constraints mentioned in the discussion

The workflow system will handle triage → planning → task splitting → implementation
→ review automatically.

## Decision Criteria

- **Lines of code < 100, single file/component** → Option A
- **Single feature, one agent can handle, < 1 day of work** → Option B
- **Multiple files/components, needs planning or review, multi-step** → Option C

## Important

- Do NOT re-debate what was decided. The consensus is final.
- Include relevant context from the discussion in whatever you create.
- If the discussion references a specific track, create items in that track.
- Be specific in descriptions — the next agent/workflow won't have the discussion context.`;
}
