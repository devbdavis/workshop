# Setup Guide

Everything you need to get Workshop running, including the external tools it relies on.

## 1. System Dependencies

### Nix + direnv (recommended)

The repo ships with a `flake.nix` that provides Node.js 24 and tmux. With [Nix](https://nixos.org/) and [direnv](https://direnv.net/) installed, entering the repo directory is all it takes to get a complete, reproducible dev environment.

**Install Nix** (if not already installed):

```bash
# macOS / Linux — Determinate Systems installer (recommended)
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
```

**Install direnv** and hook it into your shell:

```bash
# macOS
brew install direnv

# Ubuntu/Debian
sudo apt-get install direnv
```

Then add the hook to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.):

```bash
eval "$(direnv hook zsh)"   # or bash / fish
```

**Enter the dev environment:**

```bash
cd workshop
direnv allow   # one-time: permits the .envrc in this repo
```

From that point on, `node`, `npm`, and `tmux` are all available whenever you're inside the repo directory — no manual activation needed.

### Manual installation (without Nix)

If you prefer not to use Nix, install the dependencies directly:

```bash
# Node.js 24 via brew
brew install node@24

# tmux
brew install tmux             # macOS
sudo apt-get install tmux     # Ubuntu/Debian
```

### tmux

Terminal sessions in Workshop are backed by tmux. Without it, you can still use the web UI, workflow tickets, and MCP tools — but terminal sessions won't work.

If you've never used tmux: don't worry, Workshop manages the sessions for you. You never need to run tmux commands directly.

## 2. AI CLI Tools

Workshop can launch terminal sessions with either Claude Code or Codex. You need at least one.

### Claude Code (recommended)

Claude Code is the primary integration. Install and authenticate:

```bash
# Install
npm install -g @anthropic-ai/claude-code

# Authenticate — opens a browser for login
claude auth login

# Verify
claude --version
```

Authentication depends on your setup — if your org uses SSO, so Claude Code picks up credentials automatically. Otherwise you'll need a Claude Pro/Team/Enterprise subscription or an Anthropic API key.

