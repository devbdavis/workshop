---
name: roar-egm
description: >-
  Point at one deployment_tools service and get back a reviewed, execution-ready
  ROAR remediation plan. Chains /roar-audit-service (findings), an EGM concepts
  brief built from those findings, /egm-draft (design + detailed implementation),
  and /egm-review in consolidated mode with egm-resolve fixes. Use when the user
  says "roar-egm SERVICE", "EGM plan for SERVICE", "ROAR plan for SERVICE",
  or "audit SERVICE and plan the fixes". Do NOT use to execute the plan, or for
  a bare audit (use /roar-audit-service). Tagged: workshop.
---

# ROAR → EGM Plan

One command: `/roar-egm <service> [interactive]`. Output is a design doc whose
Detailed Implementation section is one work unit per audit finding, in rank
order, each sized as one remediation PR, reviewed by the EGM Goldfish pipeline.

## Setup

1. **Repo**: work from the `deployment_tools` checkout (the current repo if its
   root has `docs/platform/syseng/roar/`, otherwise `~/projects/deployment_tools`).
   If neither exists, stop and ask for the path.
2. **EGM plugin root** (`EGM`): the newest `~/.claude/plugins/cache/egm/egm/*/`.
   Read `$EGM/docs/claude.md` first. EGM skills set `disable-model-invocation`,
   so the Skill tool refuses them: read each `$EGM/skills/<skill>/SKILL.md` and
   follow it in this thread. Wherever it says `${CLAUDE_PLUGIN_ROOT}`, use `EGM`.
3. **Artifact dir** (`OUT`): `roar-egm/<service>/` under the repo root, unless
   `CLAUDE.md`/`AGENTS.md` names an `EGM artifact directory`. Every artifact
   below goes there; never dump them in chat.
4. **Mode**: default is **autopilot**. `interactive` keeps every EGM gate as
   written.

## Autopilot gate policy

EGM's gates exist so an owner decides what only an owner can. Autopilot keeps
those and skips the rest:

- **Keep**: egm-draft's *Owner Decides Architecture* gates (more than one
  defensible answer), egm-draft Step 6.1 brief/draft contradictions, egm-resolve
  `CONTEST` verdicts, and ROAR's "service not found" / ambiguity questions.
  Batch pending owner decisions into one gate where the skill allows it.
- **Auto-approve**: egm-draft section approval gates, Step 1 consensus, Step 6.2
  save-location gate (save to `OUT`), egm-review intake prompts (pass the inputs
  below), and the preset gate (`uninterrupted`).

## Steps

### 1. Audit

Run `/roar-audit-service <service>` (Skill tool if listed; otherwise follow
`<repo>/.claude/skills/roar-audit-service/SKILL.md`). Write its full report to
`OUT/roar_audit.md`. It is read-only; keep it that way.

- **No findings**: stop. Report the clean/uncertain sections and the doc gaps;
  there is nothing to plan.
- **Uncertain verdicts**: they do not become work units. Carry them as open
  questions in the brief.

### 2. Brief (replaces /egm-brainstorm)

The audit already did the requirements work, so skip egm-brainstorm and write
`OUT/concepts_brief.md` in the structure egm-draft ingests (see
`$EGM/skills/egm-brainstorm/SKILL.md`, Step 2):

- **Overview**: the service, its cluster footprint per status, and the toil the
  findings represent.
- **Analysis**: each finding in rank order, with practice link, `path:line`
  evidence, scope, and verification owed, copied from the audit.
- **Goals vs. Non-Goals**: goal per finding = the practice's end state with a
  no-op render. Non-goals: uncertain verdicts, doc gaps, any behaviour change.
- **Alternatives Weighed**: "leave the hand-maintained form in place" per
  finding, plus any alternative the practice page itself rejects. Do not invent
  others.
- **Key Decisions & Staging**: one remediation PR per finding in rank order;
  each PR is a draft requesting `grafana/platform-syseng` (per the audit skill);
  each proves its practice page's verification (usually the no-op render diff).

### 3. Draft

Follow `$EGM/skills/egm-draft/SKILL.md` with `Context File = OUT/concepts_brief.md`,
writing `OUT/design_draft.md`. Read the cited practice pages and reference PRs
before Step 3; the Technical Plan follows them, not a fresh design.

The Step 5 Detailed Implementation must be executable without further
decisions: one subsection per finding, each listing every file touched with
rationale, the exact verification commands, and the PR title/reviewer. Save the
final doc (Step 6) to `OUT/<service>-roar-plan.md`.

### 4. Review and resolve

Follow `$EGM/skills/egm-review/SKILL.md` with:

- `TargetFile` = `OUT/<service>-roar-plan.md`
- `GoldfishContext` = `OUT/roar_audit.md`, `docs/platform/syseng/roar/README.md`,
  each cited practice page, the service's env/lib dirs from the audit footprint
- `Step` = `uninterrupted` (`interactive` mode: omit it)

Then follow `$EGM/skills/egm-resolve/SKILL.md` with `LineRange = full file`
and `FindingsList` = the Blocker and Major items in
`consolidated_review_report.md`: apply `PROPOSE FIX` items, put `CONTEST` items
to the owner. Re-run Stage 9 (Implementation Readiness) once on
`DetailedRange` if any fix touched it; do not loop further.

### 5. Hand off

Reply with a short summary only: plan path, number of work units, first PR to
open, open owner decisions, and the review report path. Offer to start executing
work unit 1; do not start it unprompted.

## Verification

Before handing off, check:

- Every work unit maps to exactly one audit finding, and every finding has one.
- Every file in Detailed Implementation was cited by the audit or a practice
  page, or is justified in its rationale.
- Cluster counts in the plan match `OUT/roar_audit.md`.
- No file outside `OUT` changed.
