---
name: learn-repos
description: "Investigate the repos and source materials attached to a Workshop track — purpose, layout, hot files, change patterns, and recent PR review feedback — then draft and save a track context brief so future agents know where to go. Use this whenever the user says 'learn this track', 'learn these repos', 'onboard yourself', 'recon the repos', 'figure out what's in this track', 'what changes a lot here', 'why do PRs get changes requested', or asks to write, refresh, or improve a track's context. Also use when a track has thin or missing context and agents keep rediscovering the same layout. Tagged: workshop."
---

# Learn Repos — Track Environment Recon

Workshop injects a track's `context` field into the system prompt of every session started in that track. That single field is the difference between an agent that opens the right file in thirty seconds and one that greps blindly for ten minutes.

Your job here is to earn that field: investigate the track's repos and source materials, then write a **routing map** — where things live, what changes, what reviewers reject — and save it to the track once the user signs off.

Optimize for the reader you are writing for: a competent agent with no memory of this codebase, about to be handed a task. It does not need a tour. It needs to know which of eight thousand files to open first, and what will get its PR sent back.

## Phase 1 — Resolve the track

Sessions do not receive their track ID, so establish it before anything else.

1. `mcp__workshop__workshop_list_tracks` — get the candidates.
2. Identify the likely track. The session's repos and paths are usually named in your own system prompt under `## Repositories` / `## Track Paths`; match those against candidates with `mcp__workshop__workshop_get_track`. Track names also tend to mirror the repo.
3. Confirm with the user via `AskUserQuestion` if more than one track plausibly fits. Guessing wrong means writing recon for one project into another project's prompt.

Then pull the full picture:

- `mcp__workshop__workshop_get_track(trackId)` — `repos[]` (git repos) and `paths[]` (labelled source-material directories).
- `mcp__workshop__workshop_get_context(trackId)` — the existing context. Read it now, not at save time: it tells you what is already known so you can spend the investigation on gaps, and it is the thing you risk destroying in Phase 5.

**Worktree caveat**: sessions frequently run inside `~/.workshop/sessions/<id>/workspace/<repo>`, a git worktree. Always investigate the canonical path from `track.repos[].path`. Worktrees share history so `git log` works either way, but file layout on a feature branch can mislead, and `gh` needs the real remote.

## Phase 2 — Investigate each repo

For two or more repos, delegate one `Explore` subagent per repo (`model: sonnet`), all spawned in a single message so they run in parallel — large monorepos otherwise dominate the wall clock. For a single-repo track, just run the commands yourself; a spawn buys no parallelism and costs a round trip.

Give each subagent the repo's absolute canonical path, the track name, and the command block below verbatim — otherwise every subagent invents its own slightly different git incantation.

### Recon command block

```bash
R=<absolute-repo-path>
cd "$R"

# Identity
gh repo view --json nameWithOwner,description -q '.nameWithOwner, .description'
git log -1 --format='last commit: %ad by %an' --date=short

# Noise filter — extend per ecosystem before running the two commands below
NOISE='(lock|\.lock|_pb2\.py|\.min\.|^dist/|/dist/|\.snap$|__snapshots__|vendor/|\.generated\.)'

# What actually changes (6 months, top files)
git log --since="6 months ago" --name-only --pretty=format: \
  | grep -v '^$' | grep -vE "$NOISE" | sort | uniq -c | sort -rn | head -30

# Which areas are hot (top-two path segments)
git log --since="6 months ago" --name-only --pretty=format: \
  | grep -v '^$' | grep -vE "$NOISE" | cut -d/ -f1-2 | sort | uniq -c | sort -rn | head -20

# What kind of changes (read the subjects, do not just count them)
git log --since="6 months ago" --pretty=format:'%s' | head -200

# Who works here — the explicit HEAD is required: without a revision and
# without a TTY on stdin, git shortlog reads stdin and returns nothing.
git shortlog -sne --since="6 months ago" HEAD | head -10
```

The filter is a starting point, not a guarantee — also discount mass-reformat and dependency-bump commits by eye before calling something a hot file. Generated churn inflates counts without telling anyone where to work.

Two window adjustments worth making: if six months returns only a handful of commits, widen it (`--since="2 years ago"`) and say the repo is quiet, since "nothing changes here" is itself useful routing information. If the repo is a monorepo where the track only cares about one subtree, scope every command with a pathspec (`-- services/billing/`) — whole-monorepo churn stats are noise wearing a statistic's clothes.

