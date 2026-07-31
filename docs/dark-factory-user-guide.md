# Dark Factory — Step-by-Step Guide (as planned)

*A plain-language walkthrough of how you'd actually use Dark Factory once built. Assumes you've never opened the Workflow tab. Nothing here is implemented yet — this is the target experience.*

## Orientation: two tabs, two jobs

- **Kanban** (`/kanban`) — sticky notes. One todo, dispatch one agent, done. You may have used this.
- **Workflow** (`/workflow`) — an assembly line. An "epic" moves through stages (spec → plan → build → review → PR), and normally *stops at each gate* for you to approve.

**Dark Factory = a Workflow epic with the gates set to auto-pass.** Same tab, same pipeline. You approve once at the start, then it runs to a finished draft PR by itself, and only interrupts you if it gets stuck.

---

## Before you start (one-time setup)

Dark Factory builds code, so it needs somewhere to build. On the **Tracks** tab, make sure you have a track with a repository attached (a Git repo path). For a brand-new app, that's an empty initialized repo; for a feature, it's the existing project. *(This is a real prerequisite — the executor refuses to run with no repo on the track.)*

---

## The walkthrough

We'll build a small web app — a **reading-list tracker** — as the running example.

### Step 1 — Open Workflow → New Epic

1. Click **Workflow** in the top nav.
2. You'll see two sub-tabs: **Epics** (your runs) and **Playbooks** (the templates/recipes). Stay on **Epics**.
3. Click **+ New Epic**. A dialog opens with three choices:
   - *Standard* — describe it, an agent designs the workflow.
   - *From Plan* — paste a plan you already wrote.
   - **From Template** ← the Dark Factory path.
4. Click **From Template**.

### Step 2 — Pick a template

You'll see template cards: **New Web App**, **New Mobile App**, **Feature on Existing Repo**. Click **New Web App**.

Each template is a pre-built recipe: it already knows the stages (scaffold → build → test → PR), which agents run them, and — crucially — *what to ask you*.

### Step 3 — Fill the intake form (the important part)

The template asks you a short list of required questions. This is the one screen that matters most, because once you hit go, nobody's watching mid-build. For **New Web App**:

- **What is it?** → "A reading-list tracker: add books, mark as reading/finished, rate them."
- **Stack?** → e.g. React + Vite + SQLite (or "you choose, keep it simple").
- **Auth?** → "No — single user, local."
- **Persistence?** → "SQLite file."
- **Deploy target?** → "None yet, just run locally."
- **Non-goals** (what NOT to build) → "No social features, no cloud sync, no user accounts."
- **Acceptance criteria** (how we'll know it's done) → "Can add a book, list books, change status, ratings persist across restart. Tests pass."

The form won't let you leave the load-bearing fields blank. Vague answers = confident wrong app six hours later, so it pushes you to be specific here.

### Step 4 — Set autonomy and budget

Two controls at the bottom of the form:

- **Run dark** → a toggle, **on** by default for templates. On = auto-pass the gates. (Turn it off and you get the normal stop-at-every-gate behavior — same template, manual driving.)
- **Budget** → pre-filled with a sensible default, e.g. **40 steps / 4 hours**. This is the safety limit: if the run burns through it, it stops and asks you instead of grinding forever.

Click **Approve & Run.**

**That click is the whole "go."** It's the single approval — the equivalent of approving the plan today. From here the lights go off.

### Step 5 — Watch it run (or don't)

You land on the **Epic detail** page. What you'll see:

- A **pipeline / state diagram** lighting up as it moves: scaffolding → building → running tests → opening PR.
- A **timeline** on the right filling in with entries. The gate approvals you'd normally click show up automatically, labeled *"Dark Factory: auto-approved (system)."*
- A **live progress feed** — a running ticker of what each sub-agent just did ("scaffolded project", "added Book model", "wrote tests for status changes").
- A **🏭 running dark** pill so you can tell at a glance this epic is autonomous.

The top-nav **bell** stays quiet — nothing is waiting on you. You can close the tab and get coffee. If you kicked off three of these, there's a **Factory Floor** view showing all of them running side by side (little worker characters, one per active agent).

### Step 6 — If it gets stuck (the only interruption)

If the run hits its budget or an agent loops on the same problem three times, it **stops and escalates**:

- The **bell badge** lights up and it appears in **Notifications** with a reason, e.g. *"Dark Factory: stuck at tests — escalating."*
- You open it, read the summary, and do what you'd do at any gate: **Approve** (let it continue), **Reject** / add a comment (send it back with guidance), or **answer its question**.
- It then resumes on its own, or you take the wheel manually.

This is the same gate mechanic the normal Workflow uses — an escalation just temporarily *turns the lights back on* for that one run.

### Step 7 — Come back to a finished shift

When it's done, the epic reaches its end state: **draft PR open, tests green, waiting for you.** On the Epic detail page you get a **Shift Report** card:

- What was built (files, features)
- Key decisions it made
- The test-run result (green)
- How much it used (steps / time)
- Anything it wants your eyes on

You read the report, click through to the **draft PR**, and either **merge it** or bounce it back. Merging is the one thing Dark Factory will *never* do on its own — a human always merges. Then mark it done.

If you'd started three runs, you'd come back to three draft PRs and three Shift Reports sitting in your Notifications — not three terminals to reconstruct.

---

## The whole thing in one breath

> Workflow tab → New Epic → **From Template** → pick *New Web App* → answer the intake questions → **Run dark** + budget → **Approve & Run** → walk away → (it only pings you if stuck) → come back to a **draft PR + Shift Report** → read, merge.

## How that compares to using Workflow normally

| Step | Normal Workflow | Dark Factory |
|---|---|---|
| Start | New Epic → describe → approve the proposed plan | New Epic → **From Template** → intake form → Run dark |
| The middle | Approve/reject at ~6 gates, one at a time | Auto-passes; you watch or ignore |
| Pinged when | Every gate | Only if stuck (budget / looping) |
| End | Approve final gate → merge | Read Shift Report → merge |
| Who merges | You | You (never automated) |

## FAQ

**Do I have to use templates?** No. Any Workflow epic can be "run dark" with the toggle. Templates just pre-load good questions and stages so you don't design them each time.

**Can I stop a run?** Yes — the agent-sessions bar on the Epic page has **Kill**, same as any Workflow session today.

**What if the intake was wrong?** It'll either escalate when confused, or hand you a draft PR that misses the mark — which you reject. The intake form is where you prevent that; that's why it's strict.

**Is my normal workflow gone?** No. Flip "Run dark" off and it's the standard stop-at-every-gate pipeline. Dark Factory is additive.
