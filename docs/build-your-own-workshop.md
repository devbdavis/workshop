# Build Your Own Workshop: Design Doc and Prompt

This doc describes everything Workshop does, with enough implementation detail to rebuild it from scratch. It's meant to be handed to an AI coding agent along with the prompt in §1. It deliberately leaves out the **Workflow** tab (epics, playbooks, the ticket pipeline) and **Discussions**. Both exist in this repo, and you shouldn't copy either one.

> `docs/features.md` is an older feature index. It still lists the workflow pipeline, discussions, and track summaries, and track summaries have since been removed. This doc reflects the current code (October 2026).

---

## 1. The prompt

Paste this into a fresh Claude Code (or similar) session in an empty directory, and attach or paste this whole document after it.

```text
You are building "Workshop": a local-first, single-machine web app that is a command
center for running many AI coding-agent terminal sessions in parallel, organized into
"tracks" (work streams). The attached design doc is the spec. Read all of it before
writing code.

Ground rules:
- Stack: Node 24 + TypeScript (strict, ESM), Express 4, ws, node-pty, better-sqlite3,
  tmux, React 19 + Vite + Tailwind v4, xterm.js, Vitest. Do not swap these out unless
  I agree to it.
- Layered architecture with forward-only dependencies:
  ui -> application -> domain -> foundation; infrastructure implements domain
  interfaces. No barrel files. Branded string IDs.
- tmux is the source of truth for every terminal. The browser attaches through a
  WebSocket -> node-pty -> `tmux attach`. Sessions must survive browser closes and
  server restarts.
- Build in the phase order in §12 of the doc. After each phase, run typecheck +
  tests, demo it to me, and commit before moving on.
- Respect every item in §11 "Gotchas". Each one was learned the hard way.
- Anything marked (optional) can wait until I ask. Skip anything listed in §13.
- My personal choices are listed in §14. Ask me about each one instead of copying it.

Start by proposing the directory layout and the Phase 1 plan, then build it.
```

---

## 2. What Workshop is

You run lots of agent sessions at once, across several projects. Workshop gives you one browser tab where you can:

- organize work into **tracks**. A track has its repos, paths, free-text context, todos, a default agent, and a prompt template.
- launch **AI CLI sessions**, either interactive or as background agents. Each one is a tmux session, optionally in its own git worktree, and the system prompt is composed for it automatically.
- see at a glance which sessions are **working, idle, or waiting on you**. You get notified when one needs you.
- turn **todos** into background agents ("dispatch"). Agents report back via MCP and move the todo to review.
- **watch your PRs** for CI failures and review comments, and push fixes back into the session that wrote them.
- **review other people's PRs** with an agent. You curate its findings and post a single GitHub review.
- run **scheduled agent tasks**, with pre-scripts and catch-up after the laptop sleeps.
- manage **agents, skills, MCP servers, plugins, and prompt templates** for every CLI from one Settings page.
- let agents drive all of the above through an **MCP server**.

Everything runs locally. There's one SQLite DB, all state lives in `~/.workshop`, and a single shared auth token guards the whole thing.

---

## 3. Architecture

```
Browser (React SPA)
  ├─ REST /api/*  ─────────────┐
  ├─ WS /ws/events (event bus) │
  ├─ WS /ws/tracks/:t/sessions/:s/terminal ──► node-pty ──► tmux attach -t workshop-<id>
  ├─ /code/* (code-server proxy, optional)
  └─ :PORT+100 preview proxy (optional, separate origin)
                               ▼
                    Express server (one process)
   ├─ TerminalManager (ONE instance shared by REST + WS)
   ├─ pollers: session sync 7.5s · PR monitor 2m · PR review discovery 5m
   │           stale-agent reaper 1h · recycle-bin purge 1h · backup watchdog 1h
   ├─ TaskScheduler (node-cron + wall-clock wake detector)
   └─ SQLite (better-sqlite3, WAL)
                               ▲
   Claude Code hooks (curl scripts) ── POST /api/hooks/*
   MCP stdio server (src/mcp/server.ts) ── HTTP ──► /api/*  (spawned per Claude session)
```

**Layout**

| Path | Contents |
|---|---|
| `src/foundation` | shared types, branded IDs, config, CLI registry, pure utils (diff parsing, interpolation helpers, path remap) |
| `src/domain/<entity>` | repository interfaces |
| `src/infrastructure` | `persistence/*-repository.ts`, `terminal/` (tmux), `git/`, `github/` + `forge/` (gh/tea), `linear/`, `vault/`, `soul/`, `agents/`, `skills/`, `plugins/`, `mcp-tools/` (per-CLI MCP adapters), `backup/`, `code-server/`, `launch/` |
| `src/application/<feature>` | schedulers, pollers, registrars, prompt composition |
| `src/server` | `index.ts` (bootstrap), `api.ts` (`createApiRouter` builds services and mounts every `*-routes.ts`), `websocket.ts`, `events.ts` |
| `src/mcp` | stdio MCP server plus `*-tools.ts` |
| `src/ui/<feature>` | React views |
| `templates/{agents,skills,schedules}` | installable content shipped in the repo |
| `scripts/` | hook scripts, `workshop.sh` prod runner, `init.sh` |
| `tests/<layer>` | mirrors `src` |

**Dependencies**

- Backend: `express@4`, `ws`, `node-pty`, `better-sqlite3`, `node-cron`, `cron-parser`, `@modelcontextprotocol/sdk`, `zod`, `smol-toml` (Codex config), `uuid`.
- Frontend: `react@19`, `react-router-dom@7`, `react-markdown`, `@xterm/xterm` plus the fit, search, web-links, and webgl addons, `@dnd-kit/*` (kanban).
- Dev: `tsx` (the server runs from source even in prod), `vite`, `@tailwindcss/vite`, `vitest`, `jsdom`, `concurrently`, `prettier`.
- **External CLIs:**
  - Required: `tmux`, `git`, `claude`.
  - Optional: `codex`, `gemini`, `cursor-agent`, `gh`, `tea` (Gitea/Forgejo), `code-server`, `nix` + `direnv`.

**Ports**

| Mode | Ports |
|---|---|
| Dev | API on 3001, Vite on 5173. Vite proxies `/api`, `/ws`, and `/code` (WebSocket, `changeOrigin:false`) to 3001. |
| Prod | API on 3002 (`scripts/workshop.sh`, Docker). Preview proxy on `PORT+100` (3102). |

Dev and prod can run side by side with separate DBs.

**Bootstrap order** (`src/server/index.ts`):
1. Build the express app.
2. Mount the code-server proxy *before* `express.json`.
3. Add `express.json({limit:'1mb'})`.
4. Mount public `/api/auth`.
5. Add the auth middleware on `/api`.
6. Create **one** `TerminalManager`.
7. Mount the `/api` router.
8. In prod, serve static `dist/client` with an SPA fallback.
9. Create the HTTP server, attach the WebSocket upgrade router, and listen on `0.0.0.0`.
10. Start the preview proxy.
11. On SIGTERM, stop pollers and close the DB.

`createApiRouter` also runs these at startup:
- Seeding is idempotent: default prompt templates, auto-install agents, and bundled schedules (imported disabled).
- Plugin sync is fire-and-forget.
- The session sync loop starts.
- Three seconds after boot it fast-suspends orphaned sessions, then resumes them.
- It purges the recycle bin.
- It starts the pollers.

---

## 4. Persistence

`~/.workshop/workshop.db` (override with `WORKSHOP_DB_PATH`) opens with `journal_mode=WAL` and `foreign_keys=ON`.

**Migrations.** Base tables use `CREATE TABLE IF NOT EXISTS`. Every later change is an appended `try { db.exec('ALTER TABLE … ADD COLUMN …') } catch {}`. There's no version table. If you're starting fresh, use `PRAGMA user_version` instead; it's the better choice.

