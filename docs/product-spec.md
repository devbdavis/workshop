# Project Tracks — Product Specification

## Problem Statement

When working on multiple parallel project tracks, context switching is expensive and error-prone. Existing project management tools (Jira, Linear) impose a rigid issue-based structure that doesn't always match how work is actually thought about — sometimes a single issue spans multiple conceptual tracks, and sometimes a single track involves work that's more granular than any issue captures.

There is no unified place to:
- See the current state of each active project track at a glance
- Maintain persistent AI-assisted sessions per track
- Keep track of which repos, branches, and filesystem locations are involved
- Flexibly link work tracks to external issues without being constrained by their hierarchy

## Product Vision

A local-first project command center that runs as a background server with a web interface. It provides a persistent, AI-augmented workspace for each project track — complete with live terminal sessions, automated status summaries, and flexible integration with external project management tools.

## Core Concepts

### Project Track

The central organizing unit. A project track represents a stream of work as the user thinks about it — not necessarily mapping 1:1 to any external system. Each track has:

- A name and description
- Current status summary (AI-maintained)
- Associated context: repos, branches, filesystem paths, configuration
- Linked external issues (Jira/Linear) — many-to-many relationship
- One or more terminal sessions with Claude Code instances
- Custom system prompts for its agents
- Event-driven automation rules

### External Issue Link

A many-to-many association between project tracks and Jira/Linear issues. A single track can reference multiple issues, and a single issue can appear across multiple tracks. The link stores:

- Issue ID and source system (Jira/Linear)
- Relationship annotation (e.g., "primary", "related", "blocked-by")
- Last-synced status snapshot

### Terminal Session

A persistent terminal running a Claude Code instance, embedded in the web interface. Sessions:

- Survive page refreshes and browser restarts
- Can be resized and rearranged within the project view
- Maintain conversation history via Claude Code's resume functionality
- Have configurable system prompts per session
- Can be created, paused, and destroyed independently

### Project Summary

A persistent, AI-generated summary of the current state of a project track. Summaries are:

- Stored persistently, not regenerated on every page load
- Updated by a dedicated agent triggered by specific events
- Displayed prominently in the project view
- Versioned so previous summaries can be reviewed

## User Flows

### 1. Dashboard / Home

When opening the web interface, the user sees:

- A grid or list of all active project tracks
- Each track shows its name, a short status line, and indicators for active sessions
- Quick actions: create new track, archive a track
- A global search/filter across tracks and linked issues

### 2. Project Track View

Selecting a track opens its dedicated workspace:

- **Summary Panel** — The current AI-generated status summary. Shows last-updated timestamp. Manual "refresh summary" button available.
- **Context Panel** — Lists associated repos (with current branch and dirty state), filesystem paths, linked issues with their current status.
- **Terminal Area** — One or more resizable terminal panels, each running a Claude Code session. Toolbar to create new sessions, kill sessions, or reattach to backgrounded ones.
- **Configuration** — System prompts for the track's agents, automation rules, track metadata.

### 3. Creating a New Project Track

- Provide a name and optional description
- Optionally link git repos (by path or URL)
- Optionally link Jira/Linear issues (search and select via MCP integration)
- Optionally set a custom system prompt template for Claude sessions in this track
- A starter terminal session is created automatically

### 4. Linking External Issues

- From within a track, search for Jira/Linear issues
- Select one or more issues to link
- Annotate the relationship type
- Issue status is synced periodically and displayed in the context panel
- An issue can be unlinked without affecting the issue itself

### 5. Managing Terminal Sessions

- Create a new terminal session within a track (spawns a Claude Code instance with the track's system prompt and context)
- Sessions appear as resizable panels in the terminal area
- Close a session (the underlying process can be kept alive or killed)
- Reattach to a session after navigating away and back
- Sessions persist across browser restarts — the backend maintains them

### 6. Configuring Automation

- Define event triggers: "on git push", "on issue status change", "on session end", "on schedule (cron)", "manual"
- Define actions: "regenerate summary", "run agent with prompt X", "send notification"
- Example: "After any terminal session ends, regenerate the project summary"
- Example: "Every morning at 9am, pull latest issue statuses and update summary"

### 7. Adjusting Agent System Prompts

- Each track has a default system prompt template
- Individual sessions can override the default
- Prompts can reference track context variables (repo paths, branch names, issue IDs)
- A library of prompt templates is available to start from

## Integrations

### Jira / Linear (via MCP)

- Search for issues
- Pull issue details: title, description, status, assignee, labels
- Display issue status in the context panel
- Many-to-many linking between tracks and issues
- Periodic or event-driven sync of issue status

### Git

- Associate one or more local repos with a track
- Display current branch, last commit, dirty state
- Detect branch changes and optionally trigger automations
- Link to remote repo URLs for quick navigation

### Claude Code

- Spawn Claude Code instances as terminal sessions
- Pass system prompts and project context on startup
- Leverage Claude Code's `/resume` for session persistence across restarts
- Leverage Claude Code's `/voice` for voice conversations about a project (stretch goal)

## Information Architecture

```
Dashboard
  |
  +-- Project Track A
  |     +-- Summary Panel
  |     +-- Context Panel
  |     |     +-- Repos & Branches
  |     |     +-- Linked Issues
  |     |     +-- Filesystem Paths
  |     +-- Terminal Sessions
  |     |     +-- Session 1 (Claude Code)
  |     |     +-- Session 2 (Claude Code)
  |     +-- Configuration
  |           +-- System Prompts
  |           +-- Automation Rules
  |           +-- Track Metadata
  |
  +-- Project Track B
  |     +-- ...
  |
  +-- Settings
        +-- Global Defaults
        +-- Prompt Template Library
        +-- MCP Connection Config
        +-- Appearance
```

## Persistence Model

All state is local-first:

- **Project tracks, links, summaries, automation rules** — stored in a local database or structured files
- **Terminal sessions** — managed by the backend (e.g., via tmux), survive server restarts
- **Claude Code sessions** — leverage Claude Code's built-in resume/session persistence
- **Issue data** — cached locally, synced from external systems on demand or schedule

## Key Design Principles

1. **User's mental model first** — The system adapts to how the user thinks about their work, not the other way around. Tracks are flexible and don't enforce issue-level structure.

2. **Persistent by default** — Sessions, summaries, and context survive restarts and page refreshes. No work is lost because a browser tab was closed.

3. **AI as a first-class participant** — Claude instances aren't just terminals to interact with; they are integrated into the system's automation, maintaining summaries and responding to events.

4. **Lightweight and local** — Runs on the developer's machine. No cloud deployment needed. Data stays local.

5. **Flexible linking, not rigid hierarchy** — Many-to-many relationships between tracks and issues. A track can represent anything from a single subtask to a multi-epic initiative.

6. **Progressive complexity** — Creating a track with a single terminal session should take seconds. Automation, custom prompts, and issue linking are available but never required.

## Stretch Goals

- **Voice conversations** — Use Claude Code's `/voice` capability to have spoken conversations about a project track. Voice sessions appear alongside terminal sessions.
- **Cross-track dependency visualization** — See how tracks relate to each other (shared issues, shared repos, blocking relationships).
- **Timeline view** — See a chronological view of activity across tracks (commits, issue changes, summary updates, session transcripts).
- ability to edit/modify issues via mcp and agent conversations should easily be doable

## Out of Scope (v1)

- Hosted/cloud deployment
- Multi-user collaboration
- Direct code editing in the web interface (that's what the Claude terminals are for)
- Replacing Jira/Linear — this system is a layer on top, not a replacement


---

*Spec path: `docs/product-spec.md`*
