---
name: pr-review
description: "Reviews a pull request (or the current branch's unpushed work) with the same correctness, over-engineering, and comment passes the Workshop PR Review dashboard uses. Session mode (default) hands the findings back so the invoking agent fixes them before submitting; dashboard mode reports them to the PR Review tab. Use when the user says 'review my PR', 'self-review this branch', 'run a PR review before I submit', or '/pr-review'. Tagged: workshop."
---

# pr-review — Review a PR the way the PR Review dashboard does

One procedure, two destinations for the findings.

| Mode | When | Findings go to |
|------|------|----------------|
| **session** (default) | Run inside a working session to self-review before submitting | The invoking agent, which fixes them |
| **dashboard** | The task prompt or args contain `Mode: dashboard` (the PR Review tab's dispatch always does) | The Workshop PR Review dashboard, where the user curates and posts them |

Either way: never post reviews or comments to the forge, never merge, never close the PR.

## 1. Identify the target

- **Dashboard mode**: the PR URL in the task prompt.
- **Session mode**, first that applies:
  1. A PR URL or number in the args.
  2. The current branch's PR: `gh pr view --json url -q .url`.
  3. No PR yet: the local branch against its base — `git diff "$(git merge-base origin/main HEAD)"` (committed and uncommitted work), plus untracked files from `git status --short`.

## 2. Fetch the diff and context

- **GitHub** (`github.com/<owner>/<repo>/pull/<n>`): `gh pr view <url>` for context, `gh pr diff <url>` for the diff.
- **Gitea / Forgejo** (any host in `~/.config/tea/config.yml`, PR paths look like `/pulls/<n>`): `tea pulls <n> --repo <owner>/<repo> --login <login>` for context, and for the diff:
  ```bash
  TOKEN=$(grep -m1 'token:' ~/.config/tea/config.yml | awk '{print $2}')
  curl -sL -H "Authorization: token $TOKEN" "<pr-url>.diff"
  ```
- **Local branch**: the `git diff` and untracked files from step 1, plus `git log --oneline origin/main..HEAD`.

Read enough of the surrounding code to judge each change in context — never review a hunk blind. Note how the change was tested: CI status, test files touched, manual verification described in the PR body. An untested change is a finding.

## 3. Review passes

### Pass 1 — Correctness & safety

Hunt real defects: logic errors, unhandled edge cases, race conditions, data loss, security issues (injection, secrets, trust-boundary validation), broken error handling, breaking API changes. For each finding give file:line, the defect in one sentence, and a concrete failure scenario. No style nits, no speculation — only issues you can defend with a failure case.

### Pass 2 — Over-engineering (ponytail-review)

Invoke the **`ponytail-review` skill** (Skill tool, name `ponytail:ponytail-review`) on the diff. It defines the finding format (`<file>:L<line>: delete:/stdlib:/native:/yagni:/shrink: ...`), the `net: -<N> lines possible.` / `Lean already. Ship.` scoring, and the never-cut guardrails — follow it exactly during analysis. In dashboard mode, translate its shorthand into plain language when writing `findings[]` (see 4b).

Fallback if the skill is unavailable: review the diff for unnecessary complexity yourself — one line per finding naming what to cut and what replaces it — and never propose cutting trust-boundary validation, data-loss error handling, security measures, accessibility basics, or a lone smoke test.

### Pass 3 — Comments & description

**Unnecessary comments** (category `comments`, one finding per cluster, not per line). A comment earns its place only as the sole mechanism for a required effect (`# noqa`, a docstring, a build tag), or when correctness depends on something invisible from the file — a value that must stay in sync with one defined elsewhere, a workaround for a named upstream bug. Flag the rest: comments explaining *why* the code is written a certain way (that reasoning belongs in the PR description), restating what well-named code already shows, or running to a paragraph. If a comment seems load-bearing for comprehension, the finding is that the code should be clearer. Defer to the repo's own convention where `AGENTS.md`/`CLAUDE.md` states one.

**Historical narrative in the PR description** (category `pr-description`, one finding total, PRs only). Flag phrasing only meaningful relative to an earlier version of this PR — "originally this was X", "this shrank from N lines", "addresses review feedback". Neither finding in this pass justifies `request_changes`; they are `comment` at most.

### Verdict

`approve` (no correctness findings, over-engineering minor or none), `request_changes` (any correctness finding, or over-engineering severe enough to block), or `comment` (borderline — flag concerns without blocking).

## 4a. Session mode — hand the findings back

**Fresh eyes.** If you wrote the code under review in this conversation, don't review it yourself — you'll read your own assumptions back. Run steps 1–3 in a fresh subagent (Agent tool, `general-purpose`, `model: sonnet`) with the prompt: *"Run the pr-review skill in session mode on <target>. You are the reviewer: return the findings list only — do not spawn further reviewers and do not edit code."* Then continue with its findings below. If your own prompt says "You are the reviewer", never delegate — review directly and stop after **Report**.

**Report** the findings as a ranked list, most severe first, one per line:

```
<file>:<line> [<category>] <defect in one sentence> — <failure scenario, correctness only> — fix: <what to change>
```

End with the verdict and the ponytail `net:` line. Shorthand is fine here; the audience is the agent doing the fixing, not the PR author.

**Act on them** (the invoking agent — e.g. the Orchestrator in Phase 3): fix every correctness and testing finding; apply the rest unless one would cut something the task explicitly asked for (skip it, say why in one line); then re-run the repo's checks.

## 4b. Dashboard mode — report to Workshop

Call the **`workshop_report_pr_review` MCP tool** once with everything:

- `prUrl`: the PR URL reviewed.
- `findings[]`: every finding from all passes. Each needs `file` (repo-relative), `line` (line number in the PR **head** version — pick a line that appears in the diff so it anchors as an inline comment), `category` (`correctness`, `over-engineering`, `testing`, `comments`, …), `summary` (one sentence), `failureScenario` (correctness findings), and `suggestedComment` — the text to post inline, written **directly to the author**: specific and actionable, one sentence where possible.
- `draftSummary`: a brief, kind note to the author — one sentence, two at most. Don't describe the change; the author knows what it does. Match the verdict: approving → something like "Looks good to me!"; comments → "This looks good, but take a look at a few comments I had"; requesting changes → "This is looking good, but I have a few concerns — see my inline comments". Vary the wording; keep the length and tone. Don't restate inline findings. A `pr-description` finding goes here, not in `findings[]`.
- `suggestedVerdict`: from step 3.

**Write for the author.** Everything destined for the PR (`suggestedComment`, `draftSummary`) is plain language: no acronyms or reviewer jargon (YAGNI, DRY, LGTM, nit, footgun), and no ponytail shorthand (`yagni:`, `delete:`, `shrink:`, `net: -N lines`). Say what you mean — "this abstraction isn't needed yet; a plain function does the same job".

If the MCP tool is unavailable, print the exact JSON payload you would have sent, clearly labeled. Never fall back to `gh pr review` or `tea pr review`.

## Boundaries

- Review the target you were given — no drive-by reviews of neighboring code.
- Never push, merge, close the PR, or post to the forge in either mode — submitting is `submit-for-review`'s job.
- Dashboard mode is read-only: no code edits at all. Session mode edits local code only in 4a's **Act on them** step.