### PR feedback

The point is not a list of comments. It is the answer to *"what does this repo's review culture reject?"* — the recurring objection an agent can avoid by construction.

```bash
R=<owner/repo>

# Recent inline review comments (highest signal, single call)
gh api "repos/$R/pulls/comments?per_page=100&sort=created&direction=desc" \
  --jq '.[0:40][] | {pr:(.pull_request_url|split("/")|last), path, user:.user.login, body:(.body[0:400])}'

# Conversation-level comments
gh api "repos/$R/issues/comments?per_page=50&sort=created&direction=desc" \
  --jq '.[0:20][] | {user:.user.login, body:(.body[0:300])}'

# Explicit change requests on recent PRs — 15 API calls, so only run this
# if either query above returned something. Both empty means nobody reviews
# here, and the loop will spend fifteen round trips confirming it.
# Piped into `while read`, not `for n in $(...)`: zsh does not word-split
# unquoted command substitution, so the `for` form binds all 15 numbers to
# one iteration and gh fails on a URL full of newlines.
gh pr list -R "$R" --state merged --limit 15 --json number --jq '.[].number' \
| while read -r n; do
  gh api "repos/$R/pulls/$n/reviews" \
    --jq ".[] | select(.state==\"CHANGES_REQUESTED\") | {pr:$n, user:.user.login, body:(.body[0:300])}"
done
```

Two things to weigh honestly:

- **Separate bots from humans.** `cursor[bot]`, `github-actions`, and friends often outnumber people. Bot findings are still useful — a repeated bot complaint is a real defect class — but a human's "we don't do it that way here" is worth ten of them, because it encodes convention an agent cannot infer from the code.
- **Silence is a finding.** Plenty of repos have zero `CHANGES_REQUESTED` (self-merged, or approval-only culture). Say "no change requests in the last N merged PRs; review is light" rather than padding. Fabricated review culture is worse than none. And distinguish the two silences: *no reviews exist* is a fact about the repo, while *the query failed* (unauthenticated `gh`, rate limit, non-GitHub remote, permissions) is a fact about your run. Report which one you hit — an agent that reads "review is light" when the truth was "I got a 403" will merge with false confidence.

### What each subagent reports back

Ask for prose filling every field of the Phase 4 template, plus these three, which inform the brief without appearing in it as their own sections:

- **Entry points** — where a task actually starts (server bootstrap, CLI root, route table, main config). These become the "Start here" line.
- **Change patterns** — the recurring shapes of work ("mostly new API routes plus a migration", "config-only changes"). These become the "Where to go for common tasks" lanes.
- **Contributors** — who is active, so review culture has names attached.

Two things are worth stating explicitly to every subagent, because both are tempting to fake. **Build and test commands must be read out of `package.json`, `Makefile`, `pyproject.toml`, or CI config, never inferred from ecosystem convention** — a plausible-looking wrong test command costs the next agent a failed run and a confused detour. And **hot spots need the *why* alongside the count**: "`api.ts`, 90 commits" is trivia, while "`api.ts` — every new feature adds a route here" is routing.

## Phase 3 — Source materials

Some tracks carry no git repos at all — only paths. That is a valid track, and the brief for it is mostly this phase plus standing instructions; do not treat a repo-less track as a failed investigation.

Non-repo `paths[]` are attached for a reason. Look at each one and record what it is good for, in a line or two — a docs vault, a scratch directory, exported data. If a path is empty or a junk drawer (`/tmp`), say so plainly and keep it short; padding the context with a useless path teaches future agents to skim past the whole section.

## Phase 4 — Draft the brief

Write to a file first (`/tmp/track-context-<slug>.md`) so the user can read it properly before it goes anywhere near the track.

Budget: **150 lines or less**. This text is prepended to every session in the track, forever. Every line that does not change what an agent *does* is rent charged against the real task.

```markdown
# <Track Name>

<Two or three sentences: what this track is for, what the work usually looks like.>

## Repos

### <repo-name> — `<absolute path>`
<Purpose in 1–2 sentences.>
- **Start here**: <entry-point files for common tasks>
- **Layout**: <dir> — <what>; <dir> — <what>
- **Build/test**: `<verified commands>`
- **Hot spots**: <files/areas that churn, and why>
- **Conventions**: <rules that get enforced in review>
- **Gotchas**: <what bites newcomers>

## Source Materials
- `<path>` (<label>) — <what it holds, when to reach for it>

## Review Culture
<Recurring reasons PRs get changes requested. One paragraph for a single repo; a short `### <repo>` block each when repos differ meaningfully. Name reviewers where it helps. State plainly if review is light.>

