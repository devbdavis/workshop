# Dark Factory — Plan & Options

*Autonomous "just go, iterate" operation for Workshop, without losing the human-in-the-loop workflow we have today.*

Status: **implemented** (Option A). Research by haiku/sonnet subagents; reviewed by a fable subagent. See `docs/dark-factory-user-guide.md` for the click-by-click usage guide.

> ⚠️ Safety note: autonomous runs set `dangerouslySkipPermissions` on their agent sessions (that is the "just go" behavior). The merge gate is never auto-approved, and a budget cap + circuit breaker escalate stuck runs — but before real use, run dark tracks in **worktree isolation** so the blast radius is contained. A granular irreversible-action denylist (force-push, out-of-worktree writes) is a recommended follow-up.

---

## TL;DR

A "Dark Factory" (lights-out manufacturing) is a production line that runs unattended: automated quality gates enforce pass/fail, humans are pulled in **only on exceptions**, and humans own **requirements in** and **validation out** — not the work in between.

**The key finding: we have already built the dark factory. We just haven't turned the lights off.**

Workshop's WorkflowTicket engine is a data-driven finite-state machine where each stage carries a `humanGate: boolean` flag. It already has a circuit breaker, auto-transitions, worktree isolation, and a `dangerouslySkipPermissions` switch. "Dark Factory" is **not a new mode** — it's a *playbook variant with gates auto-approved, plus a couple of templates*. Your instinct ("beef up the workflow thing with `new web app` / `new mobile app` templates") is the correct architecture, not a shortcut around it.

What's actually missing is small and honest:
1. Let the dispatcher **auto-advance through `humanGate` stages** for a flagged ticket (except merge — never merge).
2. **Wire `dangerouslySkipPermissions`** into workflow-ticket agent sessions (parity — todo dispatch and scheduled tasks already do this).
3. **2–3 stored playbook templates** with pre-filled prompts and a demanding intake questionnaire.
4. **A "shift report"** so you come back to a tidy desk instead of a pile of transcripts.

Everything else is defer or cut.

---

## What we already have (so the plan is grounded)

| Capability | Where it lives | Relevance |
|---|---|---|
| Playbook FSM (stage graph as data) | `src/application/workflow/engine.ts`, `src/domain/workflow/schemas.ts` | The dark factory line already exists |
| Per-stage `humanGate: boolean` | `StageDefinitionSchema` | This **is** the autonomy dial — per stage, as data |
| Auto-transitions (`trigger:'auto'`, depth-capped 10) | `engine.ts` | Stages can already advance without a human |
| Circuit breaker (3 same-state iterations → escalate) | `engine.ts:106–197` | Runaway-loop safety already built |
| `dangerouslySkipPermissions` per session | `src/domain/terminal/manager.ts:48` | "No confirmation" switch — used by scheduled tasks, **not** yet by workflow agents |
| Worktree isolation | `worktreeMode` (Track/Session) | Blast-radius containment for parallel autonomous runs |
| Always-draft PR, `/done` is manual-only | `submit-for-review`, `skills/done` | Our best existing safety property — merge is always human |
| Automation rules + scheduled tasks | `automation-engine`, `task-scheduler.ts` | Closest existing "runs with no human present" primitives |
| Single dispatch funnel | `dispatch-coordinator.ts` | Where the one autonomy branch belongs — don't bypass it |

There is **no** global "autonomy level" setting today. That's a feature, not a gap — see Option A vs C.

---

## The three shapes (pick one)

### Option A — Templated autonomous playbooks *(recommended)*

Dark Factory = **stored playbook templates** + a **per-ticket `autonomous` flag** the dispatcher honors by auto-approving `humanGate` stages (merge exempt).

- Templates (`new-web-app`, `new-mobile-app`, `feature-on-existing-repo`) are stored playbooks that **seed** the normal `workflow-select` proposal. The human still approves the playbook assignment once, up front — **that approval is the "go" button.** After that, the line runs dark to a draft PR.
- Flag **off** (default) = today's workflow, byte-for-byte unchanged.
- Escalation (circuit breaker or budget breach) **temporarily revives the human gates** — the correct failure posture.

**Cost:** one flag, one dispatcher branch, skip-permissions wiring, two templates. **Preserves current workflow by doing nothing to it.**

### Option B — Parallel "all-gates-open" playbooks

Same stages as each template but `humanGate: false` everywhere; no new flag.

