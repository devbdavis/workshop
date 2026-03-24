# Workflow Review Skill

Post-implementation review for completed workflow epics.
Tagged: workshop.

## Trigger
Runs after an epic reaches a terminal state (merged or cancelled).

## Behavior

1. Query the epic's full transition history via `workshop_get_workflow_ticket` (which includes transitions)
2. Compute per-state timing from transition timestamps:
   - For each state transition, calculate wall-clock time spent in each state
   - Identify states with unusually long dwell times
3. Identify patterns:
   - **Retry loops**: Same from→to transition appearing > 2 times
   - **Human interventions**: Count of reject transitions
   - **Stuck states**: States where dwell time exceeded reasonable thresholds
   - **Success patterns**: Clean transitions through the workflow
4. Propose template improvements as structured findings:
   - Category: timing, retry-loop, human-intervention, stuck-state, success-pattern
   - Severity: info, warning, actionable
   - For actionable findings, include suggested changes (add-state, remove-state, modify-transition, modify-agent, modify-prompt)
5. Check the template library for:
   - Merge candidates (high similarity, low differentiation between templates)
   - Unused templates (zero usage)
6. Store findings via a new MCP tool or by updating the ticket's stateData

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

Suggested changes match the SuggestedChange schema:
```json
{
  "type": "modify-transition",
  "description": "Lower circuit breaker threshold from 3 to 2 iterations",
  "before": { "maxIterations": 3 },
  "after": { "maxIterations": 2 }
}
```

## Important
- This review is advisory — never blocks the epic
- If the review fails or times out, log a warning and move on
- Analysis covers BOTH epic and task templates if the epic had child tasks
- Never auto-applies changes to templates — store as suggestions for human review