| Table | Purpose / notable columns |
|---|---|
| `tracks` | name, description, `context`, `label` (`'system'` hides it), status active/archived, `default_prompt_template_id`, `default_agent_id`, `terminal_layout` JSON, `worktree_mode`, `owner_user_id` |
| `track_repos` | path, remote_url, `repo_id` → `repos` |
| `track_paths` | extra dirs (`--add-dir`) plus a label |
| `tickets` | external ticket links on a track (source jira/linear/github, relationship primary/related/blocked-by, cached status) |
| `sessions` | track_id, tmux name, state, provider, name, `background`, `claude_resume_id`, `working_directory`, `worktree_root`, `deleted_at` (recycle bin) |
| `todos` | title, description, `resolution`, status, priority, `sort_order`, `issue_key`, `pull_requests` JSON `[{url,title?}]`, `session_id`, `agent_id` |
| `prompt_templates` | content with `{{…}}` vars, `is_default`, `system_kind` (`todo` / `pr-build-fix` / `pr-comment-response`, protected) |
| `repos` | global repo registry: path UNIQUE, name, main_branch |
| `settings` | key/value for everything configurable |
| `users`, `user_settings`, `user_track_prefs` | profiles (identity only), per-user prefs, per-track favorite/hidden |
| `scheduled_tasks`, `scheduled_task_runs` | see §6.8 |
| `pr_monitors` | see §6.6 |
| `pr_reviews`, `pr_review_findings` | see §6.7 |
| `diff_comments` | inline notes on a session's working-tree diff |
| `mcp_server_configs` | MCP registry: name UNIQUE, transport stdio/http/sse, command, args/env/headers JSON, url, enabled |
| `plugins` | marketplace_repo (`owner/repo`), plugin_name UNIQUE, enabled, providers JSON |
| `ticket_import_ignores` | hidden issues in the import modal |
| `agents` | legacy DB agents. Skip this; agents are files (§6.10). |

---

## 5. App shell

- **Routes and top nav, in order:**
  1. Tracks `/`
  2. Sessions `/sessions`
  3. Kanban `/kanban`
  4. Schedules `/scheduled-tasks`
  5. PR Reviews `/pr-reviews`
  6. History `/history`
  7. Settings `/settings/:tab`

  On the right side:
  - a profile chip
  - a notification bell (unread session alerts, pulsing amber)
  - a "last visited track" button, stored in localStorage

  Below the `md` breakpoint the nav collapses into a hamburger.
- **Provider stack:** AuthGate (token login) → ProfileProvider → ProfileGate ("Who's working?" picker) → SessionAlertsProvider → TopNav + CommandPalette + routes. Theme comes from localStorage and is applied before first paint.
- **Command palette** (⌘K / Ctrl+K):
  - Use a capture-phase listener so it works while xterm has focus.
  - Each time it opens, fetch tracks, sessions, todos, and PR reviews.
  - Items: pages, settings tabs, tracks, sessions, non-done todos (`/kanban?todo=`), and PRs (`/pr-reviews?review=`).
  - Scoring:

    | Match type | Score |
    |---|---|
    | Prefix | 3 |
    | Word-start | 2 |
    | Substring | 1 |
    | In-order subsequence | 0.5 |

    The subtitle counts at 0.9×. Ties go to the most recent, and the top 50 are shown.
- **Event bus.** `/ws/events` is a global `Set<WebSocket>`. `broadcast(type, trackId, payload)` sends `{type, trackId, timestamp, …}`. Event types:
  - `track:*`
  - `session:created|updated|deleted|ready|idle-alert|needs-input`
  - `todo:created|updated|deleted|dispatched`
  - `scheduled-task:*`, `pr:updated`, `pr-review:updated`, `mcp-config:updated`, `plugin:updated`

  Clients reconnect after 2s and mostly just refetch when an event arrives.

---

## 6. Features

### 6.1 Tracks

- **Dashboard.** A card grid with live badges (red needs-input, green working, idle count) fed by `GET /tracks/activity`, which comes from in-memory pane state. It has toggles for hidden and system tracks, sort by activity or A–Z, and a per-card eye icon (per-profile hidden). When a track has a session that needs input, its card shows even if the track is hidden.
- **Create track.** This:
  - sets the default agent to `global:orchestrator` if that agent file exists
  - assigns the default todo template
  - provisions a vault folder (§6.4)
  - broadcasts `track:created`
- **Track page:**
  - Header: click-to-rename title, status, "New Session".
  - Left sidebar (w-80) with three tabs:
    - **Session**: the selected session's linked todo, PR/issue icons, and the PR attention panel (§6.6).
    - **Todos**: §6.3.
    - **Config**:
      - context textarea
      - repos, picked from the global registry
      - filesystem paths
      - default agent and prompt template dropdowns
      - worktree-mode checkbox
      - ticket links
  - Main area: the terminal area (§6.2.6) plus the office strip.
  - Mobile: the sidebar becomes a slide-over drawer.
- **Prompt template variables:**
  - `{{track.id|name|description|context|repos|paths|tickets}}`
  - `{{track.repos[N].path|branch}}`
  - `{{todo.id|title|description}}`

  Unknown variables are left as-is. `GET /tracks/:id/prompt` returns an interpolated preview.
- **Archive** is done through `status`.
- **Ownership:** `owner_user_id` drives a Mine/Theirs filter.

### 6.2 AI terminal sessions (the core)

#### 6.2.1 Providers

The CLI registry lives in `src/foundation/cli-registry.ts`.

| Provider | Binary | Login command |
|---|---|---|
| claude | `claude` | `claude` |
| codex | `codex` | `codex login` |
| gemini | `gemini` | `gemini` |
| cursor | `cursor-agent` | `cursor-agent login` |

The registry also has tool entries: `gh auth login`, `glab auth login`, and `tea login add`.

- Availability is checked with `command -v`, cached per process.
- Setting `available_clis` gates the provider dropdowns. If it's unset, every installed CLI is available.
- Setting `default_ai_cli` picks the default provider.
- **Auth terminals:** an ephemeral tmux session (no DB row) runs the login command through `send-keys`, so the shell outlives the command. The UI connects at `/ws/auth/:id/terminal`.
- `POST /shell/terminal {cwd}` opens a throwaway shell. The cwd must be absolute, contain no `..`, and exist.

#### 6.2.2 Launch pipeline

This is `TerminalManager.createSession` in `infrastructure/terminal/manager.ts` and `launcher-builders.ts`.

1. Insert the DB row (`active`) and **return immediately**. Everything below runs in a non-awaited promise. The ID goes into an `initializing` set so the reaper skips it. `onReady` broadcasts `session:ready`.
2. Create worktrees if needed (§6.2.3).
3. Create the tmux session:
   - Command: `tmux new-session -d -s workshop-<uuid8> -x 120 -y 40 -c <cwd> -e PATH=<server PATH>`.
   - Blank out any Nix/direnv vars that are present (`-e VAR=`).
   - Delete `CLAUDECODE` from the environment.
   - Options: `mouse off`, `status off`, `set-clipboard on`, `history-limit 5000`. Set `terminal-features "*:hyperlinks"` once, server-wide, so OSC 8 links work.
4. Write `~/.workshop/sessions/<id>/launch.sh`. It sources `~/.workshop/session.env` with `set -a` if that file exists, which is how extra credentials such as `AWS_*` reach sessions. Then it runs the provider command.
5. Poll the pane every 100ms, for up to 5s, until a shell prompt shows. Only then `send-keys "<launch.sh>" Enter`. Keys sent earlier get dropped, especially on WSL.
6. **Claude only:** for up to 30s, auto-accept the workspace-trust dialog by sending Down until "Yes, I trust" is highlighted, then Enter. The dialog defaults to "No, exit", so a blind Enter kills the session.

