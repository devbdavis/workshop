import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createScheduledTaskRouter,
  type ScheduledTaskRouterDeps,
} from '@server/scheduled-task-routes.js';
import type { ScheduledTask } from '@foundation/types';

describe('PUT /scheduled-tasks/:id templateName', () => {
  let server: Server;
  let base: string;
  let root: string;
  let task: ScheduledTask;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'sched-routes-'));
    await mkdir(join(root, 'templates', 'schedules'), { recursive: true });
    await writeFile(join(root, 'templates', 'schedules', 'diary.json'), '{}');
    task = { id: 't1', name: 'Diary', enabled: false } as unknown as ScheduledTask;
    const deps = {
      tasks: {
        findById: (id: string) => (id === task.id ? task : null),
        update: (_id: string, patch: Partial<ScheduledTask>) => {
          const defined = Object.fromEntries(
            Object.entries(patch).filter(([, v]) => v !== undefined),
          );
          task = { ...task, ...defined, templateName: defined.templateName || undefined };
          return task;
        },
      },
      runs: {},
      scheduler: { scheduleTask: () => {}, unscheduleTask: () => {} },
      projectRoot: root,
    } as unknown as ScheduledTaskRouterDeps;
    const app = express().use(express.json()).use(createScheduledTaskRouter(deps));
    await new Promise<void>((r) => {
      server = app.listen(0, r);
    });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    server.close();
    await rm(root, { recursive: true, force: true });
  });

  const put = (body: unknown) =>
    fetch(`${base}/scheduled-tasks/t1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('links an existing template, rejects unknown or path-like names, and unlinks with ""', async () => {
    expect((await put({ templateName: 'diary' })).status).toBe(200);
    expect(task.templateName).toBe('diary');
    expect((await put({ templateName: 'nope' })).status).toBe(400);
    expect((await put({ templateName: '../schedules/diary' })).status).toBe(400);
    expect((await put({ templateName: 7 })).status).toBe(400);
    expect(task.templateName).toBe('diary');
    expect((await put({ templateName: '' })).status).toBe(200);
    expect(task.templateName).toBeUndefined();
  });
});

describe('GET /scheduled-tasks/:id/runs', () => {
  it('closes running runs whose session is gone, keeps live ones', async () => {
    const rows = [
      { id: 'live', taskId: 't1', sessionId: 's-live', status: 'running', startedAt: 'a' },
      { id: 'dead', taskId: 't1', sessionId: 's-dead', status: 'running', startedAt: 'a' },
      { id: 'legacy', taskId: 't1', status: 'running', startedAt: 'a' },
    ];
    const completed: [string, string | undefined][] = [];
    const deps = {
      tasks: {},
      runs: {
        findByTask: () => rows,
        complete: (id: string, status: string, _e: unknown, at?: string) => {
          completed.push([id, at]);
          return { ...rows.find((r) => r.id === id), status, completedAt: at };
        },
      },
      sessions: {
        findById: (id: string) =>
          id === 's-live' ? { id } : id === 's-dead' ? { id, deletedAt: 'gone-at' } : null,
      },
      scheduler: {},
      projectRoot: tmpdir(),
    } as unknown as ScheduledTaskRouterDeps;
    const app = express().use(createScheduledTaskRouter(deps));
    const server = await new Promise<Server>((r) => { const s = app.listen(0, () => r(s)); });
    const port = (server.address() as { port: number }).port;
    const body = await (await fetch(`http://127.0.0.1:${port}/scheduled-tasks/t1/runs`)).json();
    server.close();
    expect(body.map((r: { status: string }) => r.status)).toEqual(['running', 'completed', 'completed']);
    expect(completed).toEqual([['dead', 'gone-at'], ['legacy', undefined]]);
  });
});
