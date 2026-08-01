import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

const testDbPath = path.join(os.tmpdir(), `workshop-test-wf-budget-${randomUUID()}.db`);
process.env.WORKSHOP_DB_PATH = testDbPath;

import {
  createWorkflowTicketRepository,
  createWorkflowTransitionRepository,
} from '@infrastructure/persistence/workflow-repository';
import { createTicketDependencyRepository } from '@infrastructure/persistence/workflow-dependency-repository';
import { createWorkflowEngine } from '@application/workflow/engine';
import { resetDatabase } from '@infrastructure/persistence/database';
import type { WorkflowTicket } from '@foundation/types';
import type { TopologyLoader } from '@application/workflow/topology-loader';
import type { StageDefinition } from '@domain/workflow/types';

// ---------------------------------------------------------------------------
// Mock topology: a ping/pong agent loop with a manual escape hatch to a human
// gate, so the circuit breaker (iteration-based) never fires and only the
// Dark Factory step budget is exercised.
// ---------------------------------------------------------------------------

const STAGES: StageDefinition[] = [
  { state: 'idea', semanticRole: 'entry', agentActionable: false, humanGate: false, validTransitions: [
    { to: 'ping', trigger: 'manual' },
  ]},
  { state: 'ping', semanticRole: 'processing', agentActionable: true, humanGate: false, validTransitions: [
    { to: 'pong', trigger: 'agent-complete' },
    { to: 'review', trigger: 'manual' },
  ]},
  { state: 'pong', semanticRole: 'processing', agentActionable: true, humanGate: false, validTransitions: [
    { to: 'ping', trigger: 'agent-complete' },
    { to: 'review', trigger: 'manual' },
  ]},
  { state: 'review', semanticRole: 'human-gate', agentActionable: false, humanGate: true, validTransitions: [
    { to: 'done', trigger: 'human-approve' },
  ]},
  { state: 'done', semanticRole: 'terminal', agentActionable: false, humanGate: false, validTransitions: [] },
];

function createMockTopologyLoader(): TopologyLoader {
  return {
    loadForTicket(_ticket: WorkflowTicket): StageDefinition[] {
      return STAGES;
    },
    loadByPlaybookRowId(_rowId: string): StageDefinition[] {
      return STAGES;
    },
    loadPlaybookForTicket(_ticket: WorkflowTicket) {
      return null;
    },
    clearCache(): void {},
  };
}

describe('WorkflowEngine — Dark Factory budget', () => {
  const tickets = createWorkflowTicketRepository();
  const transitions = createWorkflowTransitionRepository();
  const dependencies = createTicketDependencyRepository();
  const topologyLoader = createMockTopologyLoader();
  const engine = createWorkflowEngine({ tickets, transitions, dependencies, topologyLoader });

  afterAll(() => {
    resetDatabase();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it('escalates to the nearest human gate and sets needsHuman when maxSteps is exceeded', () => {
    let epic = engine.createEpic({ title: 'Dark budget epic', description: 'x' });
    epic = tickets.update(epic.id, {
      stateData: { ...(epic.stateData || {}), autonomous: true, autonomousBudget: { maxSteps: 3, maxWallClockMs: 1_000_000 } },
    })!;

    engine.transition(epic.id, 'ping', { type: 'human' }); // step 1
    engine.transition(epic.id, 'pong', { type: 'agent' }); // step 2
    const escalated = engine.transition(epic.id, 'ping', { type: 'agent' }); // step 3 -> budget exhausted

    expect(escalated.state).toBe('review');
    expect(escalated.stateData?.needsHuman).toBe(true);
    expect(escalated.stateData?.stepCount).toBe(3);
  });

  it('sets needsHuman even when the budget is exhausted on a step that already targets the gate', () => {
    let epic = engine.createEpic({ title: 'Dark budget edge', description: 'x' });
    epic = tickets.update(epic.id, {
      stateData: { ...(epic.stateData || {}), autonomous: true, autonomousBudget: { maxSteps: 2, maxWallClockMs: 1_000_000 } },
    })!;

    engine.transition(epic.id, 'ping', { type: 'human' }); // step 1
    // step 2 exhausts the budget AND the manual transition already targets 'review' (the gate),
    // so needsHuman must still be set even though toState isn't redirected.
    const rested = engine.transition(epic.id, 'review', { type: 'human' });

    expect(rested.state).toBe('review');
    expect(rested.stateData?.needsHuman).toBe(true);
  });
});