Files in the session directory: `launch.sh`, `settings.json` (hooks), `mcp.json`, `system-prompt.md`, `initial-prompt.txt`, `output.txt` (captured scrollback), `design-picks/`, and `workspace/`.

**Claude command line**, in this order:
```
cd <cwd>; export CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=${CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN:=1}
exec claude [--resume <id>] [--model <m>] [--system-prompt-file system-prompt.md (not on resume)]
  [--dangerously-skip-permissions (background + opted in)] [--add-dir <p>]...
  --mcp-config mcp.json --settings settings.json [--allowedTools <t>]... [--print (scheduled)]
  ["$(cat initial-prompt.txt)"]
```
- The alternate screen is disabled because otherwise tmux has no scrollback to capture.
- `mcp.json` registers Workshop's own MCP server as `tsx <repo>/src/mcp/server.ts` with `WORKSHOP_API_URL`. Doing it per session means it doesn't rely on `~/.claude.json`.
- `--settings` carries the hooks (§6.2.5) and an `enabledPlugins` map (§6.10).
- Scheduled sessions (`background && !todoId && !interactive`) use `--print`. They don't use `exec`, so the shell survives long enough for SessionEnd to capture output, and they skip the activity hooks.

**Other providers**

| Provider | Interactive | Background |
|---|---|---|
| Codex | `codex -C <cwd> -c 'hooks.<Event>=[…]' "<system prompt>"`. Hooks: UserPromptSubmit→working, Stop/Interrupt→idle, PermissionRequest→needs-input. The session ID goes through env so the hook text stays stable. | `codex exec --full-auto -C <cwd> "<sys + prompt>"` |
| Gemini | `gemini --system-instruction <file>` | — |
| Cursor | `agent --workspace <cwd> --approve-mcps "<sys + prompt>"` | Adds `-p … --trust --output-format text` |

- For Codex and Gemini, the initial prompt is pasted after launch by a detached script. The script polls `capture-pane` (up to 90s) for the CLI's prompt glyph, then runs `load-buffer` + `paste-buffer`, then `Enter`.
- **Shell sessions** use `{shell:true}`: plain tmux, no CLI, never a worktree.
- **`sendInput(sessionId, text)`** is used by PR fixes, diff comments, and design picks. It runs `tmux load-buffer -b ws-input-<id> -` (stdin), then `paste-buffer -d`, waits 400ms, then sends `Enter`.

#### 6.2.3 Worktree mode

This is per track (or per request) and needs at least one repo.

- **Layout:** `~/.workshop/sessions/<sessionId>/workspace/<repo-basename>`, one worktree per track repo. They're created in parallel and all share one branch name.
- **Branch name:** `workshop/<slug(name,40)>-<sessionId[0:6]>[-<issueKey sanitized to [A-Za-z0-9._-]>]`.
- **Base:** `git fetch origin` (30s timeout, SIGKILL), then `origin/<repo's HEAD branch>`. If either step fails, it falls back to local HEAD.
- **Dependencies:** `node_modules` and `.venv` are symlinked from the canonical clone and added to that worktree's `info/exclude`.
- **Files at the workspace root:**
  - `.worktree-meta.json`, used for cleanup
  - a merged `.claude/settings.json` (allow, deny, and env unioned across the repos)
  - a multi-root `workspace.code-workspace`
  - `AGENTS.md`, plugin rules for Codex/Cursor
- **Working directory:** a single repo uses `workspace/<repo>`; multiple repos use the workspace root. Persist `working_directory` and `worktree_root` separately.
- **Prompt rewriting:** canonical repo paths in the prompts are rewritten to the worktree paths.
- **Cleanup:** `git worktree remove --force` for each meta entry, then `rm -rf` of the session directory. This happens on purge, not on soft delete.

#### 6.2.4 System prompt composition

Parts are joined with `\n\n---\n\n`:
0. **Soul.** Always present, prepended by TerminalManager. It loads `~/.workshop/soul.md`, falling back to the repo's `soul.md`, and it's read fresh every time.
1. `## Agent: <name>` followed by the agent body, resolved from the request's `agentId` or the track's default agent.
2. `track.context`.
3. A vault pointer (§6.4). This is not the vault content itself.
4. The track's prompt template, interpolated.
5. `## Repositories`. Skipped if the template already uses `{{track.repos`.
6. `## Track Paths`.
7. `## Task`. Skipped if the template uses `{{todo.title}}`.
8. Background instructions, for background sessions with a todo. They tell the agent: "call `workshop_update_todo` to set status `review` with a summary". This is skipped if the template already contains `{{todo.id}}`.

Model: dispatches use the setting `dispatch_model`, which defaults to `opus`. An empty string means no `--model` flag. Plain terminals use the CLI's own default.

#### 6.2.5 Hooks, resume, activity status

**Hooks.** Hooks must be `type:"command"`, because Claude Code silently ignores `http` hooks. Each command is `WORKSHOP_API_URL=… WORKSHOP_SESSION_ID=… scripts/<hook>.sh`, and it curls the API with the bearer token.

| Hook | Status / endpoint |
|---|---|
| SessionStart | `/api/hooks/session-start` → stores Claude's `session_id` as `claude_resume_id` |
| SessionEnd | `/api/hooks/session-end` (curl `-m 1`; the hook budget is about 1.5s) |
| UserPromptSubmit | working |
| Stop | idle |
| Notification `permission_prompt\|elicitation_dialog` | needs-input |
| PreToolUse `AskUserQuestion` | needs-input |
| PostToolUse `AskUserQuestion` | working |

The activity statuses go to `/api/hooks/activity`. The activity script never reads stdin and always exits 0.

**What SessionEnd does:**
1. Completes any scheduled-task run tied to the session.
2. Leaves todo-dispatched background sessions alive, so you can review them.
3. For everything else, captures the last 500 lines to `output.txt` and soft-deletes the session.

**Activity state** is in memory only.
- **Hooks are authoritative.** A hook's status wins for 5s.
- An `idle` hook is ignored while the pane shows background-work text (`local agents still running`, `Waiting for N background…`, `(N done, M in progress`).
- **Fallback: pane scraping** every 7.5s, using the last 20 non-empty lines of `capture-pane -p`.

  | Status | Pane signal |
  |---|---|
  | working | `Running…`, `Thinking`, or `esc to interrupt` |
  | idle | a composer prompt in the last 8 lines: bare `>`, a line ending in `❯`, or `❯ draft`. A numbered menu line `❯ 1. Yes` doesn't count. |
  | needs-input | `[y/n]`, `press enter`, `Do you want to`, or a trailing `?`, but only when nothing shows working and there's no composer. |

- Idle needs 2 consecutive observations before it counts.
- The idle alert fires once, 30s after idle is confirmed. There's no alert on the first observation after a restart.
- **Attention.** `attentionSince` is set when a session goes idle or needs-input while no WebSocket viewer is attached; viewers are refcounted by the bridge. Attaching a viewer clears it.

**Resume.** Claude resume works only from the original cwd.
- When tmux dies, a 30s "dying" grace starts. After it, a Claude session with a resume ID becomes **suspended**; anything else is **soft-deleted**.
- `resumeSuspendedSessions` creates a new tmux session in `working_directory` and runs `claude --resume <id>`.
- On boot, orphaned active sessions skip the grace.
- Background-only checks: a "Please run /login" pane retires the session immediately, and a bare shell prompt that persists for 30s retires it too.
- Foreground sessions are **never** idle-reaped.

**Recycle bin.** Soft delete:
1. captures scrollback to `output.txt`
2. kills tmux
3. sets `deleted_at`
4. keeps the worktree

Restore re-creates tmux and resumes. Purge destroys everything. Anything deleted more than 7 days ago is purged hourly.

**Stale-agent reaper.** Every hour it soft-deletes sessions on the PR-review and ticket-creation system tracks whose `updated_at` is more than 48h old.

#### 6.2.6 Terminal bridge and UI

