---
name: orchestrate
description: "Standard orchestrator flow for working a Workshop ticket: plan, execute via cheaper subagents, self-review, then offer a PR. Invoke at the start of any dispatched Workshop task before doing anything else. Tagged: workshop."
---

# /orchestrate — Standard ticket flow

You are the orchestrator for this task. You run on the expensive model; delegated work runs on cheaper models. Your value is judgment — reading, deciding, reviewing — not typing. Every Agent (Task) tool call you make MUST pass `model: sonnet` (or `haiku` for pure search) unless the agent's own definition already pins a model.

Work the task in four phases.

## Phase 0 — Triage

Read the task and trace the affected code before anything else. If the change is trivially small — a single-file fix, a doc edit, a config tweak — skip orchestration: make the change yourself, then jump straight to Phase 3. Spawning subagents for a one-liner costs more than it saves.

## Phase 1 — Plan

- Spawn `Explore` subagent(s) (`model: sonnet`) to map the affected code. Independent areas → parallel Explore calls in one message.
- Write a concrete plan: files to change, approach, test strategy, verification steps. Keep it in-conversation; use a scratch file only if it outgrows a message.
- Sanity-check the plan against the code-discipline ladder: does an existing helper, pattern, or platform feature shrink it?

## Phase 2 — Execute

- Split the plan into independent work units. Delegate each to the best-matching implementation agent (project/global agents first, `general-purpose` with `model: sonnet` otherwise). Give every subagent FULL context in its prompt: the relevant plan section, exact file paths, repo conventions, constraints. Subagents see nothing you don't paste.
- Independent units → parallel subagents in a single message.
- Review each subagent's diff as it lands. Small glue edits and corrections: do them yourself. Substantial rework: send it back to a subagent with specific feedback rather than rewriting by hand.

## Phase 3 — Self-review

- Run the project's checks — typecheck, tests, build, whatever the repo's CLAUDE.md names.
- Spawn a fresh-context review subagent (`model: sonnet`) on the full diff (`git diff main...HEAD` or the working tree): one pass for correctness, one for over-engineering. Fresh context is the point — it hasn't seen your plan's assumptions.
- Apply accepted findings (delegate big ones, hand-fix small ones), then re-run the checks.

## Phase 4 — Offer PR

- Invoke the `submit-for-review` skill: commit, branch, push, open the PR, link it to the todo, and move the todo to review. Repo-specific PR rules (draft vs non-draft) come from your session context — follow them.
- Close with a short summary: what was built, what was deliberately skipped, and what the reviewer should look at first.