- **Rejected.** Forks every template into two copies that drift. Maintenance tax with no benefit over the flag.

### Option C — Global autonomy-mode / Windsurf-style Chat·Write·Turbo dial

A session/track/global setting that names autonomy levels.

- **Rejected.** A taxonomy in search of a problem. The `humanGate` flags already *are* the spectrum, expressed where it belongs (per stage, as data). A global dial fights the per-stage flags and forces someone to define precedence. Skip it.

> **Recommendation: Option A.** It's the smallest change that delivers "just go, iterate," and it treats the existing FSM as the feature it already is.

---

## Feature menu — keep / defer / cut

Ranked after fable's review. The bias is a lean system: two great things beat eight mediocre ones.

### Keep (build in v1)
1. **Tests-green as the completion gate.** In an unattended loop, a green test/lint run is the only "done" that means anything. The orchestrator refuses to advance on red. This is the automated quality gate that makes the factory *dark* rather than merely *unsupervised*.
2. **Reversibility-based hard blocks.** A short, static denylist that **no flag can override** (see Safety). Small and load-bearing.
3. **Budget / step caps.** Wall-clock + iteration cap per ticket. The circuit breaker catches *loops*; the cap catches *drift* — an agent making steady, plausible, wrong progress for six hours. One number, escalate on breach.
4. **The shift report** (see below). The interface to a lights-out line is the morning report, not the floor.

### Defer (good idea, wrong week)
5. **Confidence-based escalation (Devin-style).** Self-rated LLM confidence is weakly calibrated, and we already have better signals: the circuit breaker (behavioral) and test results (objective). Add later only if escalations fire too late.
6. **Auto-commit-per-step + rewind tooling.** Worktree git already gives most of this free (`git reset` exists). Don't build rewind UI until someone needs to rewind and can't.
7. **Pre-flight check at dispatch** (tests pass on main, worktree clean, budget set, intake complete). Cheap, saves whole wasted runs — v1.5.

### Cut (say no)
- **Swarm / free-form multi-agent coordination** — frontier-stage; nothing in Workshop wants it.
- **Cloud ephemeral containers (Codex/Copilot style)** — Workshop is local-first; worktrees are the isolation story. Containers mean adopting a fleet.
- **Global autonomy-level setting** — see Option C.
- **Named modes (Chat/Write/Turbo)** — UI vocabulary for tools *without* a stage graph. We have a stage graph.

---

## Safety: reversibility, not judgment

The single most important design principle from the research: **match the escalation threshold to the reversibility of the action, not the difficulty of the task.**

Everything inside a worktree is reversible — let the agent run hot there, no permission prompts, full autonomy. The boundary where reversibility ends is where autonomy ends, **hard-coded, not configurable.**

**Never auto-approved, ever — the `autonomous` flag does not touch these:**
- **PR merge.** Dark Factory's terminal state is *draft PR open, tests green, waiting* — finished goods stacked at the loading dock. The always-draft / manual-`/done` convention is our best existing safeguard; the moment merge is automatable, every other safeguard becomes decoration.
- **Destructive remote ops** — force-push, origin branch deletion.
- **Anything outside the worktree** — global config, other repos, credentials.
- **Destructive data ops** — migrations against a real DB, deletes outside the tree.

The layered stack — four of five already exist:

```
worktree (blast radius) → hard denylist (irreversible actions)
  → circuit breaker + budget cap (runaway detection)
  → tests-green gate (quality) → draft PR (human owns integration)
```

Notice what is **not** in the stack: the agent's opinion of its own trustworthiness. Good.

---

## Coexistence: one flag, on the ticket

**A per-ticket `autonomous: boolean`**, set at dispatch, defaulting from the template. It tells `dispatch-coordinator.ts` to treat `humanGate: true` stages as auto-approved — **except the merge gate, which ignores the flag.**

- Off (default) → today's behavior, unchanged. The current workflow is preserved by doing literally nothing to it.
- On → the line runs dark; the circuit breaker escalates to the nearest human gate exactly as it does now.

Why ticket-level and not:
- **Track-level dial** — policy layered on mechanism. Ship the ticket flag; if you find yourself setting it identically on every ticket in a track, *then* promote it to a track default. YAGNI until observed.
- **Hand-editing `humanGate` per dispatch** — too fiddly; you shouldn't tune a stage graph to say "just go."

---

## Templates & specification debt

