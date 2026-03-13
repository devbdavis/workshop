---
name: workshop-mcp
description: "Interact with Workshop project tracks via MCP tools. Use this skill when you need to set or get project context, view track summaries, create sessions, or manage Workshop tracks. Trigger when the user mentions workshop context, project tracks, track summaries, or starting Claude sessions in a track. Tagged: workshop."
---

# Workshop MCP Integration

You have access to Workshop MCP tools that let you interact with the Workshop project command center. Workshop manages parallel work tracks, each with repos, context, summaries, and Claude terminal sessions.

## Available Tools

| Tool | Purpose |
|---|---|
| `mcp__workshop__workshop_list_tracks` | List all active tracks |
| `mcp__workshop__workshop_get_track` | Get track details (repos, paths, tickets) |
| `mcp__workshop__workshop_set_context` | Set freeform context text for a track |
| `mcp__workshop__workshop_get_context` | Get track context + latest summary |
| `mcp__workshop__workshop_get_summary` | Get the latest AI-generated summary |
| `mcp__workshop__workshop_refresh_summary` | Regenerate the AI summary |
| `mcp__workshop__workshop_update_track` | Update track name/description/context/status |
| `mcp__workshop__workshop_list_sessions` | List terminal sessions for a track |
| `mcp__workshop__workshop_create_session` | Create a new Claude session (auto-composes system prompt) |
| `mcp__workshop__workshop_get_composed_prompt` | Preview the system prompt that would be used for new sessions |
| `mcp__workshop__workshop_add_repo` | Link a git repo to a track |
| `mcp__workshop__workshop_create_track` | Create a new track |
| `mcp__workshop__workshop_list_todos` | List todos (filterable by trackId/status) |
| `mcp__workshop__workshop_create_todo` | Create a new todo for a track |
| `mcp__workshop__workshop_update_todo` | Update todo fields |
| `mcp__workshop__workshop_dispatch_todo` | Dispatch a refined todo to a background agent |
| `mcp__workshop__workshop_delete_todo` | Delete a todo |
| `mcp__workshop__workshop_vault_read` | Read a file from a track's Obsidian vault |
| `mcp__workshop__workshop_vault_list` | List .md files in a track's vault folder |
| `mcp__workshop__workshop_vault_write` | Write/overwrite a vault file |
| `mcp__workshop__workshop_vault_append` | Append a section to a vault file |

## Important: Todos Are Just Todos

When the user asks to **create a todo**, your job is to create it and stop. Do NOT start implementing the work described in the todo. Todos are planning artifacts — the user will decide when and how to act on them (manually, by dispatching to an agent, etc.).

## Key Concepts

### Track Context
Each track has a `context` field — freeform text describing the project, current focus, important notes, and any instructions for Claude sessions. When a new Claude session is created in a track, the system prompt is auto-composed from:

1. **Track context** (freeform text)
2. **Vault memory** (persistent Obsidian notes — decisions, learnings, overview)
3. **Latest summary** (AI-generated project status)
4. **Prompt template** (if configured, interpolated with track data)

### Workflow: Setting Context for a Track

1. First, list tracks to find the one you need:
   ```
   mcp__workshop__workshop_list_tracks
   ```

2. Set the context:
   ```
   mcp__workshop__workshop_set_context(trackId, context)
   ```

3. Verify with:
   ```
   mcp__workshop__workshop_get_composed_prompt(trackId)
   ```

### Workflow: Preparing a Track for Sessions

1. Set the context with project description, goals, and relevant instructions
2. Refresh the summary to get current project status
3. Preview the composed prompt to verify everything looks right
4. Create sessions — they'll automatically get the full context

## Vault Memory (Obsidian)

Each track has a persistent Obsidian vault folder at `Workshop/{track-slug}/` in the WorkflowDocs vault. This provides long-term memory that persists across sessions.

### Folder Structure

```
Workshop/
  kms-load-testing/
    _overview.md       # Track overview and context
    decisions.md       # Architectural/design decisions
    learnings.md       # Gotchas, patterns, lessons learned
    progress.md        # Session progress log
    *.md               # Additional topic-specific notes
```

### When to Write to the Vault

- **Architectural/design decisions** -> append to `decisions.md` with a `### ` heading
- **Gotchas, patterns, lessons** -> append to `learnings.md` with a `### ` heading
- **Session progress** -> append to `progress.md` with a `### ` heading
- **New topics** -> create new `.md` files as needed

### How to Use

1. The track slug is the kebab-case version of the track name (e.g. "KMS Load Testing" -> "kms-load-testing")
2. Use `workshop_vault_read` and `workshop_vault_list` to explore existing notes
3. Use `workshop_vault_append` to add entries to existing files (preferred for decisions/learnings/progress)
4. Use `workshop_vault_write` to create new files or overwrite existing ones
5. Use `[[note-name]]` WikiLinks to cross-reference other notes in the vault

### Auto-injection

Vault content (overview, recent decisions, recent learnings) is automatically injected into session system prompts. Agents don't need to manually read the vault on startup — it's already in their context.

## Workshop Server

The Workshop server must be running for MCP tools to work. It runs on port 3002 (production) or 3001 (dev).

- Check status: `scripts/workshop.sh status`
- Start: `scripts/workshop.sh start`
- After backend code changes: `scripts/workshop.sh restart`
