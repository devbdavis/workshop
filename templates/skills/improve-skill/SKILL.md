---
name: improve-skill
description: Apply a targeted improvement to an existing Claude Code skill. Use when the user says something like "/skill-improve /<skill-name> <feedback>" or asks to update, fix, or change how an existing skill behaves.
---

# Improve Skill

Apply a targeted improvement to an existing Claude Code skill based on user feedback.

## Invocation

Expected form:
```
/skill-improve /<skill-name> <improvement description>
```

Examples:
- `/skill-improve /complete use the mcp to append instead of update so your comment is added`
- `/skill-improve /pr-review also check for missing tests on new public functions`

## Steps

1. **Parse the arguments** — Extract the target skill name (the `/<skill-name>` token, without the slash) and the improvement description (everything after it).

2. **Locate the skill file** — Skills live at `~/.claude/skills/<skill-name>/SKILL.md`. Check that path first. If not found, also check `skills/<skill-name>/SKILL.md` relative to the current working directory (workshop repo convention).

3. **Read the current skill** — Use the Read tool to load the full skill content. Understand what it currently does before making changes.

4. **Apply the improvement** — Make the minimal, focused change that satisfies the feedback. Preserve the existing structure, tone, and intent of the skill. Do not rewrite sections unrelated to the feedback. Improvements should be surgical.

5. **Write the updated skill** — Use the Edit tool (preferred) or Write tool to save the changes back to the same path.

6. **Report the change** — Summarize in 1-3 sentences what you changed and why, so the user can verify intent was captured correctly.

## Notes

- If the skill name cannot be determined from the arguments, ask the user to clarify.
- If the skill file does not exist at either expected path, list available skills with `ls ~/.claude/skills/` and ask the user to confirm the name.
- Skills are markdown with YAML frontmatter — preserve existing frontmatter fields (`name`, `description`, etc.) unless the improvement explicitly targets them. If the skill is missing a frontmatter block entirely, add one with `name` (the skill directory name) and a concise `description` (what the skill does and when to invoke it).
- If the improvement is ambiguous, make your best interpretation and state your assumption in the report so the user can correct it.