## Where to go for common tasks
- <task shape> → <file or directory>
- <task shape> → <file or directory>

## Standing Instructions
<Hand-written directives preserved verbatim from the existing context.>
```

The "Where to go for common tasks" section is the highest-value part and the easiest to skip. Derive it from what the history actually shows people doing: if forty commits touched `api.ts` alongside a route file, then "adding an endpoint → `src/server/api.ts` + route module" is a real, earned lane. Do not invent lanes for work nobody does.

The failure mode to avoid is reciting the directory tree: it goes stale within weeks and any agent can regenerate it with one `ls`.

### Standing instructions — the one thing you must not lose

Fill this section while drafting, not at save time, by splitting the existing context into two piles.

**Observation** is anything recon could rediscover: layout, hot files, build commands, review themes. Your investigation supersedes it, and replacing it is the entire point of this skill.

**Policy** is hand-written directive that no amount of code reading would ever reveal — "always open non-draft PRs for this repo", "use direnv to commit", "never use Jira, always Linear", "ask before touching production config". Policy carries forward verbatim: not summarized, not reworded, not "cleaned up". Someone typed those lines because something went wrong once, and the reasoning is usually written down nowhere. A paraphrased directive is how it quietly stops being followed.

When the old context interleaves the two in unstructured prose, split at the sentence level rather than judging whole paragraphs — a paragraph about repo layout that ends with "and never run migrations by hand" contains one sentence you must keep. When a sentence is genuinely ambiguous, keep it. A slightly redundant line costs a few tokens; a dropped directive costs an incident.

## Phase 5 — Confirm, warn, save

Never write to `workshop_set_context` without explicit approval in this turn. Track context is the highest-blast-radius field in Workshop — a bad overwrite silently degrades every future session in the track, and the old value is not recoverable through the UI.

1. **Show the draft.** Give the user the file path and a short summary of what recon turned up — especially anything surprising.

2. **Warn about existing context, specifically.** If the track already has context, "this will overwrite it" is not a warning — it is a shrug. Account for the old context line by line and state the result:
   - **Nothing dropped** — say so outright: "all N lines of the existing context are carried forward, M of them verbatim." A clean bill of health is the most reassuring thing you can report, and it is only credible because you checked.
   - **Something dropped** — quote the dropped lines in full and count them, then say why each one goes (superseded by recon, or no longer true). The user cannot consent to a loss they cannot see.

3. **Confirm the standing instructions survived.** Show the `## Standing Instructions` section you assembled in Phase 4 and name where each line came from. Losing one of these is the single worst outcome of this skill, so make it the thing the user's eye lands on rather than something buried in a diff.

4. **Ask, with real options** (`AskUserQuestion`):
   - **Replace** — save the draft as the new context (standing instructions preserved).
   - **Merge** — append the new recon to the existing context, changing nothing that is there.
   - **Edit first** — the user names changes, you revise and re-ask.
   - **Cancel** — leave the track untouched; the draft file stays for reference.

5. **Save** with `mcp__workshop__workshop_set_context(trackId, context)`, then verify with `mcp__workshop__workshop_get_composed_prompt(trackId)` so the user sees what sessions will actually receive.

6. **Offer the vault.** Detail that is genuinely useful but too bulky for a system prompt — full directory maps, per-repo review-comment digests, contributor lists — belongs in the track's Obsidian vault (`workshop_vault_write`), where an agent can read it on demand. Suggest it; do not do it unasked.

## Re-running on a known track

Recon on an already-documented track is a diff, not a rewrite. Read the existing context first and report what *changed* — new hot spots, a review theme that stopped appearing, a build command that moved. Then propose a targeted edit rather than a wholesale replacement. Rewriting a good context from scratch reliably loses accumulated hand-tuning while looking like progress.

Write re-run drafts to a dated filename (`/tmp/track-context-<slug>-<YYYY-MM-DD>.md`) so the previous draft survives alongside it. Having both on disk is what makes the diff you are presenting checkable rather than asserted.
