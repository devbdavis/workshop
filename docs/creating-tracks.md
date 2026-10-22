# Creating and Using Tracks

A track is your unit of parallel work — a project, a feature, an investigation, a spike. Each track bundles together everything an AI agent (or you) needs to make progress: linked repos, context, terminal sessions, summaries, todos, and workflow issues.

## Creating a Track

### Via the UI

1. Open Workshop ([localhost:5173](http://localhost:5173) in dev, [localhost:3002](http://localhost:3002) in prod)
2. Click **New Track** on the dashboard
3. Give it a name and description
4. You're in — the track view opens with empty panels ready to fill

### Via MCP (from Claude Code)

```
Use workshop_create_track with name "my-feature" and description "Implement the new auth flow"
```

## Setting Context

Context is the most important thing you configure on a track. It's freeform text that gets injected into the system prompt of every AI session created in that track. Think of it as your standing instructions to every agent that works on this project.

### What to put in context

Good context tells an agent everything it needs to know *before* it starts reading code:

- **What this project is** — one paragraph overview
- **Current focus** — what you're working on right now
- **Key decisions** — architectural choices already made ("we're using Express, not Fastify")
- **Constraints** — things to avoid ("don't touch the auth module, it's being rewritten")
- **Conventions** — project-specific patterns ("all API routes return `{ data, error }` shape")
- **Repo layout** — where to find things if the structure isn't obvious

### Example context

```
## Project: Payment Service Refactor

Migrating the legacy payment processing from a monolith to a standalone service.

### Current focus
Building the webhook handler for Stripe events. The handler needs to be idempotent
— we've seen duplicate webhook deliveries in prod.

### Architecture
- Express + TypeScript backend
- PostgreSQL with Prisma ORM
- Redis for idempotency keys (TTL: 24h)
- Event-driven: webhook -> validate -> process -> emit domain event

### Constraints
- DO NOT modify the existing monolith payment code — we're running both in parallel
- All new endpoints go under /api/v2/payments
- Must maintain backward compatibility with the existing webhook URL

### Testing
- Integration tests hit a real Stripe test account (keys in .env)
- Use `npm run test:payments` for the payment-specific suite
```

### Setting context via UI

In the track view, open the **Context** panel and edit the textarea directly. Changes save automatically.

### Setting context via MCP

```
Use workshop_set_context for track "trk-abc123" with the context text above
```

### Preview what agents will see

Before creating a session, preview the composed system prompt:

```
Use workshop_get_composed_prompt for track "trk-abc123"
```

This shows the full prompt including context, vault memory, latest summary, and the prompt template — exactly what a new session will receive.

## Linking Repos

Link git repositories to your track so Workshop knows which codebases are involved. This is used for git status tracking and summary generation.

In the track view, open **Config** and add repo paths. These should be absolute paths to local git repos.

## Creating Sessions

A session is a tmux-backed terminal, optionally running Claude Code or Codex. Workshop auto-composes a system prompt from your track's context, vault notes, and latest summary.

### Via the UI

In the track view, click **New Session**. Choose:
- **Provider**: Claude (default) or Codex
- **Working directory**: which repo/directory to start in
- **Skip CLI**: create a bare tmux session without launching an AI

The terminal appears in the terminal panel. You can have multiple sessions per track running in parallel.

### Via MCP

```
Use workshop_create_session for track "trk-abc123" with provider "claude"
```

### What happens under the hood

1. Workshop creates a tmux session
2. It composes a system prompt from: track context + vault memory + latest summary + prompt template
3. It writes the prompt to a file and launches the AI CLI with `--system-prompt-file`
4. The terminal is bridged to the UI via WebSocket + node-pty

Sessions survive server restarts (tmux is independent). Only the WebSocket connection drops briefly and auto-reconnects.

## Summaries

Workshop can generate AI-powered summaries of your track's current state by looking at git activity across linked repos.

### Refresh a summary

Via MCP:
```
Use workshop_refresh_summary for track "trk-abc123"
```

Or click the refresh button in the **Summary** panel in the UI.

Summaries are included in session system prompts, giving new agents a snapshot of recent progress.

## Todos

Todos are lightweight task items attached to a track. They're planning artifacts — create them, refine them, then either do them yourself or dispatch them to a background agent.

### Creating todos

Via MCP:
```
Use workshop_create_todo for track "trk-abc123" with title "Add input validation to webhook handler"
```

Or use the **Todos** panel in the UI.

### Dispatching to a background agent

When a todo is refined enough, you can dispatch it to a background agent:

1. In the UI, click **Dispatch** on a todo
2. Choose the provider (Claude/Codex)
3. The agent runs in the background with the todo as its task
4. You can approve/deny its tool calls from the **Permissions** panel (or auto-approve)
5. When done, the agent updates the todo status

This is how you run parallel work — dispatch multiple todos to background agents while you focus on something else.

## Workflow Issues

For larger work items, the workflow system provides a full lifecycle pipeline with human review gates.

### The pipeline

```
idea -> triaging -> specced -> spec-review (HUMAN GATE)
  -> planning -> plan-critique -> plan-review (HUMAN GATE)
    -> splitting -> in-progress (parallel tasks)
      -> code-review -> fixing -> integration-review
        -> final-review (HUMAN GATE) -> merged
```

Each stage has a designated agent role (triage specialist, planner, critic, implementer, reviewer). Human gates pause the pipeline until you approve or reject.

### Creating an epic

In the **Workflow** page, click **New Epic**. Give it a title and description. The engine automatically transitions it to `triaging`.

### Human gates

When an issue reaches a human gate (`spec-review`, `plan-review`, `final-review`), it pauses. You review the agent's output and either:
- **Approve** — advances to the next stage
- **Reject** (with feedback) — sends it back for another iteration

### Task dependencies

When an epic is split into tasks, tasks can declare dependencies on each other. Blocked tasks automatically unblock when their dependencies complete. When all tasks are done, the epic advances to integration review.

## Vault Memory (Optional)

If you've set up the Obsidian vault (see [Setup Guide](setup-guide.md#7-obsidian-vault-optional)), each track gets persistent markdown notes that survive across sessions.

### Writing to the vault

Via MCP:
```
Use workshop_vault_append for track slug "my-feature", file "decisions.md",
content "### Use Redis for idempotency\nChose Redis over DB-level locks because..."
```

### What gets auto-injected

When a new session starts, Workshop pulls from the vault:
- `_overview.md` — track overview
- Recent entries from `decisions.md`
- Recent entries from `learnings.md`

This gives agents long-term memory without you having to repeat yourself.

## Tips

- **Context is king.** Spend time on your track context. A well-written context paragraph saves more tokens than any prompt engineering trick.
- **Start small.** Create a track, set context, create one session. Get comfortable before using workflow issues and background agents.
- **Use vault memory for things that matter across sessions.** Architectural decisions, gotchas you've discovered, things that burned you once.
- **Preview your prompts.** Use `workshop_get_composed_prompt` before creating sessions to make sure agents are getting the right context.
- **Dispatch liberally.** Background agents with permission hooks are safe. Let them work while you review.
