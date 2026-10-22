# Project Tracks — Harness Engineering Definition

> An abstract harness definition for building and maintaining Project Tracks
> with AI coding agents. Tech-stack agnostic — specific tooling decisions are
> deferred.

---

## 1. What This Document Is

This is the **architectural contract** between human engineers and AI agents
working on this codebase. It defines how the project is structured, how agents
should operate within it, and what mechanisms keep the system maintainable as
agents generate the bulk of the code.

Harness engineering treats AI code generation as a **systems design problem**.
The harness is not the agent — it is the infrastructure that governs how agents
operate: what they can see, what they can do, and how mistakes are caught and
prevented from recurring.

### Guiding Metaphor

> The model is the engine. The harness is the car.
> — [The Agent Harness Is the Architecture](https://dev.to/epappas/the-agent-harness-is-the-architecture-and-your-model-is-not-the-bottleneck-3bjd)

The model generates responses. The harness manages context, enforces
constraints, tracks state, and provides feedback loops. The harness determines
whether agents succeed or fail — not the model.

---

## 2. Core Principles

### 2.1 Constrain the Solution Space

Rigid structure amplifies agent effectiveness. Fewer choices produce better
results. Vercel demonstrated this empirically: reducing available tools from 15
to 2 improved accuracy from 80% to 100% while cutting token usage by 37%.

**For Project Tracks**: Every domain boundary, dependency direction, and naming
convention is an explicit constraint. Agents don't self-regulate — the harness
enforces boundaries mechanically.

### 2.2 The Repository Is the Source of Truth for Structure; MCPs Are the Source of Truth for Context

Standard harness engineering doctrine says "anything not in the repo doesn't
exist." That principle applies to **structural knowledge** — architecture,
conventions, constraints, and pitfalls. But Project Tracks exists precisely
because valuable context lives *outside* the repo: in Jira issues, Slack
threads, Google Docs, Confluence pages, and design documents.

**For Project Tracks**: The repo is the source of truth for *how to build*.
MCP integrations (Glean, Atlassian, Linear, etc.) are the source of truth for
*what to build and why*. Both are first-class context sources.

This means:
- **Architectural decisions, conventions, and constraints** → live in the repo
  (`docs/`, `AGENTS.md`, linter rules)
- **Requirements, context, prior art, domain knowledge** → accessed via MCP at
  runtime (Glean for GDrive/Slack/Confluence, Atlassian for Jira, etc.)
- **Cached external context** → synced snapshots of issue state, relevant
  docs, and conversation threads stored locally per-track for offline access
  and reduced latency

Agents working on a track should be encouraged to **pull context from MCPs**
when they need domain understanding, not just work from what's already in the
repo. The harness provides the *tools and permissions* to do this safely.

### 2.3 Build to Delete

Every piece of harness logic should be removable when the model no longer needs
it. Infrastructure should simplify as models improve, not grow more complex.

**For Project Tracks**: Avoid building clever orchestration that bakes in
current model limitations. Prefer declarative constraints over procedural
workarounds.

### 2.4 Every Mistake Becomes a Guardrail

> "Anytime you find an agent makes a mistake, you take the time to engineer a
> solution such that the agent never makes that mistake again."
> — Mitchell Hashimoto

**For Project Tracks**: Agent failures are not bugs to fix and forget. They are
signals that the harness is incomplete. Every failure produces one of: a linter
rule, a documentation update, a structural test, or a constraint enforcement.

### 2.5 Progressive Complexity

Creating a project track with a single terminal session should take seconds.
The harness should be invisible to simple operations and only assert itself
when complexity demands it.

---

## 3. Project Structure Philosophy

### 3.1 Layered Architecture with Forward-Only Dependencies

The codebase is organized in strict layers. Dependencies flow in **one
direction only** — from outer layers inward. No layer may import from a layer
above it. Cross-cutting concerns (auth, telemetry, logging) enter through
explicit **Providers**, never through direct imports.

```
┌─────────────────────────────────────────────┐
│  UI / Presentation                          │  ← Outermost
│  (views, components, layouts)               │
├─────────────────────────────────────────────┤
│  Application / Orchestration                │
│  (use cases, workflows, automation rules)   │
├─────────────────────────────────────────────┤
│  Domain                                     │
│  (tracks, sessions, issues, summaries)     │
├─────────────────────────────────────────────┤
│  Infrastructure / Adapters                  │
│  (persistence, git, MCP, terminal mgmt)     │
├─────────────────────────────────────────────┤
│  Foundation                                 │  ← Innermost
│  (shared types, utilities, config)          │
└─────────────────────────────────────────────┘
```

**Enforcement**: A custom linter or structural test validates that no file in a
lower layer imports from a higher layer. This is not optional — it is the
primary architectural constraint.

### 3.2 Directory Layout

```
workshop/
├── AGENTS.md                    # Agent instruction file (~100 lines, map to deeper docs)
├── CLAUDE.md                    # Claude-specific conventions and overrides
├── docs/
│   ├── architecture/
│   │   ├── layers.md            # Layer definitions and dependency rules
│   │   ├── domain-model.md      # Entity definitions and relationships
│   │   ├── decisions/           # Architecture Decision Records (ADRs)
│   │   │   └── NNN-title.md
│   │   └── pitfalls.md          # Known agent failure modes and solutions
│   ├── conventions/
│   │   ├── naming.md            # Naming conventions for all artifacts
│   │   ├── file-structure.md    # Where new files go and why
│   │   └── testing.md           # Testing strategy and patterns
│   └── integrations/
│       ├── git.md               # Git integration patterns
│       ├── mcp.md               # MCP integration patterns
│       └── terminal.md          # Terminal/session management patterns
├── src/
│   ├── foundation/              # Shared types, config, utilities
│   ├── domain/                  # Business entities and logic
│   │   ├── track/               # Project Track aggregate
│   │   ├── session/             # Terminal Session aggregate
│   │   ├── issue/              # External Issue Link aggregate
│   │   ├── summary/             # Project Summary aggregate
│   │   └── automation/          # Automation rule aggregate
│   ├── infrastructure/          # Adapters for external systems
│   │   ├── persistence/         # Database/file storage
│   │   ├── git/                 # Git operations
│   │   ├── mcp/                 # MCP integration layer
│   │   │   ├── atlassian/       # Jira/Confluence via Atlassian MCP
│   │   │   ├── linear/          # Linear MCP
│   │   │   ├── glean/           # Glean MCP (GDrive, Slack, Confluence search)
│   │   │   └── registry.ts      # MCP server registry and capability map
│   │   ├── context-cache/       # Local cache of MCP-sourced context per track
│   │   └── terminal/            # Terminal/process management
│   ├── application/             # Use cases, orchestration
│   │   ├── track-management/
│   │   ├── session-lifecycle/
│   │   ├── issue-sync/
│   │   ├── summary-generation/
│   │   └── automation-engine/
│   └── ui/                      # Presentation layer
│       ├── dashboard/
│       ├── track-view/
│       ├── terminal-panel/
│       └── settings/
├── tests/
│   ├── structural/              # Architecture constraint tests
│   ├── domain/                  # Domain logic unit tests
│   ├── integration/             # Cross-layer integration tests
│   └── e2e/                     # End-to-end browser tests
├── scripts/
│   ├── init.sh                  # Environment setup (agents run this first)
│   ├── validate-architecture.sh # Run structural constraint checks
│   └── lint-custom/             # Custom linter rules
├── feature_list.json            # Structured requirements with pass/fail
└── claude-progress.txt          # Cross-session agent state
```

### 3.3 Bounded Contexts as Directories

Each domain concept from the product spec maps to a **bounded context** with
its own directory under `src/domain/`. A bounded context owns its:

- Entity definitions
- Value objects
- Repository interface (not implementation)
- Domain events
- Validation rules

The five core bounded contexts are:

| Context        | Primary Entity   | Key Relationships                       |
|----------------|------------------|-----------------------------------------|
| `track`        | ProjectTrack     | owns sessions, links issues, has summary |
| `session`      | TerminalSession  | belongs to track, wraps Claude instance |
| `issue`       | ExternalIssue   | many-to-many with tracks                |
| `summary`      | ProjectSummary   | belongs to track, versioned             |
| `automation`   | AutomationRule   | belongs to track, triggers actions      |

### 3.4 File Size and Scope Limits

- **Max file length**: 300 lines. If a file exceeds this, it is a signal to
  split it. Agents produce better output with focused, small files.
- **Max function length**: 50 lines. Extract helpers rather than nesting logic.
- **One export per file for domain entities**. Utility modules may export
  multiple items.
- **No barrel files / re-export indices**. Every import traces directly to its
  source file. This eliminates circular dependency confusion for agents.

---

## 4. Context Engineering

### 4.1 AGENTS.md — The Entry Point

AGENTS.md is the **first file every agent reads**. It is deliberately short
(~100 lines) and serves as a **map**, not an encyclopedia. It contains:

1. **Build & run commands** — How to start, test, and validate the project
2. **Architecture overview** — Layer diagram and dependency rules (3-5 lines)
3. **Pointers** — Links to deeper docs (`docs/architecture/layers.md`, etc.)
4. **Active constraints** — The current set of linter rules and why they exist
5. **Recent pitfalls** — Last 5-10 agent failures and their fixes

AGENTS.md is **living infrastructure**. It is updated after every significant
agent failure. Stale entries are pruned regularly.

### 4.2 Structured Knowledge Base

The `docs/` directory is treated as **design work**, not documentation debt.
Each file in `docs/` has a clear audience (agents and humans) and a clear
purpose (prevent a class of mistakes).

Key properties:
- **Architecture Decision Records** (ADRs) capture the *why* behind
  decisions, not just the *what*. Agents that understand *why* make better
  judgment calls.
- **`pitfalls.md`** is the highest-value document in the repo. Every entry
  corresponds to a real agent failure. Format: `## Problem → Context → Fix →
  Prevention`.
- **Convention docs** are prescriptive, not descriptive. They say "do X" not
  "we tend to do X".

### 4.3 MCP as a First-Class Context Source

Unlike typical harness-engineered projects where the repo contains all relevant
knowledge, Project Tracks is a **context aggregation product**. Agents working
on this codebase — and agents *managed by* this product — need access to
external knowledge systems.

**Available MCP Context Sources**:

| MCP Server   | What It Provides | Use Case |
|-------------|-----------------|----------|
| Glean       | Search across GDrive, Slack, Confluence, email | Domain understanding, prior art, decisions made in conversations |
| Atlassian   | Jira issues, Confluence pages | Requirements, acceptance criteria, related work |
| Linear      | Linear issues and projects | Alternative issue source |
| Gmail       | Email threads | Stakeholder communication context |
| Google Calendar | Meeting context | Timeline and scheduling awareness |

**Context Sourcing Rules**:

1. **Agents should actively pull context** — When working on a feature that
   relates to an external system or business process, query relevant MCPs
   before designing the solution. Don't guess at requirements when Jira has
   the acceptance criteria.

2. **Cache what you consume** — External context that influences implementation
   should be cached locally in `infrastructure/context-cache/` per-track. This
   provides offline access and creates an audit trail of what informed a
   decision.

3. **Cite your sources** — When an implementation decision is based on
   information from an MCP (a Slack thread, a Confluence doc, a Jira issue),
   reference it in the commit message or ADR. This makes decisions traceable.

4. **Don't replicate what MCPs provide** — If Glean can search Confluence, don't
   copy Confluence content into `docs/`. Reference it. The exception is
   architectural decisions and conventions — those live in the repo because
   they must be available without network access.

5. **MCP access is scoped per track** — Different project tracks may need
   different MCP contexts. The track configuration determines which MCPs are
   available and what search scope they use (e.g., specific Jira projects,
   specific Slack channels).

### 4.4 Custom Linter Error Messages as Teaching

Custom linter rules include **remediation instructions in their error
messages**. When an agent violates a rule, the error message tells it exactly
how to fix the violation. This turns linting from a blocker into a feedback
channel.

Example:
```
ERROR: File src/ui/dashboard/index.ts imports from src/domain/track/repo.ts
  → UI layer cannot import directly from Domain layer.
  → Use the Application layer to mediate.
  → See docs/architecture/layers.md for the dependency graph.
```

---

## 5. Architectural Constraints (Enforcement)

### 5.1 Structural Tests

A dedicated test suite under `tests/structural/` validates architectural
invariants. These tests run in CI and as pre-commit hooks. They are
**deterministic** — no LLM involvement.

Invariants to enforce:

| Constraint | What It Prevents |
|------------|-----------------|
| Layer dependency direction | UI importing domain internals |
| No circular imports | Tangled dependency graphs |
| File size limits | Monolithic files agents can't reason about |
| Naming conventions | Inconsistent entity names across boundaries |
| Domain purity | Infrastructure leaking into domain logic |
| Export discipline | Barrel files and re-export chains |

### 5.2 Pre-Commit Hooks

Every commit passes through:

1. **Formatter** — Consistent style without agent decision overhead
2. **Linter (standard)** — Language-level correctness
3. **Linter (custom)** — Architectural constraint enforcement
4. **Structural tests** — Layer and dependency validation
5. **Affected unit tests** — Tests related to changed files

If a hook fails, the agent sees the error, fixes it, and commits again. The
hook failure message is the teaching moment.

### 5.3 Taste Invariants

Beyond mechanical enforcement, certain patterns are documented as "taste
invariants" — they may not be lintable but are enforced in code review:

- **Structured logging only** — No freeform log strings
- **Explicit error types** — No generic error throws
- **No magic strings** — Constants or enums for all repeated values
- **No deep nesting** — Early returns over nested conditionals
- **Single responsibility** — One reason to change per module

---

## 6. State Management and Session Continuity

### 6.1 Feature List (feature_list.json)

A structured JSON file listing every feature from the product spec, broken into
testable units. Each entry has:

```json
{
  "id": "TRACK-001",
  "category": "track-management",
  "description": "Create a new project track with name and description",
  "verification_steps": [
    "Navigate to dashboard",
    "Click 'New Track'",
    "Enter name and description",
    "Verify track appears in dashboard list"
  ],
  "status": "failing",
  "last_verified": null
}
```

This file is the **objective truth** about what works and what doesn't. Agents
may not mark a feature as `passing` without running verification steps. The
file is append-only for requirements (new entries), and status updates require
test evidence.

### 6.2 Progress Tracking (claude-progress.txt)

A plain-text log that agents update at the end of each session:

```
## Session 2026-03-10 14:30
- Implemented track creation flow (TRACK-001)
- Added persistence layer for tracks using [storage choice]
- Blocked: terminal session management needs init.sh update
- Next: implement session lifecycle (SESSION-001 through SESSION-004)
```

This enables context recovery across sessions without verbose re-prompting. The
file is **append-only** — agents never delete previous entries.

### 6.3 Git as State Backbone

- **Commit after each completed feature** — Descriptive messages referencing
  feature IDs
- **Working state on every commit** — The application must start and pass all
  existing tests at every commit point
- **Revert-friendly history** — If a feature breaks, reverting to the previous
  commit should restore a working state

---

## 7. Agent Operating Protocol

### 7.1 Session Startup Sequence

Every agent session begins with:

1. Verify working directory (`pwd`)
2. Read `AGENTS.md` (automatic for most agent tools)
3. Read `claude-progress.txt` — understand what happened before
4. Read `feature_list.json` — understand what's done and what's next
5. Run `scripts/init.sh` — set up environment, start services
6. Run existing tests — confirm baseline is green
7. Select next incomplete feature from `feature_list.json`

### 7.2 Feature Implementation Loop

```
┌─────────────────────────┐
│ Select next feature     │
├─────────────────────────┤
│ Read relevant docs/     │
│ conventions first       │
├─────────────────────────┤
│ Implement in small,     │
│ committable increments  │
├─────────────────────────┤
│ Run tests after each    │
│ increment               │
├─────────────────────────┤
│ Run structural tests    │
├─────────────────────────┤
│ Run e2e verification    │
│ for the feature         │
├─────────────────────────┤
│ Update feature_list.json│
│ with passing status     │
├─────────────────────────┤
│ Commit with feature ID  │
├─────────────────────────┤
│ Update progress file    │
└─────────────────┬───────┘
                  │
                  ▼
          Next feature or
          session handoff
```

### 7.3 Session Shutdown Sequence

Before ending a session, the agent must:

1. Ensure all tests pass
2. Commit any uncommitted work (or stash with notes)
3. Update `claude-progress.txt` with session summary
4. Update `feature_list.json` if any feature statuses changed
5. Note any blockers or decisions needed from a human

---

## 8. Domain-Specific Harness Concerns

### 8.1 Terminal Session Management

This product **manages AI agent sessions as a core feature**. This creates a
recursive concern: agents building the system that manages agents. The harness
must account for this:

- Terminal session lifecycle code is **the most critical domain boundary**.
  Changes require both unit and integration tests.
- Process management (spawn, kill, reattach) is isolated in
  `infrastructure/terminal/` — never in domain or application layers.
- Session state persistence is tested with explicit failure scenarios (server
  crash, browser disconnect, process death).

### 8.2 MCP Integration — The Context Backbone

MCP is not just an adapter layer for this product — it is the **primary
mechanism for connecting project tracks to the outside world**. The product
serves two distinct MCP roles:

**Role 1: Build-time MCPs (agents building this product)**
Agents developing Project Tracks use MCPs to pull in requirements, design
context, and domain knowledge. These are used during development sessions.

**Role 2: Runtime MCPs (the product itself consuming MCPs)**
The running product uses MCPs to sync issue state, pull context for summaries,
and feed information into managed Claude sessions. These are a core feature.

**Architecture for both roles**:

- All MCP adapters live in `infrastructure/mcp/`, organized by server
- Each adapter exposes a **domain-friendly interface** — translating raw MCP
  responses into domain types (e.g., a Jira response becomes a `IssueSnapshot`)
- A **registry** (`infrastructure/mcp/registry`) tracks available MCP servers,
  their capabilities, and connection config
- **Response caching** with explicit TTL in `infrastructure/context-cache/` —
  per-track isolation so different tracks don't pollute each other's context
- **Graceful degradation** — MCP unavailability must never block core
  operations. Issue sync fails? Show last cached state. Glean down? The track
  still works, just without search.

**MCP-specific constraints**:

- MCP calls are **never made from the domain layer**. The application layer
  orchestrates MCP access through infrastructure adapters.
- Search results from Glean/Atlassian are **summarized before caching** — raw
  results are too verbose and expire quickly. Store the extracted insight, not
  the full response.
- MCP credentials and connection config are **never stored in code or
  context windows**. They are injected at the harness/infrastructure level.

### 8.3 Automation Engine

The event-driven automation system is a separate bounded context because:

- It has its own lifecycle (rules can be created, modified, triggered, disabled)
- It orchestrates across other contexts (triggers summary regen, spawns agents)
- It needs its own testing strategy (event simulation, timing, idempotency)

Automation rules are stored as data, not code. The engine interprets rule
definitions at runtime. This prevents agents from generating bespoke
automation logic that drifts from the declared patterns.

---

## 9. Testing Strategy

### 9.1 Test Pyramid

```
         ╱╲
        ╱ E2E ╲         Few, slow, high-confidence
       ╱────────╲        (browser-based verification)
      ╱Integration╲     Medium, cross-layer
     ╱──────────────╲    (application + infrastructure)
    ╱   Domain Unit   ╲  Many, fast, focused
   ╱────────────────────╲ (pure domain logic)
  ╱  Structural / Arch   ╲ Always green, fast
 ╱────────────────────────╲ (constraint verification)
```

### 9.2 Testing Principles

- **Domain tests are pure** — No I/O, no external dependencies. Repository
  interfaces are stubbed.
- **Integration tests use real adapters** — But against local/test instances
  only.
- **E2E tests verify user flows** — Tied to `feature_list.json` verification
  steps.
- **Structural tests are mandatory** — They enforce the harness itself. A
  failing structural test means the architecture is violated.

### 9.3 Agent-Specific Testing Rule

Agents must **never mark a feature as passing based on reading code alone**.
The verification must involve running the application and observing behavior.
This is the single most important testing rule for agent-maintained code.

---

## 10. Entropy Management

### 10.1 The Entropy Problem

Agent-generated code accumulates cruft differently than human code. Common
drift patterns:

- Unused imports and dead code accumulate faster
- Naming conventions diverge across sessions
- Abstraction layers get bypassed when agents find shortcuts
- Documentation falls behind implementation

### 10.2 Entropy Countermeasures

| Countermeasure | Frequency | Mechanism |
|----------------|-----------|-----------|
| Formatter on save | Every edit | Automated |
| Linter on commit | Every commit | Pre-commit hook |
| Structural tests | Every commit | Pre-commit hook |
| Dead code detection | Weekly | Scheduled agent run |
| Documentation sync | Per feature | Agent protocol step |
| Full constraint audit | Monthly | Dedicated agent session |

### 10.3 Garbage Collection Runs

Periodically, a dedicated agent session is run with the sole purpose of:

1. Finding dead code and removing it
2. Identifying naming inconsistencies
3. Verifying all `docs/` files match current implementation
4. Updating `pitfalls.md` based on recent failures
5. Pruning stale entries from `AGENTS.md`

This is not optional maintenance — it is a scheduled harness activity.

---

## 11. Human-Agent Collaboration Model

### 11.1 What Humans Own

- **Architecture decisions** — Humans approve ADRs. Agents may propose them.
- **Constraint definitions** — Humans define what the linter enforces. Agents
  comply.
- **Feature prioritization** — Humans order `feature_list.json`. Agents work
  top-down.
- **Taste review** — Humans review for patterns that can't be linted.
- **External integration decisions** — Humans choose which MCP servers, which
  issue systems.

### 11.2 What Agents Own

- **Implementation within constraints** — Given a feature and the harness,
  agents write the code.
- **Test writing** — Agents write tests alongside implementation.
- **Documentation updates** — Agents update docs when implementation changes.
- **Progress tracking** — Agents maintain `claude-progress.txt` and
  `feature_list.json`.
- **Self-correction** — When a linter or test fails, agents fix it without
  human intervention.

### 11.3 The Planning Gate

Agents never begin implementation without an approved plan. For non-trivial
features:

1. Agent reads the feature spec and relevant docs
2. Agent proposes an implementation plan (which files change, which tests are
   needed)
3. Human reviews and approves (or adjusts) the plan
4. Agent implements the approved plan
5. Human reviews the result

This mirrors the "AI manager's schedule" pattern: extensive planning before
execution, review-focused work afterward.

---

## 12. What This Harness Does NOT Define

- **Tech stack** — Language, framework, database, and runtime choices are
  deferred. The harness is structural, not technological.
- **Deployment** — CI/CD, hosting, and infrastructure are out of scope for v1
  (local-first product).
- **Multi-agent orchestration** — v1 uses single-agent sessions. Parallel
  agent coordination is a future concern.
- **Model choice** — The harness is model-agnostic. It works with any agent
  that reads files and follows instructions.

---

## 13. Success Criteria

The harness is working when:

1. A new agent session can pick up where the last one left off in < 2 minutes
2. Architectural violations are caught before code is committed
3. No feature is marked complete without running verification
4. Agent failures produce harness improvements, not just code fixes
5. The `docs/` directory accurately reflects the current implementation
6. A human can review agent output at the architectural level, not line-by-line
7. The codebase can survive an agent session that goes off-track (revert to
   last good commit and try again)

---

*Harness definition path: `HARNESS.md`*

Sources:
- [Harness Engineering (Martin Fowler / Birgitta Böckeler)](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html)
- [The Emerging Harness Engineering Playbook (Ignorance.ai)](https://www.ignorance.ai/p/the-emerging-harness-engineering)
- [Harness Engineering: Leveraging Codex (OpenAI)](https://openai.com/index/harness-engineering/)
- [Effective Harnesses for Long-Running Agents (Anthropic)](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [The Importance of Agent Harness in 2026 (Philipp Schmid)](https://www.philschmid.de/agent-harness-2026)
- [The Agent Harness Is the Architecture (DEV Community)](https://dev.to/epappas/the-agent-harness-is-the-architecture-and-your-model-is-not-the-bottleneck-3bjd)
- [Mitchell Hashimoto — My AI Adoption Journey](https://mitchellh.com/writing/my-ai-adoption-journey)
