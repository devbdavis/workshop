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

  it('runs four sequential review gates, each with a model and a fix state that returns to it', () => {
    const stages = StageDefinitionsSchema.parse(template.epicPlaybook);
    const stageMap = new Map(stages.map((s) => [s.state, s]));

    const gates = ['acceptance-review', 'code-quality-review', 'architecture-review', 'ux-review'];

    for (const gateName of gates) {
      const gate = stageMap.get(gateName);
      expect(gate).toBeDefined();
      expect(gate!.agentActionable).toBe(true);
      expect(gate!.humanGate).toBe(false);
      expect(gate!.agentRoleId).toBeTruthy();
      expect(gate!.model).toBeTruthy();

      const fixName = `${gateName.replace('-review', '')}-fix`;
      const fixState = stageMap.get(fixName);
      expect(fixState).toBeDefined();
      expect(fixState!.agentActionable).toBe(true);
      expect(fixState!.validTransitions.some((t) => t.to === gateName)).toBe(true);
    }

    // Order: execute -> acceptance-review -> code-quality-review -> architecture-review -> ux-review -> final-review
    const execute = stageMap.get('execute');
    expect(execute!.validTransitions.some((t) => t.to === 'acceptance-review')).toBe(true);
    expect(stageMap.get('acceptance-review')!.validTransitions.some((t) => t.to === 'code-quality-review')).toBe(true);
    expect(stageMap.get('code-quality-review')!.validTransitions.some((t) => t.to === 'architecture-review')).toBe(true);
    expect(stageMap.get('architecture-review')!.validTransitions.some((t) => t.to === 'ux-review')).toBe(true);
    expect(stageMap.get('ux-review')!.validTransitions.some((t) => t.to === 'final-review')).toBe(true);
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
