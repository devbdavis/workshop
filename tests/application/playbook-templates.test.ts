import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { StageDefinitionsSchema } from '@domain/workflow/schemas';
import { validateWorkflowGraph } from '@application/workflow/graph-validator';

const TEMPLATES_DIR = path.resolve(__dirname, '../../templates/playbooks');

const TEMPLATE_FILES = ['new-web-app.json', 'feature-on-existing-repo.json'];

interface IntakeQuestion {
  id: string;
  label: string;
  required: boolean;
  placeholder: string;
}

interface PlaybookTemplate {
  epicPlaybook: unknown;
  intakeQuestions: IntakeQuestion[];
}

function loadTemplate(fileName: string): PlaybookTemplate {
  const raw = fs.readFileSync(path.join(TEMPLATES_DIR, fileName), 'utf-8');
  return JSON.parse(raw) as PlaybookTemplate;
}

describe.each(TEMPLATE_FILES)('playbook template %s', (fileName) => {
  const template = loadTemplate(fileName);

  it('parses epicPlaybook with StageDefinitionsSchema', () => {
    const result = StageDefinitionsSchema.safeParse(template.epicPlaybook);
    expect(result.success).toBe(true);
  });

  it('passes graph validation with no errors', () => {
    const stages = StageDefinitionsSchema.parse(template.epicPlaybook);
    const result = validateWorkflowGraph(stages);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('has exactly one human gate that is not auto-approvable, and it is the final gate before terminal', () => {
    const stages = StageDefinitionsSchema.parse(template.epicPlaybook);
    const humanGates = stages.filter((s) => s.humanGate === true);
    const nonAutoApprovable = humanGates.filter((s) => s.autoApprovable === false);

    expect(nonAutoApprovable).toHaveLength(1);

    const finalGate = nonAutoApprovable[0];
    const terminalStates = new Set(
      stages.filter((s) => s.validTransitions.length === 0).map((s) => s.state),
    );
    const leadsToTerminal = finalGate.validTransitions.some((t) => terminalStates.has(t.to));
    expect(leadsToTerminal).toBe(true);

    // Every other human gate must be auto-approvable (omitted defaults to allowed).
    for (const gate of humanGates) {
      if (gate.state === finalGate.state) continue;
      expect(gate.autoApprovable).not.toBe(false);
    }
  });

  it('has an entry state and a reachable terminal state', () => {
    const stages = StageDefinitionsSchema.parse(template.epicPlaybook);
    expect(stages[0].semanticRole).toBe('entry');
    const terminalStates = stages.filter((s) => s.validTransitions.length === 0);
    expect(terminalStates.length).toBeGreaterThan(0);
    expect(terminalStates.some((s) => s.semanticRole === 'terminal')).toBe(true);
  });

  it('has a non-empty intakeQuestions array with required fields', () => {
    expect(Array.isArray(template.intakeQuestions)).toBe(true);
    expect(template.intakeQuestions.length).toBeGreaterThan(0);
    for (const question of template.intakeQuestions) {
      expect(typeof question.id).toBe('string');
      expect(question.id.length).toBeGreaterThan(0);
      expect(typeof question.label).toBe('string');
      expect(question.label.length).toBeGreaterThan(0);
      expect(typeof question.required).toBe('boolean');
      expect(typeof question.placeholder).toBe('string');
    }
  });
});