The research's sharpest warning: in a dark factory, **output quality = input quality**, and bad specs compound *silently* because no human is watching mid-stream. The failure mode isn't broken code — it's **plausible wrong code at scale**: six unattended hours delivering the agent's median guess about what "a todo app" means, handed over as a green-tested draft PR that solves the wrong problem.

So the template's real job is **interrogation, not scaffolding**:

- **A template is 20% stage graph, 80% intake.** `new-web-app` must force answers *before* the run: stack, auth (y/n), persistence, deploy target, and — most neglected — **explicit non-goals** and **acceptance criteria the test gate can actually check.**
- **Make the intake questionnaire *be* the spec gate.** Keep spec human-gated even in autonomous mode; the human's two remaining jobs are *define requirements* and *validate outcomes*. The intake should be impossible to skim.
- **Acceptance criteria must be executable.** If a criterion can't be phrased as something the test gate verifies, either rewrite it or flag it "human must eyeball at PR review." Don't let untestable requirements ride along invisibly.
- **Keep templates few, in-repo, versioned.** Default prompts are code nobody reviews (prompt rot). Two great templates beat eight mediocre ones — and the eight will accumulate if nobody says no.

---

## The shift report (the piece the research missed)

Real lights-out factories are heavily instrumented; the human's interface is the morning report, not the floor. When an autonomous ticket finishes **or** escalates, produce one compact artifact:

- what was built, key decisions made
- test results, cost / iterations consumed
- what needs eyes, and why it stopped (done vs. escalated)

The promise of this feature is **"come back to a tidy desk"** — three draft PRs, three readable summaries, zero rummaging through session transcripts. Without it, unattended runs produce anxiety instead of leverage and you won't trust the mode enough to use it.

Two reuse notes: **escalations land in the existing review queue** (no new inbox, no notification system), and the report is a natural extension of the `SubagentStop`/session-end hooks already wired in `launcher-builders.ts`.

---

## Suggested phasing

- **v1 (the whole feature):** ticket `autonomous` flag honored by the dispatcher (merge exempt) · skip-permissions parity for workflow agents · hard reversibility denylist · tests-green completion gate · budget/iteration cap · 2 templates with demanding intake · shift report.
- **v1.5:** pre-flight check at dispatch · a third template if a real second use case appears.
- **Later, only if observed need:** confidence-based routing · rewind tooling · track-level autonomy default.

---

## UX — how you interact, end to end

The design principle for the UX mirrors the one for the code: **not a new place in the app, a new way to start an epic you already know.** Dark Factory reuses the Workflow tab, the EpicDetail screen, the human-gate panels, the Notifications inbox, and the office-strip session visualization. What changes is *when* you're pulled in — today it's every gate; in Dark Factory it's only at the start, at an escalation, and at the end.

### Today — you shepherd every gate

1. **Kanban** (`/kanban`) for quick one-offs: open a todo, **Dispatch to Agent** (`DispatchDropdown` — pick provider, optionally toggle *"Dangerous mode (skip permissions)"*), watch the pulsing "Agent" badge. Or **Workflow** (`/workflow`) for anything real.
2. **Create an epic** (`CreateEpicModal`: *Standard* or *From Plan*). An agent proposes a playbook; you land on `EpicDetail` and click **Approve & Start** (`WorkflowAssignmentPanel`).
3. **Babysit the pipeline.** The epic walks its stages, stopping at each `humanGate`. The **bell badge** in `TopNav` counts tickets waiting on you; the **Notifications** page (`/notifications`) lists them. You open each one, read the `HumanGatePanel` summary, and click **Approve / Reject** — at spec-review, plan-review, decomposition-review, code-review, integration-review, final-review. That's potentially six stops per epic.
4. **Merge.** Final gate approved → draft PR. You merge on GitHub. `submit-for-review` and `/done` keep the PR draft and the todo out of `done` until you say so.

Every stop is a context-switch back to you. That's the feature today — and the thing you want an alternative to.

### Dark Factory — you set intent, walk away, review the finished shift

**Step 1 — Start a run (one screen, one approval).**
`CreateEpicModal` gains a third path beside Standard / From Plan: **From Template**.
- Pick a template card: **New Web App**, **New Mobile App**, **Feature on Existing Repo**.
- Fill the **intake form** — the template's required questions (stack, auth, persistence, deploy target, **non-goals**, **acceptance criteria**). This is deliberately demanding; it *is* the spec gate (see Specification Debt). Vague answers are where autonomy goes wrong, so the form refuses blanks on the load-bearing fields.
- A **"Run dark"** toggle (on by default for templates) and a **budget** control (e.g. *40 steps / 4 hours*, sensible default pre-filled).
- Click **Approve & Run.** This is the *single* approval — the playbook assignment plus the intake answers are the "go" button. From here the lights go off.

