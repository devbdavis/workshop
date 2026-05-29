---
name: linear
description: Creates or edits Linear issues in the ASY backlog. Use when the user says 'linear issue', 'linear ticket', or asks to create or update a ticket — even if phrasing is informal.
---

# Linear Ticket Skill

Create or edit Linear issues for team **ASY** (Core Infrastructure - Async Processing). All tickets go to this team.

## When to use

Triggered by: "linear ticket", "linear issue", "create a ticket", "update the ticket", "file an issue", or any request to track work in Linear.

## Behavior

1. **Clarify intent first.** If the user hasn't provided enough context to write acceptance criteria, ask one focused question. Don't ask for information you can infer.
2. **Use the Linear MCP tools** (`mcp__linear-server__save_issue`, `mcp__linear-server__get_issue`, etc.) to create or update tickets directly. Do not ask the user to do it manually.
3. **Draft before submitting** (for creates). Show the title and description in a code block and ask for confirmation before calling the MCP tool — unless the user says to go ahead.
4. For updates, read the current issue first (`mcp__linear-server__get_issue`), apply only the requested changes, and confirm what changed.
5. When complete, output a link to the issues involved

## Team defaults

- **Team**: ASY (Core Infrastructure - Async Processing)
- **Project**: leave unset unless user specifies
- **Assignee**: leave unset unless user specifies
- **Priority**: leave unset unless user specifies

## Title

Short, imperative (e.g. `Add deduplication support to events topic`). No period at the end.

## Description structure

Use this Markdown structure in the issue body:

```
## Description

<Why we are making this change. One to three sentences. No filler.>

## Implementation Details

- <Optional technical bullet points>
- <Omit this section entirely if there are no meaningful technical details to add>

## Acceptance Criteria

- <Specific, testable objective an engineer uses to decide when the ticket is done>
- <One objective per bullet>
- <Must be present; this is the most important part of the ticket>
```

## Writing style

- Acceptance criteria are the most important part. Spend the most effort here.
- Descriptions explain *why*, not *what*. Avoid restating the title.
- Implementation details are optional technical context — omit if obvious or unknown.
- No emoji, no em dash, no magic quotes (“”), no verbose filler phrases ("In order to...", "This ticket tracks...").
- Use plain straight quotes if quoting is necessary.
- Be concise. A five-word acceptance criterion is better than a twenty-word one.