**WebSocket upgrade router** (`server/websocket.ts`). Every upgrade is authenticated first. Routes, checked in order:
1. `/code/*`
2. `/ws/events`
3. `/ws/auth/:id/terminal`
4. `/ws/tracks/:t/sessions/:s/terminal`

**Session terminal connections:**
- Each connection spawns a node-pty running `tmux attach-session -t <name>` as `xterm-256color`, at the last known size.
- Data flows both ways as raw strings.
- Client control messages are JSON starting with `{`:
  - `{type:'resize',cols,rows}`, clamped to 1–500. It calls both `pty.resize` and `tmux resize-window`.
  - `{type:'capture-scrollback'}`. The server replies with `\x00` + JSON `{type:'scrollback',content}`, taken from `capture-pane -p -e -S -`.
- Buffer input until the pty exists, and poll `tmux has-session` for up to 30s while the worktree is still being created.
- Co-viewing: one pty per connection, with `window-size latest`.
- Closing the WebSocket kills the pty only. If the pty exits, call `ws.terminate()` to avoid EPIPE.

**Client** (`ui/terminal-panel/TerminalPanel.tsx`):
- xterm with the fit, web-links, and WebGL (desktop only) addons, font size 13, and a `#0a0a0a` background.
- **Scrolling:** the wheel is blocked in live mode. Wheel-up requests a scrollback capture and opens a read-only overlay xterm. Scrolling past the bottom exits it. ⌘F searches the overlay.
- **Copy/paste:** ⌘ on macOS, Ctrl+Shift on Linux and Windows. Trailing whitespace is trimmed from selections.
- **OSC 8 links** open with `noopener`.
- **Mobile:**
  - columns pinned to 120, so a phone doesn't re-wrap the desktop view
  - a key bar (Esc, arrows, Tab, Shift+Tab, Enter, Ctrl-C)
  - reconnect on `visibilitychange`
  - a transcript view that polls the Claude JSONL every 4s

**Track terminal area:**
- One or two panes, selection-based, stored in localStorage. ⌘-click adds a second pane side by side; mobile shows one.
- A recursive split-layout type (`{type:'split',direction,children,sizes}`) is persisted at `PUT /tracks/:id/layout`, debounced 500ms. You can skip it and do the 1–2 pane selection model.
- **Pane header:**
  - activity dot and double-click rename
  - PR/issue links
  - Open in editor (§6.11) and Open in terminal
  - workspace buttons: Files, Code, Preview
  - delete (soft)

#### 6.2.7 Sessions tab and office strip

- **Sessions tab:**
  - **Navigator:** all live sessions grouped by track (tracks A–Z). Sessions with attention come first, highlighted amber, then the rest by most recent activity.
  - **Hidden and system tracks** show only their needs-input sessions. This is how stuck background jobs surface.
  - **Session row:** activity dot (red/green/yellow/grey) and provider badge (claude blue, codex red, gemini yellow, cursor violet).
  - **Below the navigator:** a SessionPanel with the selected session's linked todo and PR monitors, plus a "New session" picker.
  - **Deep link:** `?session=<id>`.
- **Office strip** (fun, optional): under the terminals, a 152px row of desk cards. Each card shows an SVG character seeded from the session ID. Its state is:
  - working: working or needs-input
  - sleeping: idle
  - floor-sleeping: suspended
  - dying
  - empty

  The header has status counts and a "Recently Deleted (n)" button that opens the recycle bin. It's collapsible.

#### 6.2.8 Session history (`/history`)

- **Source:** scans `~/.claude/projects/<proj>/<id>.jsonl`, one level deep only, so subagent sidecars are skipped. Parsed entries are cached by mtime and size.
- **Entry fields:**
  - `cwd`, `gitBranch`
  - `model`: the last assistant message's model
  - `title`: `custom-title`, then `ai-title`, then `summary`
  - `preview`: the first human text
  - `firstAt`/`lastAt`, `messageCount`
- **Track matching:** each entry is matched to a track by longest cwd prefix.
- **UI:**
  - grouped by track or cwd
  - transcript modal
  - a copyable `cd '<cwd>' && claude --resume <id>`
  - **Resume into track**, which creates a session with `claude_resume_id` set and the original cwd, without a worktree

#### 6.2.9 Notifications

The client side is `ui/notifications/SessionAlerts.tsx`.

- **Triggers:** `session:needs-input` and `session:idle-alert`. Alerts are dropped if you're already looking at that track and the tab is visible and focused.
- **What an alert does:**
  - adds an unread entry (one per session)
  - sets the title to `(N) Workshop`
  - plays a generated 880Hz ping (unlock AudioContext on the first gesture)
  - shows a browser Notification tagged with the session ID; clicking it opens `/sessions?session=`
  - shows a 30s on-screen chip
- **Preferences** (`{system, sound, chip, idle, volume}`) live in localStorage and are edited in Settings → General.

### 6.3 Todos and Kanban

- **Model:** status `backlog → ready → in-progress → review → done`, priority low/med/high (shown as `!`, `!!`, `!!!`), `issue_key`, `pull_requests[]`, `resolution`, `session_id`, `agent_id`, `sort_order`.
- **Track sidebar panel:**
  - lists non-done todos
  - clicking the status chip advances it
  - Dispatch dropdown: agent (track default first), provider (filtered by available CLIs), and a "skip permissions" checkbox
  - an active-session popup
  - "Import" and "+ Add"
- **Detail modal:**
  - all fields, PR list (each PR has a "Review with agent" button)
  - "Dispatch to Agent", allowed only from backlog or ready
  - "Create issue"
  - pasting a `github.com/o/r/issues/N` URL turns it into `o/r#N`
- **Global Kanban:**
  - five columns using `@dnd-kit`
  - dropping on a column does `PUT status`; reordering within a column does `POST /todos/reorder {updates:[{id,sortOrder}]}`
  - track filter
  - `?todo=<id>` opens the modal
- **Dispatch** (`POST /todos/:id/dispatch {agentId?, provider?, dangerouslySkipPermissions?}`):
  1. Compose the system prompt (§6.2.4). If the todo's issue key isn't already in the track's tickets, merge it into `{{track.tickets}}`.
  2. Build the initial prompt: `Complete the following task:\n\n**<title>**\n\n<description>`, plus `Associated pull requests:` lines.
  3. Call `createSession` with `background`, `todoId`, `name=title`, cwd set to the first repo, the track's worktree mode, and `issueKey` (for the branch name).
  4. Set the todo to `in-progress` with `session_id` and `agent_id`. Broadcast `todo:dispatched` and `session:created`.

  Nothing on the server advances the todo after that. The agent moves it to `review` through MCP.
- **Status side effects** (`PUT /todos/:id`):
  - Moving to `done` clears `session_id` and `agent_id`, soft-deletes the linked session, and removes PR monitors. Done is destructive to the live session.
  - If `pullRequests` changed, the PR-monitor registrar reconciles, adding and removing monitors.
- **Default todo template.** It's seeded with `system_kind='todo'` and contains `## Repositories {{track.repos}}`, `## Track Paths`, `## Task **{{todo.title}}** {{todo.description}}`, and `## Background Agent Instructions` ("set todo {{todo.id}} to review…"). It's assigned to any track that doesn't have a template, on every boot.
- **Ticket import** (`/ticket-import/:source`, where source is `linear` or `github`):
  - Lists your assigned open issues.
    - Linear: GraphQL using the `linear_api_key` setting, sent raw in `Authorization`.
    - GitHub: `gh`, scoped to the org.
  - Results come back in three groups: available, ignored, and imported.
  - Importing creates a backlog todo with `issue_key`. Importing something already imported is idempotent. Ignoring adds a row to `ticket_import_ignores`.