See [Claude Code docs](https://docs.anthropic.com/en/docs/claude-code) for detailed setup.

### Codex (optional)

If you want to use OpenAI's Codex CLI as an alternative provider:

```bash
# Install
npm install -g @openai/codex

# Authenticate via SSO
codex auth login

# Verify
codex --version
```

Via org SSO, Codex authenticates through SSO — no API keys needed. If you're outside the org, see the [Codex docs](https://github.com/openai/codex) for authentication options.

When creating sessions in Workshop, you can choose the provider (Claude or Codex) per session.

## 3. Workshop Installation

```bash
# Clone the repo
git clone https://github.com/devbdavis/workshop.git
cd workshop

# Run the setup script (checks prerequisites and installs npm packages)
./scripts/init.sh

# Or install manually
npm install
```

The database is auto-created on first run — no migration steps needed.

## 4. Running Workshop

### Development mode

```bash
npm run dev
```

This starts the backend on port 3001 and Vite (frontend HMR) on port 5173. Open [http://localhost:5173](http://localhost:5173).

### Production mode

```bash
npm run build
scripts/workshop.sh start
```

This builds the frontend, then starts a background server on port 3002 serving everything from a single process. The database lives at `~/.workshop/workshop.db` (separate from the dev database at `./workshop.db`).

Check status and logs:

```bash
scripts/workshop.sh status
tail -50 ~/.workshop/server.log
```

## 5. MCP Server (Claude Code Integration)

The MCP server lets Claude Code interact with Workshop programmatically — listing tracks, setting context, creating sessions, managing todos, and more.

### Configure Claude Code

Sessions launched by Workshop get this server automatically (via `--mcp-config`). The config below is only needed for Claude Code sessions you start yourself.

Add Workshop's MCP server to your Claude Code config:

Add to `~/.claude.json` under `mcpServers` (global — available in all Claude Code sessions):

**If using Nix** (recommended):

```json
{
  "mcpServers": {
    "workshop": {
      "command": "/absolute/path/to/workshop/scripts/mcp-server.sh",
      "env": {
        "WORKSHOP_API_URL": "http://localhost:3002"
      }
    }
  }
}
```

The wrapper script resolves the repo root via `BASH_SOURCE`, so it works regardless of Claude Code's working directory. This is important when using Workshop — sessions run in workspace directories, not the repo root.

**If using system Node 24+**:

```json
{
  "mcpServers": {
    "workshop": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/workshop/src/mcp/server.ts"],
      "env": {
        "WORKSHOP_API_URL": "http://localhost:3002"
      }
    }
  }
}
```

### Verify

After configuring, restart Claude Code and try:

```
Use the workshop_list_tracks tool to show my tracks
```

You should see the MCP tools respond. If not, check that the Workshop server is running.

## 6. Claude Code Skills (Optional)

Workshop ships with two Claude Code skills that teach Claude how to manage the server and use MCP tools effectively:

```bash
# From the workshop directory
ln -s "$(pwd)/skills/workshop-server" ~/.claude/skills/workshop-server
ln -s "$(pwd)/skills/workshop-mcp" ~/.claude/skills/workshop-mcp
```

After symlinking, Claude Code automatically discovers these skills and uses them when relevant (e.g., restarting the server after code changes, or interacting with tracks).

## 7. Obsidian Vault (Optional)

Workshop can integrate with an Obsidian vault for persistent, human-readable track memory — decisions, learnings, progress notes. This is entirely optional.

### Setup

1. Create a vault directory (or use an existing Obsidian vault):

```bash
mkdir -p ~/projects/WorkflowDocs
```

2. Set the environment variable (or accept the default `$HOME/projects/WorkflowDocs`):

```bash
export WORKSHOP_VAULT_ROOT=~/projects/WorkflowDocs
```

3. Workshop automatically creates a `Workshop/{track-slug}/` folder per track inside the vault.

### What gets stored

Each track folder contains markdown files:

```
Workshop/
  my-project/
    _overview.md       # Auto-generated track overview
    decisions.md       # Architectural decisions
    learnings.md       # Gotchas and patterns
    progress.md        # Session progress log
```

These files are automatically included in the system prompt when new AI sessions are created for a track, giving agents long-term memory across sessions.

If you don't use Obsidian, you can still read/edit these files with any text editor — they're just markdown.

## 8. Verify Everything Works

Run through this checklist:

```bash
# 1. Prerequisites
node -v                        # Should be >= 24
tmux -V                        # Should output a version
claude --version               # Should output a version (if using Claude)

# 2. Tests pass
npm test                       # All tests green

# 3. Dev server starts
npm run dev                    # Backend + frontend start without errors

# 4. UI loads
open http://localhost:5173     # Dashboard renders

# 5. Production server (optional)
npm run build
scripts/workshop.sh start
curl -s http://localhost:3002/api/tracks   # Returns JSON
```

If something fails, check:
- `~/.workshop/server.log` for production server errors
- The terminal output for dev server errors
- That Claude Code is authenticated (`claude auth status`)

## Troubleshooting

### `node-pty` fails to install

node-pty is a native module. On macOS you need Xcode Command Line Tools:

```bash
xcode-select --install
```

On Linux you need build tools:

```bash
sudo apt-get install python3 make g++
```

### tmux sessions aren't working

Verify tmux is in your PATH:

```bash
which tmux
```

Workshop resolves the tmux path at startup. If you installed tmux after starting the server, restart it.

### Claude Code MCP tools not showing up

1. Make sure the Workshop server is running
2. Check your MCP config path is correct (`~/.claude/mcp.json` or `.claude/mcp.json`)
3. Restart Claude Code after config changes
4. Try `claude mcp list` to see registered servers
