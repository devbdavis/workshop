---
name: improve-agent
description: Apply a targeted improvement to an existing Claude Code agent definition based on user feedback.
---

# Improve Agent

Apply a targeted improvement to an existing Claude Code agent definition based on user feedback.

## Invocation

Expected form:
```
/agent-improve <agent-name> <improvement description>
```

Examples:
- `/agent-improve senior-node-engineer also enforce that imports are sorted`
- `/agent-improve kms-python-expert be more explicit about when to use chariot topic stats vs pulsar-admin`

## Steps

1. **Parse the arguments** — Extract the target agent name and the improvement description (everything after it). Agent names are kebab-case (e.g. `senior-node-engineer`, not `Senior Node Engineer`).

2. **Locate the agent file** — Agents live at `~/.claude/agents/<agent-name>.md`. Read the file before making any changes.

3. **Read the current agent** — Understand the agent's purpose, persona, and existing instructions before touching anything. An improvement that contradicts the agent's core identity is a bad improvement.

4. **Apply the improvement** — Make the minimal, focused change that addresses the feedback. Preserve the existing structure, tone, and persona. Do not rewrite sections unrelated to the feedback. Improvements should be surgical.

5. **Write the updated agent** — Use the Edit tool (preferred) or Write tool to save back to the same path.

6. **Report the change** — Summarize in 1–3 sentences what changed and why, so the user can verify intent was captured correctly.

## Agent File Format

Agent files are markdown with YAML frontmatter:

```markdown
---
name: Agent Display Name
description: When to use this agent. One or two sentences.
color: steelblue           # optional
tools: Read, Edit, Write   # comma-separated list
---

You are a [persona]...

## Section
- Guidance here
```

Preserve all frontmatter fields unless the improvement explicitly targets them. The `description` field is the primary trigger for when Claude selects this agent — make it specific and slightly directive if improving it.

## Writing Good Agent Instructions

Agent instructions differ from skill instructions. Keep these principles in mind when editing:

- **Persona first** — The opening paragraph defines identity. It should be short, confident, and opinionated. "You are a senior X" outperforms "This agent helps with X".
- **Principles over rules** — Explain *why* behind each constraint. An agent that understands the reasoning can apply judgment to edge cases; one following blind rules cannot.
- **Negative space matters** — What the agent should *not* do (refactor surrounding code, add unrequested features, add defensive checks) is as important as what it should do.
- **Concrete over abstract** — Replace vague guidance ("write clean code") with specific, verifiable instructions ("keep files under 300 lines; split by responsibility, not by size alone").
- **Short and focused** — A 40-line agent with sharp instructions outperforms a 200-line one with diluted guidance. Cut anything that restates common sense.
- **Tools list** — Only include tools the agent genuinely needs. Unnecessary tools increase surface area and can confuse the agent's scope.

## Notes

- If the agent name cannot be determined from the arguments, ask the user to clarify.
- If the file does not exist, list available agents with `ls ~/.claude/agents/` and ask the user to confirm the name.
- If the improvement is ambiguous, make your best interpretation and state your assumption in the report so the user can correct it.
- Do not change the `name` frontmatter field — it is the display name shown in the UI and changing it can break references.