- **Create an issue from a todo** (`POST /todos/:id/create-ticket {repo?, labels?}`):
  - **How it runs:** a one-shot `--print` background session on a system track. The agent expands the todo into Description, Implementation Details, and Acceptance Criteria. It files the issue with `gh issue create` (GitHub mode) or a Linear skill, then calls MCP `workshop_report_ticket`, which sets `issue_key`.
  - **Defaults:** the repo and labels come from the settings `issue_tracker_github_repo` and `issue_tracker_github_labels`.
  - **Validation:** they end up in a shell command inside a prompt, so validate them strictly. The repo must match `^[\w.-]+/[\w.-]+$`, and labels must not contain quotes, `$`, backslashes, commas, or newlines.
  - **Status:** the UI polls `GET /todos/:id/ticket-status`, which reads an in-memory job map.
- **Issue links:** `issueHref` sends keys to the right site. GitHub keys look like `owner/repo#N`; Linear and Jira keys look like `TEAM-123` and use the org setting.

### 6.4 Vault memory

- **Location:** Obsidian-compatible markdown at `$WORKSHOP_VAULT_ROOT`, default `~/.workshop/vault`, under `Workshop/<track-slug>/`. The slug is lowercase, with runs of non-alphanumerics replaced by `-`.
- **Provisioning.** Track creation runs it. It's idempotent, never overwrites, and creates `_overview.md`, `decisions.md`, `learnings.md`, and `progress.md`, each with YAML frontmatter.
- **Shared notes** go in `Workshop/General/`.
- **REST:**
  - `GET /vault/tracks/:slug` lists the files.
  - `GET` and `PUT /vault/tracks/:slug/*` read and write.
  - `POST …/append/*` appends; the file must already exist. Register this route before the wildcard GET.
  - Path safety: resolve the path and check that it starts with `root + sep`. The current code checks only `root`, which also accepts sibling directories.
- **MCP:** `workshop_vault_list|read|write|append`.
- **Injection.** The system prompt gets a **pointer, not the contents**: a `## Persistent Memory` block. It lists the notes that exist, shows how to call the vault tools, and says what to append where (decisions, gotchas, progress). It's added only if any notes exist. That keeps prompts small.

### 6.5 Repositories

- **Global registry** (`/repos`):
  - Add by path: expands `~`, returns 409 on a duplicate, detects main vs master.
  - Suggestions: unregistered subfolders of the setting `repo_root` (default `/repos`).
  - Delete.
- **Clone by URL** (`POST /repos/clone`):
  - Accepts https or `git@host:owner/repo` URLs, taking only the first two path segments.
  - Host, owner, and repo must match `^[A-Za-z0-9._-]+$` and must not start with `-` or `.`.
  - Uses `gh repo clone` for github.com and `tea clone` for other hosts, through `execFile` with an args array, async, with a 120s timeout. A synchronous exec would freeze every terminal WebSocket.
  - If the clone fails, return the CLI's stderr so the UI can point the user to the auth terminal.
- **Track repo links** carry live `git-status`: branch, last commit, dirty count.
- **Session workspace browser** (`/sessions/:id/workspace/tree|file|changes|diff`, plus `PUT file`):
  - The root is the session's worktree root, then the track's first repo, then the cwd.
  - Every path is realpath-checked against the root.
  - Files are limited to 1MB, with a binary sniff on the first 8KB.
  - Writes refuse symlinks that escape the root.

### 6.6 PR monitor (your PRs, attached to todos)

- **Forge adapter.** Routing is by URL host: GitHub via `gh`, Gitea/Forgejo via the tea config plus REST. `parsePrUrl` accepts both `/pull/N` and `/pulls/N`.
- **Snapshot (GitHub):**
  1. `gh pr view <url> --json state,isDraft,title,body,author,headRefName,headRefOid,mergedAt,closed,statusCheckRollup,reviews`.
  2. If the PR is open, a `gh api graphql` `reviewThreads(first:100)` query, keeping the root comment of each **unresolved** thread. This step is best-effort.
- **Check rollup** (failing outranks error outranks pending outranks passing):

  | Rollup | Conclusions / states |
  |---|---|
  | failing | FAILURE, TIMED_OUT, STARTUP_FAILURE |
  | error | ACTION_REQUIRED, STALE, CANCELLED |
  | pending | QUEUED, IN_PROGRESS, PENDING |
- **Comments that count:**
  - unresolved inline threads
  - CHANGES_REQUESTED review bodies
  - **not** plain issue comments, and not Approved/Commented summaries

  Strip HTML noise and clamp the length. Ignore authors that match the setting `pr_monitor_ignored_authors`, which defaults to `trunk-io`, `spacelift`, `wiz-inc`, `linear-code`, and `coderabbitai` (case-insensitive substring match).
- **Registration:** whenever a todo's `pullRequests` changes, monitors are reconciled. They're removed when the todo is done.
- **Poller:**
  - every 2 minutes, up to 5 monitors per cycle (the least recently polled), 1s apart, with an in-flight guard
  - "changed" means state, check status, failing count, comment count, or title changed; filter out dismissed comment IDs before comparing
  - on a change it broadcasts `pr:updated`
  - merged or closed PRs stop monitoring (`pause_reason='finished'`)
  - **Stale auto-pause:** an open PR with no head SHA change for 60 minutes, no failing checks, and no open comments is paused (`pause_reason='stale'`).
- **Sidebar panel:**
  - state and CI badges
  - failing checks with a lazy log: `gh run view --job <id> --log-failed`, the last 200 lines with prefixes stripped. The job ID is parsed from `detailsUrl` and the check is looked up by name on the server.
  - the comment list, with per-comment dismiss (stored locally only)
  - "Polled HH:MM", refresh (`poll-now`), and "Resume monitoring"
- **Actions are manual. Nothing auto-fixes.**
  - "Send failing checks to session" and "Send comments to session" interpolate the `pr-build-fix` or `pr-comment-response` system template (`{{pr.url|title|number|branch|repo|state|check_status|failing_checks|comments}}` on top of the track and todo variables).
  - The result is sent with `sendInput` into the todo's **existing live session**. If that session isn't running, the request returns 409.

### 6.7 PR review dashboard (PRs others asked you to review)

- **Discovery** runs every 5 minutes:
  - GitHub: `gh search prs user-review-requested:@me --state=open --json …`. This means explicit requests only, not team requests.
  - Gitea: `issues/search?type=pulls&review_requested=true`.
  - New PRs are upserted as `incoming`.
  - A poll-discovered `incoming` PR that's gone from the results is deleted, but only if its host answered this pass.
  - A `submitted` review (within 14 days) whose head SHA changed becomes `needs_rereview`.
  - Manual add by URL is supported. Delete is soft (`removed`), so discovery doesn't bring it back.
- **States:** `incoming | analyzing | ready | submitted | needs_rereview | dismissed | removed`.
- **Analyze:**
  - Dispatches the `global:pr-review` agent as a background but **interactive** session (you can chat with it from the detail page). It runs on a lazily created system track called "PR Reviews", with no worktree.
  - Provider and model come from settings.
  - On re-analysis, the prompt lists earlier findings so the agent doesn't duplicate them.
- **Agent contract** (`templates/agents/pr-review.md`). Three passes:
  1. correctness and safety
  2. over-engineering
  3. unnecessary comments, plus PR-description narrative

  The suggested verdict is approve if there are no correctness findings, request_changes if there are any, and comment when it's borderline. It **never posts to the forge**. It calls `workshop_report_pr_review {prUrl, findings[{file,line?,category?,summary,failureScenario?,suggestedComment}], draftSummary, suggestedVerdict}`.
- **Report endpoint:**
  1. Fetches the diff and the snapshot.
  2. Parses the unified diff, marks each finding `anchored` if its line is in the diff, and stores ±hunk context (clamped to 24 lines).
  3. Replaces the stored findings and sets the review to `ready`.

  If the diff fetch fails, findings are stored unanchored.
