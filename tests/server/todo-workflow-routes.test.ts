import { describe, it, expect } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createTodoWorkflowRouter, type TodoWorkflowRouterDeps } from '@server/todo-workflow-routes.js';
import { DEFAULT_AUTONOMOUS_BUDGET } from '@application/workflow/autonomy.js';

async function dispatch(body: Record<string, unknown>) {
  let stateData: Record<string, unknown> = {};
  const deps = {
    todos: { findById: () => ({ id: 'todo-1', title: 'T', trackId: 'track-1' }), update: () => null },
    playbooks: { findByRowId: () => ({}) },
    engine: { createEpic: () => ({ id: 'epic-1', stateData: {} }) },
    issues: {
      update: (_: string, d: any) => { stateData = d.stateData; return { id: 'epic-1', stateData }; },
      findById: () => ({ id: 'epic-1', stateData }),
    },
    coordinator: { dispatchForCurrentState: async () => {} },
    broadcast: () => {},
  } as unknown as TodoWorkflowRouterDeps;
  const app = express();
  app.use(express.json());
  app.use(createTodoWorkflowRouter(deps));
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/todos/todo-1/dispatch-workflow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playbookRowId: 'pb-1', ...body }),
    });
    expect(res.status).toBe(201);
    return stateData;
  } finally {
    server.close();
  }
}

describe('dispatch todo into workflow', () => {
  it('stays gated by default', async () => {
    const sd = await dispatch({});
    expect(sd).toEqual({ todoId: 'todo-1' });
  });

  it('runs autonomous with the default budget when asked', async () => {
    const sd = await dispatch({ autonomous: true });
    expect(sd).toEqual({ todoId: 'todo-1', autonomous: true, autonomousBudget: DEFAULT_AUTONOMOUS_BUDGET });
  });
});
