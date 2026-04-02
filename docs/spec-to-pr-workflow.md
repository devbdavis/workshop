# Spec-to-PR Workflow

A structured workflow for taking a raw idea or Linear ticket through spec, review, execution, and a draft PR — without committing spec artifacts to the target repo.

---

## Overview

```
idea → triaging → spec-drafting → spec-review → planning → plan-review → executing → integration-review → final-review → approved → merged
```

Human gates at **spec-review**, **plan-review**, and **final-review**. Everything else is agent-driven.

---

## Stage Reference

| Stage | Role | Type | Description |
|---|---|---|---|
| `idea` | — | entry | Epic created, auto-advances |
| `triaging` | `spec-to-pr-triage` | processing | Reads idea + constitution + vault decisions; identifies gaps |
| `needs-input` | — | human-gate | Triage found blockers; agent posts questions to discussion |
| `spec-drafting` | `spec-to-pr-spec-writer` | processing | Writes spec to `~/.workshop/specs/<repo>/` |
| `spec-review` | — | human-gate | You read the spec, approve or send back |
| `planning` | `spec-to-pr-planner` | processing | Reads spec, creates Workshop tasks |
| `plan-review` | — | human-gate | You approve the task breakdown |
| `executing` | — | waiting | Tasks run in parallel worktrees |
| `integration-review` | `spec-to-pr-integrator` | processing | Verifies tasks, runs checks, opens draft PR |
| `integration-fix` | `spec-to-pr-integrator` | processing | Fixes issues found in integration review |
| `execution-failed` | — | human-gate | An executor failed; you decide to retry or cancel |
| `final-review` | — | human-gate | You review the draft PR, approve or send back for fixes |
| `approved` | — | processing | Auto-advances to merged |
| `merged` | — | terminal | Done |
| `cancelled` | — | terminal | Cancelled at any point |

---

## Spec Storage (No Repo Pollution)

Specs never touch the target repo's working tree. All artifacts live in:

```
~/.workshop/specs/
  <repo-name>/
    constitution.md          # Repo-level: architecture, patterns, decisions, tech stack
    <epic-id>/
      spec.md                # The spec document
      plan.md                # Task breakdown (written by planner agent)
      questions.md           # Clarifying questions log
```

The **constitution** is the persistent context for a repo. It's written once and maintained over time. Each **epic** gets its own subdirectory so specs are isolated and traceable.

---

## Spec Document Structure

Each `spec.md` follows a spec-kit-inspired format:

```markdown
# <Title>

## Status
Draft | In Review | Approved

## Problem
What problem are we solving and why does it matter?

## Proposed Solution
High-level description of the approach.

## Detailed Design
Implementation specifics, API changes, data model changes, etc.

## Out of Scope
What this spec explicitly does not cover.

## Alternatives Considered
Other approaches evaluated and why they were rejected.

## Open Questions
Unresolved questions requiring human input.

## Acceptance Criteria
Specific, testable conditions that define "done".

## References
Links to Linear tickets, prior decisions, related specs.
```

---

## Agent Roles

### `spec-to-pr-triage`
**Runs at**: `triaging`

1. Read the epic description (idea / Linear ticket text)
2. Read `~/.workshop/specs/<repo>/constitution.md` if it exists
3. Read `decisions.md` and `learnings.md` from the track vault
4. Identify: missing context, ambiguous scope, conflicts with existing decisions
5. If blockers exist → transition to `needs-input`, post questions to discussion thread
6. If clear enough → transition to `spec-drafting` with a triage summary

### `spec-to-pr-spec-writer`
**Runs at**: `spec-drafting`

1. Read triage summary
2. Read constitution + vault decisions
3. Write spec to `~/.workshop/specs/<repo>/<epic-id>/spec.md` using the structure above
4. If open questions remain, also write them to `questions.md`
5. Transition to `spec-review`

### `spec-to-pr-planner`
**Runs at**: `planning`

1. Read approved spec from `~/.workshop/specs/<repo>/<epic-id>/spec.md`
2. Create Workshop tasks via `workshop_create_task` for each acceptance criterion
3. Set task dependencies where ordering matters
4. Write task breakdown to `~/.workshop/specs/<repo>/<epic-id>/plan.md`
5. Transition to `plan-review`

### `spec-to-pr-executor`
**Runs at**: `in-progress` (task level)

1. Read the task description and linked spec
2. Execute in a worktree (never on main branch)
3. Run typecheck, tests, and build before marking complete
4. Transition to `done` or `failed`

### `spec-to-pr-integrator`
**Runs at**: `integration-review` and `integration-fix`

1. Verify all tasks completed and tests pass
2. Run the `/complete` skill to commit and open a draft PR
3. Append learnings to `learnings.md` in the track vault
4. Update `constitution.md` if meaningful architectural decisions were made
5. Transition to `final-review` (if clean) or `integration-fix` (if issues)

---

## Setting Up a New Repo

### Step 1: Create the scratch directory

```bash
mkdir -p ~/.workshop/specs/<repo-name>
```

### Step 2: Write the constitution

Create `~/.workshop/specs/<repo-name>/constitution.md`:

```markdown
# <Repo Name> — Constitution

## What This Repo Is
Brief description of the repo's purpose and scope.

## Tech Stack
- Language/runtime versions
- Key frameworks and libraries
- Database / persistence layer
- External services

## Architecture Overview
High-level structure, key directories, layering rules.

## Coding Conventions
- Style guide or formatter in use
- Naming conventions
- File length limits
- Import style (ESM vs CJS, etc.)

## Key Decisions
Architecture decisions that future specs must respect.
Example: "All persistence goes through the repository pattern. No direct DB access from application layer."

## Patterns to Follow
Common patterns used in this codebase with brief examples or file pointers.

## What to Avoid
Anti-patterns, deprecated approaches, or things that were tried and abandoned.

## Test Strategy
What gets unit tested vs integration tested. Test file conventions.

## How to Run Locally
Quick-start for an agent picking up a task cold.
```

The more complete this file, the better the triage and spec-writing agents perform. Think of it as onboarding documentation for an AI starting a task in this repo.

### Step 3: Start an epic

In Workshop, create a new epic in a track associated with the repo. The playbook will be auto-matched if you have `spec-to-pr` in the tags or apply it manually.

---

## Using spec-kit (Optional)

If you want to use spec-kit's CLI to generate initial spec scaffolding, run it in an isolated worktree so it never touches your real branch:

```bash
# Create a throwaway worktree
git -C <repo-path> worktree add /tmp/speckit-scratch-<epic-id> HEAD

# Run spec-kit in the scratch worktree
cd /tmp/speckit-scratch-<epic-id>
npx @github/spec-kit init

# Copy the generated spec to the workshop scratch space
cp .github/specs/*.md ~/.workshop/specs/<repo-name>/<epic-id>/

# Clean up
git -C <repo-path> worktree remove /tmp/speckit-scratch-<epic-id>
```

The spec-to-pr-spec-writer agent can be instructed to do this automatically if spec-kit is available in the environment.

---

## Tips

- **Constitution first**: Before running your first epic in a repo, spend 15 minutes writing the constitution. It's the highest-leverage investment — every future triage and spec benefits from it.
- **Spec review is the checkpoint**: The `spec-review` gate is where you catch scope creep and wrong approaches cheaply. Push back freely here.
- **Learnings compound**: After each epic, the integrator appends to `learnings.md`. Over time the vault becomes the memory that keeps agents from repeating mistakes.
- **One epic per significant feature**: Don't batch unrelated work into one epic. The spec should be cohesive enough to fit on one page.