- **Detail UI:**
  - per-finding keep or dismiss, and edit of the suggested comment
  - editable summary
  - verdict select, with the agent's suggestion marked
  - confirm before posting
  - a "PR updated since analysis" hint
- **Submit:**
  1. Re-fetch the diff and re-anchor.
  2. Build the payload. Anchored findings become inline comments `{path,line,side,body}`. Unanchored ones are appended to the body as `**file:line** — comment`.
  3. **Drain any PENDING review.** GitHub allows one per user, so merge its comments into the payload and delete it.
  4. Post once with `gh api POST repos/o/r/pulls/N/reviews --input -`, with the event set to APPROVE, REQUEST_CHANGES, or COMMENT.
  5. If posting fails, recreate the pending review.

### 6.8 Scheduled tasks

- **Model:** name, description, `schedule_config` JSON plus the derived cron and a human-readable description, `track_id?`, `agent_id?`, provider, `task_prompt`, `system_prompt_override`, `script_path`, `skip_on_nonzero`, `template_name`, `enabled`, `last_run_at`, `last_run_status`, `run_count`. Runs have `running | completed | failed | skipped`, a session ID, output, and timestamps.
- **Schedule presets** (`cron-utils.ts`; describe them as "Weekdays at 09:00"):

  | Preset | Config |
  |---|---|
  | interval | N minutes |
  | daily | time + days of week |
  | weekly | time + day of week |
  | monthly | day-of-month, or Nth (or last) weekday of month |
  | cron | raw cron expression |
- **Executing a run:**
  1. Compose the prompt. `system_prompt_override` wins; otherwise use the agent, track context, interpolated template, repos, and paths.
  2. **Pre-script:** `bash <script>` with a 60s timeout.
     - Exit 0 with stdout: the stdout is prepended to the prompt as `## Script Output`.
     - Non-zero exit with `skip_on_nonzero` set: record a `skipped` run and **still advance `last_run_at`**.
     - Non-zero exit otherwise: warn and continue.
  3. Launch a background session with `--print` and skip-permissions. The cwd is the first track repo. Tasks without a track go to a system track called `_Scheduled Tasks`.
  4. SessionEnd marks the run `completed`.
  5. `GET runs` self-heals any `running` run whose session is gone.
- **Catch-up after sleep:**
  - node-cron uses a monotonic clock that pauses while the laptop sleeps. So run a 60s wall-clock timer, and if `Date.now()` jumps by more than 90s, call `catchUpMissed()`. It also runs at startup.
  - `catchUpMissed()` looks at each enabled task. If the last scheduled time before now is later than `last_run_at` (or `createdAt`), it queues **one** run, staggered at 5s + n·3s.
  - Dedupe against cron fires with an `inFlight` set and a re-check at fire time.
- **Templates** (`templates/schedules/*.json`):
  - **Import:** at boot, templates are imported by name and never overwrite. They're always imported **disabled**, and an optional script is copied to its install path with mode 755.
  - **Sync status:** `isOutOfSync` compares the prompt and schedule with the template, and the UI shows the diff with a "Sync from template" action.
  - **Save as template:** writes a template JSON into the repo.
- **"Generate from description"** shells `claude -p` and parses JSON: name, schedule, prompt, and suggested script.
- **UI:**
  - **List cards:** each shows the last 5 runs, which update live and poll every 5s while a run is active, plus an output viewer.
  - **Controls:** toggle, run now, and a templates picker.
  - **Form:** presets, track, agent, provider, a script editor (saved to `~/.workshop/schedule/scripts/<slug>.sh`), and skip-on-nonzero.

### 6.9 Diff review comments (a session's working tree)

- **Changes list:** `git status --porcelain=v1 -z --untracked-files=all` per repo, using the root or immediate children that contain `.git`.
- **Diffs:** `git diff HEAD -- <file>`, or `git diff --no-index /dev/null <file>` for untracked files (exit code 1 is fine there).
- **Viewer:** a file list with M/A/D/R/?? badges and a colored diff. Click a new-side line to comment.
- **Stored comment:** file, line, line text, hunk context, body, status open/resolved, `sent_at`.
- **Re-anchoring** happens on every read:
  - keep the line if its text is unchanged
  - otherwise jump to the nearest identical line
  - otherwise mark the comment `anchored=false` and show it as outdated
- **"Send to session"** pastes every open comment as one prompt ("address all N in one pass…"). Comments sent before are labelled "still open from a previous pass".
- `parseUnifiedDiff`, `isAnchorable`, and `extractHunkForLine` are shared with PR review.

### 6.10 Agents, skills, plugins, MCP servers, prompt templates (Settings)

**Agents** are markdown files: `~/.claude/agents/*.md` (ID `global:<slug>`) and `<project>/.claude/agents` (`project:<slug>`, read-only).
- **Frontmatter:** `name`, `description`, `model`, `color`, `tools` (comma-separated), `maxTurns`, `provider`, `templateName`, `autoInstall`.
- **Templates** live in `templates/agents/`.
  - At boot, any template with `autoInstall: true` is copied **only if it's missing**, so user edits are never overwritten.
  - **Drift:** an agent is out of sync when its body (after the frontmatter) differs from its template's body. The UI shows a badge, a diff, and a "Sync from template" action.
- **Agent actions in the UI:**
  - CRUD
  - "Generate from description" and "Improve with feedback". Both run `claude -p` and extract JSON. If the binary is missing, they return 503 `claude_not_found`.
  - "Save as template"
- **How agents are used:** the agent isn't passed as `--agent`. Its body becomes the `## Agent:` section of the system prompt.
- **Bundled agent templates:**
  - `orchestrator` (opus, auto-installed; plans, delegates to cheaper subagents, self-reviews, offers a PR)
  - `pr-review` (sonnet, auto-installed)
  - `senior-node-engineer`
  - `ci-cd-devops-engineer`

**Skills** live in `~/.claude/skills/<name>/SKILL.md` (and `<project>/.claude/skills`).
- **Scanning:** both frontmatter and `# Heading` formats are read.
- **Writing:** always the directory form. Rename moves the directory and patches `name:`.
- **Templates** live in `templates/skills/<slug>/SKILL.md`. Installs are manual, with the same drift detection as agents, plus generate and improve.
- **Generic skills worth shipping:**
  - `submit-for-review`: commit, branch, PR, move the todo to review
  - `done`: verify the PRs are merged, then mark the todo done
  - `improve-agent` / `improve-skill`
  - `learn-repos`: writes a track context brief
  - `pr-watch`: resume a paused PR monitor

**MCP server registry** (Settings → MCP):
- **Storage:** the `mcp_server_configs` table.
- **Adapter interface:** one adapter per CLI with `isAvailable / listServers / installServer / removeServer`.
  - **Claude:** parses `claude mcp list` / `claude mcp get`. Install runs `claude mcp remove -s user` then `claude mcp add-json -s user <name> <json>`.
  - **Codex:** reads and writes `~/.codex/config.toml` `[mcp_servers.*]` with smol-toml.
  - **Gemini:** edits its settings file.
- **Routes:** "Import from Claude", "Install", and "Install all".

**Plugins** (Settings → Plugins) are a registry of marketplace plugins (`owner/repo` + `plugin@marketplace`).
- **Sync** runs at boot (fire-and-forget) and from `POST /plugins/sync`. It never throws.
  1. Shallow-clone or ff-pull to `~/.workshop/plugins/<owner>-<repo>`.
  2. Detect providers: `.claude-plugin/` → claude, `gemini-extension.json` → gemini, `AGENTS.md` → codex and cursor.
  3. Claude: `claude plugin marketplace add` + `claude plugin install`.
  4. Gemini: install the extension.
  5. Codex: write a rules block between `<!-- workshop:plugins:start/end -->` markers in its global AGENTS file.
- **Per-session control:** every launch writes `enabledPlugins` into `--settings` with an explicit `true` or `false` for **every** registered plugin. That way a Workshop-level disable overrides a user-global install.

