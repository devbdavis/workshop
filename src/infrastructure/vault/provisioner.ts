import fs from 'fs';
import path from 'path';
import { trackVaultPath } from './utils.js';

export interface VaultProvisioner {
  /** Create vault folder for a track with starter files. Idempotent — does not overwrite existing files. */
  provisionTrack(trackSlug: string, trackName: string): void;
  /** Check if a track's vault folder already exists. */
  isProvisioned(trackSlug: string): boolean;
  /** Seed Workshop/General/ with playbook design patterns. Idempotent. */
  seedPlaybookPatterns(): void;
}

function frontmatter(fields: Record<string, string>): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: "${v}"`);
  return `---\n${lines.join('\n')}\n---`;
}

export function createVaultProvisioner(vaultRoot: string): VaultProvisioner {
  return {
    provisionTrack(trackSlug: string, trackName: string): void {
      const trackDir = trackVaultPath(vaultRoot, trackSlug);
      fs.mkdirSync(trackDir, { recursive: true });

      const now = new Date().toISOString().slice(0, 10);

      const files: Record<string, string> = {
        '_overview.md': [
          frontmatter({
            title: `${trackName} - Overview`,
            type: 'workshop-overview',
            track: trackSlug,
            created: now,
            last_updated: now,
          }),
          '',
          '',
        ].join('\n'),

        'decisions.md': [
          frontmatter({
            title: `${trackName} - Decisions`,
            type: 'workshop-decisions',
            track: trackSlug,
            created: now,
            last_updated: now,
          }),
          '',
          '# Decisions',
          '',
        ].join('\n'),

        'learnings.md': [
          frontmatter({
            title: `${trackName} - Learnings`,
            type: 'workshop-learnings',
            track: trackSlug,
            created: now,
            last_updated: now,
          }),
          '',
          '# Learnings',
          '',
        ].join('\n'),

        'progress.md': [
          frontmatter({
            title: `${trackName} - Progress`,
            type: 'workshop-progress',
            track: trackSlug,
            created: now,
            last_updated: now,
          }),
          '',
          '# Progress',
          '',
        ].join('\n'),
      };

      for (const [fileName, content] of Object.entries(files)) {
        const filePath = path.join(trackDir, fileName);
        // Do NOT overwrite existing files (idempotent)
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, content, 'utf-8');
        }
      }
    },

    isProvisioned(trackSlug: string): boolean {
      const trackDir = trackVaultPath(vaultRoot, trackSlug);
      return fs.existsSync(trackDir);
    },

    seedPlaybookPatterns(): void {
      const generalDir = path.join(vaultRoot, 'Workshop', 'General');
      fs.mkdirSync(generalDir, { recursive: true });

      const patternsFile = path.join(generalDir, 'playbook-patterns.md');
      if (fs.existsSync(patternsFile)) return; // idempotent

      const content = `# Playbook Design Patterns

Heuristics for designing effective workflow playbooks. The playbook designer agent
should consult these when creating or selecting playbooks for new epics.

## 1. Generator-Evaluator Separation

When a task involves subjective quality (UI, writing, architecture decisions),
include an **independent evaluator agent** stage after execution. Self-evaluation
produces systematic bias — agents tend to praise their own work even when quality
is mediocre. The evaluator should receive the original spec and plan, NOT the
executor's self-report.

**When to apply:** Tasks with subjective output, multi-file changes, or user-facing work.
**When to skip:** Purely mechanical tasks (formatting, dependency bumps, single-file fixes).

## 2. Testable Acceptance Criteria

Before execution begins, the plan should include **explicit, testable acceptance
criteria** — not just a description of what to build, but how to verify it worked.
These criteria should be available to both the executor and any post-execution
evaluator.

**How to apply:** Have the planning stage produce a "contract" section listing
specific success criteria. Store in stateData so downstream agents can reference it.

## 3. Context Management

Fresh agent contexts prevent coherence degradation in long tasks. Use the
orchestrator-delegates-to-sub-agents pattern for complex work — each sub-agent
gets a focused slice of the plan with a fresh context window.

**When to decompose:** Tasks estimated at >30 minutes of agent work, or touching >5 files.
**When to keep single-agent:** Small focused changes, single-file edits, quick fixes.

## 4. Weighted Evaluation

When evaluating output, weight criteria **inversely to model capability**:
- **High weight:** Architecture decisions, edge case handling, integration correctness,
  security implications (where agents struggle)
- **Lower weight:** Code compiles, tests pass, formatting, syntax (where agents excel)

## 5. Stage Pruning — Every Stage Must Be Load-Bearing

Every stage in a playbook should demonstrably improve the outcome. If a stage
consistently passes without finding issues or changing direction, it's overhead.
Post-execution reviews should flag non-load-bearing stages for removal.

**Signs of overhead:** Critic/review stages that never produce blocking findings,
gates that are always approved without changes, stages with <1 min dwell time.

## 6. Circuit Breaker Calibration

Agent loops (planning ↔ critique cycles) should be bounded. The default circuit
breaker (3 iterations → escalate to human) works for most cases, but:
- Lower to 2 for advisory-only stages (triage, critique)
- Raise to 4-5 for execution stages where retry is cheap

## 7. Lightweight Paths

Not every task needs a full pipeline. For trivial work (doc updates, config
changes, single-file fixes), use a 2-3 state playbook:
\`\`\`
ready → implementing → done
\`\`\`
Over-engineering the workflow for simple tasks adds latency without improving quality.

## 8. Human Gate Placement

Human gates add value at **high-stakes decision points** (architecture, API design,
security-sensitive changes). They add overhead at mechanical checkpoints. Place
gates where the cost of a wrong decision is high, not at every stage boundary.
`;

      fs.writeFileSync(patternsFile, content, 'utf-8');
    },
  };
}