> UX option for where "Run dark" lives: (a) a toggle inside `CreateEpicModal` *(recommended — keeps it "a way to start an epic," consistent with the architecture)*; (b) a separate nav tab *(rejected — implies a separate system, which it isn't)*; (c) a per-track default "this track runs dark" *(defer — promote to this only if you find yourself toggling it identically every time)*.

**Step 2 — While it runs (ambient, ignorable).**
Open `EpicDetail` and watch, or close the tab and do something else. The difference from today: the `HumanGatePanel` cards **auto-clear** — you see the `StateTimeline` fill in with `actor: system` "Dark Factory: auto-approved" entries, and the `StateDiagram` animates through stages on its own. The `AgentSessionsBar` shows live status ("Agents are implementing…", "Running tests…"). The bell badge stays quiet because nothing is waiting on you.
- New surface: a **live progress feed** on `EpicDetail`. Today the server already collects `stateData.agentProgress` from the SubagentStop hook but **nothing renders it** — Dark Factory is what finally puts that data on screen: a running ticker of "what each sub-agent just did."
- New surface (optional, high-charm): a **Factory Floor** view that reuses the existing `TrackOfficeStrip` "office desk" characters — one illustrated worker per active autonomous session across all runs, working / idle / dying at a glance. Fits the calm-command-center spirit; it's the "watch the line run" screen.

**Step 3 — If it gets stuck (the only mid-run interruption).**
Budget exhausted or circuit breaker tripped → the ticket escalates to its nearest human gate, *exactly* the state today's gates use. It reappears in the **bell badge** and the **Notifications** inbox with a reason ("Dark Factory: budget exhausted at code-review"). You handle it like any gate today — Approve / Reject / answer questions — and it either resumes dark or you take the wheel. No new inbox, no new mechanic; escalation simply *revives* the normal human-in-the-loop flow for that one ticket.

**Step 4 — Come back to a tidy desk.**
Terminal state = **draft PR open, tests green, waiting.** `EpicDetail` shows a new **Shift Report** card: what was built, key decisions, the test run result, steps/time consumed, and anything flagged for your eyes. You read the report, glance at the draft PR, and merge — or reject and send it back. **Merge is the one gate that never auto-passes**, in this lane or the kanban lane. If you kicked off three runs before dinner, you come back to three draft PRs and three readable reports in Notifications, not three terminals to reconstruct.

### The net change in your day

| Moment | Today | Dark Factory |
|---|---|---|
| Kick off | Create epic, approve playbook | Pick template, fill intake, one approval |
| Spec / plan / decomposition / review gates | Stop and approve each (~6) | Auto-pass, logged as `system` in the timeline |
| Watching | Open terminals, read banners | Ambient progress feed / Factory Floor, or ignore |
| Interruption | Every gate pulls you back | Only an escalation (budget/stuck) pulls you back |
| Finish | Approve final gate, merge | Read Shift Report, merge |
| Merge | Human | **Human (unchanged, non-negotiable)** |

### UI work this implies (honest list)

Mostly reuse; three genuinely new components:
- **New:** template picker + intake form (extends `CreateEpicModal`); **Shift Report** card (`EpicDetail`); **progress feed** rendering the already-collected `agentProgress`.
- **Small additions:** "Run dark" toggle + budget input; a "🏭 running dark" pill on `EpicCard`/`EpicDetail` so autonomous epics are visually distinct; `system`-actor rows already render in `StateTimeline` (no change).
- **Reuse as-is:** `HumanGatePanel` (for escalations), `NotificationsPage`, bell badge, `StateDiagram`, `AgentSessionsBar`, `TrackOfficeStrip` (→ Factory Floor).
- **Two existing gaps this would close:** `agentProgress` is collected but never shown; `ReviewDiffView` is built but unwired — the latter could surface the shift report's before/after or template-diff review.
- **One scaling caveat:** every page currently full-refetches on each WebSocket event. Several concurrent dark runs raise event volume; a Factory Floor watching *all* runs may want payload-driven updates rather than refetch-on-event. Note it; don't fix it pre-emptively.

---

## Appendix — the concrete augmentation (how, file by file)

This is the detail behind Option A. It leans entirely on machinery that already exists; the theme is *five small insertions at points the code already routes through*, not a new subsystem.

### The single best property: no SQL migration

Everything new rides on JSON that is **already persisted**:
- The autonomy flag + budget live in `WorkflowTicket.stateData` (a free-form bag the engine already reads/merges — see `engine.ts:180,238`).
- The "this gate may be auto-approved" marker is one optional field on `StageDefinitionSchema`, and stage definitions are stored *inside* the playbook's JSON payload in `workflow_templates` — not as columns.

So the entire feature is: a Zod field, a coordinator loop, two one-line dispatch tweaks, an engine budget check, and template data. Flag absent (every existing ticket) → every new branch is a no-op → today's behavior byte-for-byte.

### Change map

| # | Change | File | Shape |
|---|---|---|---|
| 1 | `autonomous` + `autonomousBudget` read helper | `dispatch-coordinator.ts` | resolve from ticket, else parent epic |
| 2 | Auto-advance human gates (merge exempt) | `dispatch-coordinator.ts` | new `autoAdvanceGates()` after each transition |
| 3 | `autoApprovable?: boolean` on stages + hard merge guard | `domain/workflow/schemas.ts`, coordinator | data marker + code belt-and-suspenders |
| 4 | Pass `dangerouslySkipPermissions` for autonomous tickets | `agent-dispatcher.ts:337`, `execution-dispatcher.ts:133` | one option on the existing `createSession` calls |
| 5 | Whole-ticket budget cap → escalate | `engine.ts` (beside circuit breaker, `:182`) | reuse `findNearestHumanGate()` |
| 6 | Tests-green completion gate | template prompt (+ optional `verify` stage) | topology/prompt, not engine |
| 7 | Shift report | `engine.ts` `onTerminalState` hook (already wired) + escalation path | read existing audit + `agentProgress` |
| 8 | Templates | `templates/playbooks/*.json` (installed like `templates/agents`) | stored playbook + intake questions |

### 1–2. Auto-advance the human gates

The whole "just go" behavior is one loop in the coordinator — the funnel every caller already passes through (`dispatch-coordinator.ts`). Today `transitionWithDispatch`/`approveWithDispatch`/`reject` end by calling `dispatchIfNeeded(updated)`. Add one step after it:

```
autoAdvanceGates(ticket):
  guard: ticket (or its parent epic) has stateData.autonomous === true
  loop (depth-capped, e.g. 8):
    stage = current stage
    stop unless stage.humanGate
    stop if NOT canAutoApprove(stage)        // merge stays sacred — see #3
    stop unless stage has a 'human-approve' transition
    updated = engine.approve(ticket.id, 'Dark Factory: auto-approved')
    await dispatchIfNeeded(updated)           // spawns the next agent/execution
    ticket = re-read
```

`engine.approve()` already exists (`engine.ts:324`), already validates the gate, and already runs auto-transitions internally. We're just calling it on the machine's behalf instead of waiting for a human MCP call. The circuit breaker (`engine.ts:186`) is untouched and still fires — in autonomous mode an escalation *revives* the gates (the loop stops advancing because the escalated state is where the agent got stuck), which is exactly the failure posture we want.

Flag off → `autoAdvanceGates` returns immediately → identical to today.

### 3. Merge stays sacred — enforced twice

Add one optional field to `StageDefinitionSchema` (`schemas.ts:41`):

```
autoApprovable: z.boolean().optional(),   // default-true semantics; the PR/merge gate sets false
```

Stored inside the playbook JSON, so **no migration**, and `graph-validator.ts` passes it through untouched. `canAutoApprove(stage)` returns `stage.autoApprovable !== false`.

Belt-and-suspenders in code so a careless template can't ever automate merge: also refuse to auto-approve any gate whose `human-approve` target is a **terminal** state (`isTerminal`) — i.e. anything leading to `merged`/`done`. Two independent guards; either one alone keeps the draft-PR-then-stop property.

### 4. Skip-permissions parity (one line × two call sites)

Both dispatchers build a `createSession(trackId, { … })` options object — `agent-dispatcher.ts:337` and `execution-dispatcher.ts:133`. `CreateSessionOptions` already carries `dangerouslySkipPermissions` (`domain/terminal/manager.ts:48`); scheduled tasks and todo dispatch already set it. Add:

```
dangerouslySkipPermissions: isAutonomous(ticket),
```

resolving `isAutonomous` the same way `resolveTrackIdFromParent` already climbs to the parent epic (`agent-dispatcher.ts:107`). Non-autonomous tickets keep interactive permission handling exactly as now.

### 5. Whole-ticket budget cap

The circuit breaker catches *loops* (3 iterations at one state); it does **not** catch *drift* — an agent making steady, plausible, wrong progress across many states for hours. Add a second check right beside it in `applyTransition` (`engine.ts:182`):

```
if autonomous and (totalTransitions >= budget.maxSteps
                   or now - createdAt >= budget.maxWallClock):
    toState = findNearestHumanGate(stages, ticket.state)   // reuse existing escalation
    comment = 'Dark Factory: budget exhausted, escalating'
```

`findNearestHumanGate` already exists (`engine.ts:154`). Budget values come from `stateData.autonomousBudget`, seeded by the template (e.g. 40 steps / 4h). One number, existing escalation path.

### 6. Tests-green as the "done" signal

Two levels, ship the cheap one first:
- **v1 (prompt):** the template's execution + code-review stages carry a `completionInstructions` (the mechanism at `agent-dispatcher.ts:182` / role `promptBlock`) that forbids transitioning to success until a named test/lint command exits green, and to paste the run output into the transition comment.
- **v1.5 (structural):** add a `verify` stage (`agentActionable`, role runs the suite) between execute and integration-review; green → forward, red → back to execute. The circuit breaker bounds the retry loop for free.

### 7. The shift report

`engine.ts` already accepts an `onTerminalState(ticket)` hook (`:98,264`) that fires when a ticket reaches a no-outgoing-transitions state. Wire a reporter there, plus one call on the circuit-breaker/budget escalation path. It needs no new data collection — it reads what's already recorded:
- the `workflow_transitions` audit table (every state change, actor, comment),
- `stateData.agentProgress` (already populated by the `SubagentStop` progress hook, `execution-dispatcher.ts:148`),
- linked PRs.

Output: one compact artifact (what was built, decisions, test result, steps/cost consumed, why it stopped: done vs escalated) → written to the vault and the ticket description. Escalations land in the **existing** review queue — no new inbox.

### 8. Templates

A template is a stored playbook (epic + companion task playbook + agent roles) plus a seed set of **intake questions**, kept in-repo under `templates/playbooks/` and installed the way `templates/agents` / `templates/skills` already are. Two things make them safe:
- They **seed** the existing `workflow-select` → `workshop_propose_playbook` → human-approve flow rather than bypassing it. The human approves the playbook assignment once, up front — *that approval is the "go" button*. Preserves the deliberate "no hardcoded default playbook" property.
- The entry routes through the existing `triage` stage, whose Q&A machinery (`pendingQuestions`/`answers`/`needs-input`, `agent-dispatcher.ts:188`) already exists — the template just supplies demanding, required questions (stack, auth, persistence, deploy target, **non-goals**, **executable acceptance criteria**). The intake questionnaire *is* the spec gate; that is the primary defense against specification debt.

Start with two: `new-web-app` and `feature-on-existing-repo` (likely your most common real case). Keep them few and versioned in git — default prompts are code nobody reviews.

### What this deliberately does NOT touch

The lightweight Todo/Kanban path, `submit-for-review` (always draft PR), and `/done` (manual-only) are all unchanged. Dark Factory lives entirely in the WorkflowTicket lane; the merge gate remains human in both lanes.

### Rough effort

Changes 1–5 are the core and are small and localized (one Zod field, one coordinator loop, two one-liners, one engine check). Change 7 (shift report) is the largest single piece because it's new prose-generation, but it reads only existing data. Change 8 is authoring, not engine work. No new tables, no new services, no new dispatch model.

---

## Open decisions for you

1. **Option A confirmed?** (Ticket-flag + templates, vs. anything heavier.)
2. **Which two templates first?** `new-web-app` + `new-mobile-app`, or swap one for `feature-on-existing-repo` (probably your most common real case)?
3. **Budget cap unit** — wall-clock, iteration count, or both? Default value?
4. **Merge stays sacred** — confirm you want *no* auto-merge escape hatch, ever (recommended).
5. **Shift report destination** — vault note, the todo/ticket description, a dashboard card, or all three?