**Prompt templates** (Settings → Templates): CRUD over `prompt_templates`. System kinds (`todo`, `pr-build-fix`, `pr-comment-response`) are seeded and can't be deleted.

**Settings tabs:**

| Tab | Contents |
|---|---|
| General | theme, notification prefs, default AI CLI, dispatch model, PR review provider/model, PR monitor ignored authors, available CLIs with login buttons, backup, soul editor, launch apps |
| Profile | — |
| Agents | — |
| Skills | — |
| MCP | — |
| Plugins | — |
| Templates | — |
| Repositories | — |
| Issue Tracking | tracker linear/jira/github/none, org, Linear API key (write-only; GET returns only `linearApiKeyConfigured`), GitHub default repo and labels |

### 6.11 Editors, code-server, preview / Design Mode

- **Open in editor:**
  - The app detects the platform (darwin/linux/wsl), editors (`cursor`, `code`), and terminals (iTerm, Konsole, gnome-terminal, `wt.exe`).
  - On macOS it falls back to the `.app` bundle when the CLI shim is missing.
  - **Per-user settings:** an editor URI prefix (VSCode Remote-SSH, local VS Code, or Cursor presets) and path remaps (`from -> to` lines, longest prefix wins, segment-boundary match) for when the server runs in a container.
- **code-server** (optional; enabled only inside a container, detected by `/.dockerenv` or `/run/.containerenv`):
  - **Process:** one lazily spawned shared process: `--auth none --bind-addr 127.0.0.1:<free port> --disable-telemetry --disable-update-check --disable-workspace-trust`, with data, extensions, and config under `~/.workshop/code-server/`.
  - **Env:** override `PORT` in its environment, because code-server reads it.
  - **First-run settings:** `editor.editContext:false` fixes dropped keystrokes.
  - **Proxy:** at `/code/` behind Workshop auth; WebSocket upgrades are raw-piped.
  - **Opening it:** the UI opens `/code/?folder=` or `?workspace=<.code-workspace>`. Open the tab synchronously, before any fetch, so popup blockers don't stop it.
- **Preview proxy and Design Mode** (optional):
  - **Why a separate server:** it's a second HTTP server on `PORT+100`, so the dev server under preview gets its own origin and absolute paths and HMR keep working.
  - **Start URL:** `/__workshop/start?target=<url>&path=` sets a target cookie and redirects.
  - **Proxying:**
    - forwards everything to the target with `accept-encoding: identity`
    - strips Workshop's cookies before forwarding
    - removes `X-Frame-Options` and CSP from responses
    - injects `<script src="/__workshop/picker.js">` into HTML
    - raw-pipes WebSocket upgrades
  - **Picker:** active only inside an iframe, toggled by `postMessage`. It highlights elements on hover and builds a unique selector. Each pick posts the selector, URL, outerHTML, parent HTML, text, about 23 computed styles, and the element's box.
  - **Screenshots:** an optional Playwright sidecar at `WORKSHOP_SCREENSHOT_URL`.
  - **Send:** "Send to session" writes `design-picks/<iso>.md` and pastes its path into the session with `sendInput`.

### 6.12 Auth and profiles

- **Token:**
  - One shared 64-hex token, from `$WORKSHOP_AUTH_TOKEN` or `~/.workshop/auth-token`. It's generated with mode 0600 on first use.
  - Accepted as `Authorization: Bearer`, the httpOnly `workshop_token` cookie (SameSite strict, 1 year), or `?token=`.
  - Compared in constant time, with a length check.
  - Guards `/api/*` and every WebSocket upgrade.
  - `/api/auth/login|status|logout` stay public.
  - MCP and hook scripts read the same token file.
- **Profiles** are identity, **not** security.
  - A `users` row plus a `workshop_profile` cookie (not httpOnly).
  - Per-user settings: theme and editor prefs.
  - Per-track prefs: favorite and hidden.
  - If there's no profile, the app behaves as single-user.

### 6.13 Backup

- **Schedule:** setting `backup_cron`, default `0 3 * * *`. If the last success is more than 24h old, it also runs 10s after boot and from an hourly watchdog.
- **What's backed up:** an online `db.backup()` (WAL-safe) plus `~/.claude/settings*.json`.
- **Format:** tar → Brotli → AES-256-GCM, written as `workshop-backup-<ts>-<daily|weekly>.tar.br.enc`.
  - The file starts with `WSBAK\0` and a version byte, then a 32-byte scrypt salt and a 12-byte IV, then the ciphertext, then a 16-byte auth tag.
  - Sunday's backup is weekly. Retention keeps 3 daily and 4 weekly.
- **Settings and status:** the destination and passphrase are in settings; GET never echoes the passphrase. Status keys record the last run.
- There's a `restoreBackup` function with nothing calling it. Give yours a restore command.

### 6.14 MCP server for agents

`src/mcp/server.ts` uses `McpServer` over stdio.
- **Tools:** each is a thin wrapper around `fetch(WORKSHOP_API_URL + '/api' + path)` with the bearer token, zod input schemas, and JSON text results.
- **Errors:** a non-2xx response throws `Workshop API <status>: <body>`.
- **Logging** goes to **stderr only**, because stdout is the JSON-RPC channel.
- Because the tools call the REST API, **every MCP tool needs a matching REST route**, and agents see backend changes only after the server restarts.

| Area | Tools |
|---|---|
| Tracks | `list_tracks`, `get_track`, `create_track`, `update_track`, `set_context`, `get_context`, `get_composed_prompt` |
| Sessions | `list_sessions`, `create_session` |
| Repos/paths | `add_repo`, `remove_repo`, `add_path`, `remove_path`, `list_repos`, `create_repo`, `delete_repo` |
| Todos | `list_todos`, `create_todo`, `update_todo`, `dispatch_todo`, `delete_todo`, `report_ticket` |
| Vault | `vault_list`, `vault_read`, `vault_write`, `vault_append` |
| Schedules | `list/create/update/delete/toggle/trigger_scheduled_task`, `sync_scheduled_task_from_template` |
| PR review | `dispatch_pr_review` (creates a todo if needed, then dispatches `global:pr-review`), `report_pr_review` |
| Plugins | `list_plugins` |

All names are prefixed `workshop_`. Register the server per session through `--mcp-config` (§6.2.2). For hand-started sessions, document a `~/.claude.json` entry.

---

## 7. `~/.workshop` layout

```
~/.workshop/
  workshop.db (+ -wal, -shm)     auth-token (0600)     soul.md (user override)
  session.env                    # KEY=VAL sourced into every session (credentials)
  server.pid  server.log         # prod runner
  sessions/<id>/                 # launch.sh settings.json mcp.json system-prompt.md
                                 # initial-prompt.txt output.txt design-picks/ workspace/<repo>
  vault/Workshop/<track-slug>/*.md
  schedule/scripts/*.sh
  plugins/<owner>-<repo>/
  code-server/{data,extensions,config.yaml}
```
Workshop also touches `~/.claude/{agents,skills,plugins,settings.json,projects}`, `~/.claude.json`, `~/.codex/config.toml`, and `~/.gemini`.

## 8. Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | API port |
| `NODE_ENV=production` | serve the built client |
| `WORKSHOP_DB_PATH` | DB path override |
| `WORKSHOP_API_URL` | used by MCP and hooks. **Always set it explicitly**; the code defaults disagree (3001 vs 3002). |
| `WORKSHOP_AUTH_TOKEN` | override the token file |
| `WORKSHOP_VAULT_ROOT` | vault location |
| `WORKSHOP_PREVIEW_PORT` | preview proxy port |
| `WORKSHOP_SCREENSHOT_URL` | Playwright sidecar for Design Mode |
| `WORKSHOP_CODE_SERVER_BIN`, `WORKSHOP_CODE_SERVER_PORT` | code-server |
| `TEA_CONFIG` | Gitea CLI config path |
| `WORKSHOP_SESSION_ID` | set on hook commands |
| `PUID`, `PGID` | Docker user mapping |

