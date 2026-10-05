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
