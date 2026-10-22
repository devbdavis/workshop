# Workflow Review Skill

Post-implementation review for completed workflow epics. Evaluates both the task
outcome and the playbook's effectiveness, feeding learnings back for future designs.
Tagged: workshop.

## Trigger
Runs after an epic reaches a terminal state (merged or cancelled).

## Behavior

### Part 1: Transition Analysis

1. Query the epic's full transition history via `workshop_get_workflow_issue` (which includes transitions)
2. Compute per-state timing from transition timestamps:
   - For each state transition, calculate wall-clock time spent in each state
   - Identify states with unusually long dwell times
3. Identify patterns:
   - **Retry loops**: Same from→to transition appearing > 2 times
   - **Human interventions**: Count of reject transitions
   - **Stuck states**: States where dwell time exceeded reasonable thresholds
   - **Success patterns**: Clean transitions through the workflow

### Part 2: Playbook Effectiveness Evaluation

4. For each stage in the playbook, assess whether it was **load-bearing**:
   - Did the stage change the direction or improve the output?
   - Or did it pass through without meaningful findings/changes?
   - Stages with <1 min dwell time and no state changes are likely overhead
5. Assess **agent role fitness** per stage:
   - Was the agent role's capability tier appropriate? (advisory agent asked to modify code?)
   - Were the prompt/constraints sufficient for the task?
   - Did the agent loop or get stuck due to unclear instructions?
6. Evaluate **gate value**:
   - Were human gates rubber-stamped (approved without changes)?
   - Or did they catch real issues that changed the outcome?
7. Check if **generator-evaluator separation** would have helped:
   - Did the executor self-evaluate and miss issues found later?
   - Would an independent evaluator have caught problems earlier?

### Part 3: Findings and Feedback Loop

8. Propose playbook improvements as structured findings:
   - Category: timing, retry-loop, human-intervention, stuck-state, success-pattern, **overhead-stage**, **role-fitness**, **missing-stage**
   - Severity: info, warning, actionable
   - For actionable findings, include suggested changes (add-state, remove-state, modify-transition, modify-agent, modify-prompt)
9. Check the playbook library for:
   - Merge candidates (high similarity, low differentiation between playbooks)
   - Unused playbooks (zero usage)
10. **Write learnings to the global vault** via `workshop_vault_append`:
    ```
    workshop_vault_append({
      path: "General/playbook-learnings.md",
      content: "### [date] Review of [epic-title] (playbook: [playbook-name])\n\n[structured findings summary]\n\n**Load-bearing stages:** [list]\n**Overhead stages:** [list]\n**Role fitness issues:** [list]\n**Recommended changes:** [list]\n"
    })
    ```
11. If agent role definitions were poorly fitting, note specific improvement suggestions
    in the learnings so the playbook designer can create better role definitions next time

## Output Format

Structure findings as JSON matching the ReviewFinding schema:
```json
{
  "category": "retry-loop",
  "description": "planning ↔ plan-critique cycled 4 times before human escalation",
  "severity": "actionable",
  "stateRef": "plan-critique"
}
```

```json
{
  "category": "overhead-stage",
  "description": "triage stage completed in <30s with no findings — task was well-specified from the start",
  "severity": "actionable",
  "stateRef": "triaging"
}
```

```json
{
  "category": "role-fitness",
  "description": "executor agent self-evaluated and reported success, but integration review found 3 failing tests — consider adding independent evaluator stage",
  "severity": "actionable",
  "stateRef": "executing"
}
```

Suggested changes match the SuggestedChange schema:
```json
{
  "type": "modify-transition",
  "description": "Lower circuit breaker threshold from 3 to 2 iterations",
  "before": { "maxIterations": 3 },
  "after": { "maxIterations": 2 }
}
```

```json
{
  "type": "add-state",
  "description": "Add independent evaluation stage between execution and final-review for tasks with subjective output",
  "after": {
    "state": "evaluation",
    "semanticRole": "processing",
    "agentActionable": true,
    "agentRoleId": "evaluator-agent"
  }
}
```

## Important
- This review is advisory — never blocks the epic
- If the review fails or times out, log a warning and move on
- Analysis covers BOTH epic and task playbooks if the epic had child tasks
- Never auto-applies changes to playbooks — store as suggestions for human review
- **Always append findings to `Workshop/General/playbook-learnings.md`** so future playbook designs benefit from this experience