## 9. Running it

- **Dev:** `npm run dev`, which uses `concurrently` to run `tsx watch src/server/index.ts` and `vite`.
- **Prod:** `scripts/workshop.sh start|stop|restart|status|logs|install-launchd`.
  - It runs `NODE_ENV=production PORT=3002 nohup npx tsx src/server/index.ts`, with the pid and log under `~/.workshop`.
  - It unsets `CLAUDECODE`, so sessions can run `claude`.
  - It fixes node-pty's `spawn-helper` permissions on darwin.
  - `install-launchd` writes a KeepAlive LaunchAgent. After that, start, stop, and restart go through `launchctl`.
- **First run:** `scripts/init.sh` checks node, npm, tmux, and claude, then runs `npm install`.
- **Claude settings:** recommend `"permissions":{"defaultMode":"acceptEdits"}` in `~/.claude/settings.json`, so background agents don't stall.
- **Nix (optional):** a `flake.nix` dev shell with `nodejs_24` and `tmux`, activated through direnv.

## 10. Docker (optional)

- **Build** (multi-stage `node:24-slim`):
  - The builder runs `npm ci`; native modules need python3, make, g++, and git.
  - Then it runs `vite build`.
- **Runtime image:**
  - packages: git, tmux, curl, jq, sqlite3, ripgrep, direnv, gosu, dumb-init
  - CLIs: `gh`, `tea`, code-server, Nix (Determinate installer, `--init none`), and the `@anthropic-ai/claude-code` npm package
- **Env:** `HOME=/config`, so all state lands on one volume. Also `DISABLE_AUTOUPDATER=1`.
- **Ports:** exposes 3002 and 3102.
- **Entrypoint:**
  1. Start nix-daemon.
  2. Run `git config --system safe.directory '*'`.
  3. Create or modify a user for `PUID`/`PGID`.
  4. **Reconcile ownership** of `~/.claude*`, `.codex`, `.gemini`, `.config`, and `.git-credentials` on every boot. Without this, the CLIs lose their login after a restart.
  5. `exec gosu`.
- **Compose:**
  - volumes: `workshop-state:/config`, `~/.claude:/config/.claude`, `./repos:/repos`
  - an optional Playwright service under profile `design-mode`
- **Arch:** build on the same architecture you run on, because of the native modules.

## 11. Gotchas (keep all of these)

1. **One TerminalManager instance** shared by REST and WebSocket, or the activity and attention state splits in two.
2. **Send keys only after the shell prompt has painted**, or they get lost. Never use `tmux new-session <cmd>` for login terminals, because the shell has to outlive the command.
3. **Disable Claude's alternate screen** (`CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1`) and keep tmux `mouse off`. Otherwise you have no scrollback to capture.
4. **`--mcp-config` is variadic**: it swallows a trailing positional prompt. Put it before `--settings`, with the prompt last.
5. **Hooks must be `type:"command"`**, and they must be fast:
   - SessionEnd gets about 1.5s
   - pass the session ID through env, not stdin
   - always exit 0
6. **Claude resume is keyed by cwd.** Persist the original working directory, and capture the resume ID from the SessionStart hook. Don't guess it.
7. **The reaper must skip sessions that are still initializing.** Otherwise a bare-shell prompt during worktree setup retires a healthy session. Never idle-reap foreground sessions.
8. **Hooks beat pane scraping**, but give them a 5s grace only. Pressing Esc fires no Stop hook, so the pane has to be able to override.
9. **Async everything that shells out** from request handlers (clone, gh). A synchronous exec freezes every terminal WebSocket.
10. **Express 4 swallows rejected async handlers.** Wrap them in a `safe()` helper.
11. **Route order:** `/tracks/activity` and `/tracks/by-room` before `/tracks/:id`, `/repos/suggestions` before `/repos/:id`, and vault append before the vault wildcard.
12. **Mount the code-server proxy before `express.json`.**
13. **node-cron doesn't fire across sleep.** Use the wall-clock-gap detector plus an `inFlight` dedupe, and advance `last_run_at` on skipped runs.
14. **GitHub allows one pending review per user.** Drain and merge it before posting. Re-anchor findings against a fresh diff at submit time, or GitHub returns 422.
15. **Filter dismissed PR comments before change detection**, or a PR never reaches stale-pause.
16. **Validate anything that gets interpolated into a shell command**, including commands inside prompts: repo slugs, labels, clone URLs. Use `execFile` with arg arrays.
17. **Realpath-check every workspace path against its root, with a trailing separator.**
18. **The server often starts without the user's PATH.** Resolve `claude` by trying `command -v`, then `~/.local/bin`, `~/.claude/local`, `/usr/local/bin`, and `/opt/homebrew/bin`, and inject the server's PATH into tmux.
19. **Marking a todo `done` kills its session** (into the recycle bin). Make that obvious in the UI.
20. **Registry and launcher drift:** the cursor binary is `cursor-agent` in the registry but `agent` in the launcher. Pick one.

## 12. Suggested build order

Each phase should end with typecheck, tests, and a demo.

1. **Skeleton.** Express, the SQLite migrations runner, the token auth plus login page, the React shell with TopNav and routes, and the `/ws/events` bus.
2. **Tracks.** CRUD, repos and paths, the global repo registry, context, and the dashboard.
3. **Terminals.** TerminalManager (tmux create/kill/sync), the WebSocket ↔ node-pty bridge, xterm with the scrollback overlay, and plain-shell sessions.
4. **Claude sessions.**
   - launcher and system-prompt composition
   - soul and prompt templates
   - hooks (resume plus activity), suspend and resume, recycle bin and purge
5. **Attention.** Activity status, dashboard badges, the Sessions tab, browser notifications, and the title count.
6. **Todos.** Track panel, Kanban, dispatch to background agents, and worktree mode.
7. **MCP server.** Track, todo, session, and vault tools; per-session `--mcp-config`. Add the vault.
8. **Settings.** Agents and skills (file-based, templates, drift), the available CLIs and login terminals, and the issue tracker.
9. **PR monitor.**
10. **PR review dashboard.**
11. **Scheduled tasks**, including catch-up.
12. **Optional extras:**
    - other providers (Codex, Gemini, Cursor)
    - MCP registry, plugins
    - ticket import, issue creation
    - diff comments, workspace browser
    - session history, command palette
    - backup, office strip, code-server, Design Mode, Docker

## 13. Out of scope (don't copy these)

- **Workflow tab:** epics, tasks, playbooks, agent roles, human gates, usage pacing, and the SubagentStop/StopFailure execution hooks. The tables `workflow_*` and `ticket_dependencies` and the `/workflow` routes belong to it.
- **Discussions:** teams, votes, consensus.
- **Automation rules** (`automation_rules`): the triggers are never fired and the actions are `console.log` stubs. Scheduled tasks do this job.
- **Track summaries:** removed. The `summaries` table is an orphan.
- **Sprite generator** (Replicate PNGs): dead code. The office uses the SVG characters.
- **Matrix room router:** keeps one live session per Matrix-bound track. Niche.
- The recursive split-pane layout component is unused by the track view. Use the simple 1–2 pane selection instead.

## 14. Personal bits to swap for your own

- `soul.md`: the ship-AI persona prepended to every session.
- The seeded default plugin (`ponytail@ponytail`).
- The hardcoded Linear team `ASY` in the issue-creation prompt.
- Skills and agents tied to one environment: `linear`, `nozzle-repo-bootstrap`, and `ci-cd-devops-engineer` (internal ECR / BuildKite).
- The bundled schedules `diary` (an external Go collector), `bubble-permissions`, `sync-repos`, and `periodic-checkup`. They're good examples of pre-script plus prompt, so rewrite them for your own setup.
- The default PR-monitor ignored-author list.
