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

## Important: Todos Are Just Todos

When the user asks to **create a todo**, your job is to create it and stop. Do NOT start implementing the work described in the todo. Todos are planning artifacts — the user will decide when and how to act on them (manually, by dispatching to an agent, etc.).

## Key Concepts

### Track Context
Each track has a `context` field — freeform text describing the project, current focus, important notes, and any instructions for Claude sessions. When a new Claude session is created in a track, the system prompt is auto-composed from:

1. **Track context** (freeform text)
2. **Latest summary** (AI-generated project status)
3. **Prompt template** (if configured, interpolated with track data)

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

## Workshop Server

The Workshop server must be running for MCP tools to work. It runs on port 3002 (production) or 3001 (dev).

- Check status: `/Users/fabian.haupt/projects/workshop/scripts/workshop.sh status`
- Start: `/Users/fabian.haupt/projects/workshop/scripts/workshop.sh start`
- After backend code changes: `/Users/fabian.haupt/projects/workshop/scripts/workshop.sh restart`
