import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { createTodoRouter, type TodoRouterDeps } from '@server/todo-routes.js';

// Exercises the "create issue" round-trip: dispatch seeds a pending job,
// the report endpoint marks it done + links the issue key, and status reflects it.
// Also guards route ordering (POST /todos/report-issue must not be
// captured by the /todos/:todoId/... routes).

function buildApp() {
  const todoStore = new Map<string, any>([
    ['todo-1', { id: 'todo-1', trackId: 'track-1', title: 'Add dedup', status: 'backlog' }],
  ]);
  const trackStore = new Map<string, any>([['track-1', { id: 'track-1' }]]);
  const settingsStore = new Map<string, string>();
  let createdSessions = 0;
  const prompts: string[] = [];

  const deps = {
    todos: {
      findById: (id: string) => todoStore.get(id) ?? null,
      update: (id: string, data: any) => {
        const next = { ...todoStore.get(id), ...data };
        todoStore.set(id, next);
        return next;
      },
    },
    tracks: {
      findById: (id: string) => trackStore.get(id) ?? null,
      create: (d: any) => {
        const t = { id: 'sys-track', ...d };
        trackStore.set(t.id, t);
        return t;
      },
    },
    settings: {
      get: (k: string) => settingsStore.get(k) ?? null,
      set: (k: string, v: string) => settingsStore.set(k, v),
    },
    terminal: {
      createSession: async (_t: string, opts: any) => {
        createdSessions += 1;
        prompts.push(opts.initialPrompt);
        return { id: 'sess-1', trackId: 'sys-track', tmuxSession: 't', state: 'active' };
      },
    },
  } as unknown as TodoRouterDeps;

  const app = express();
  app.use(express.json());
  app.use(createTodoRouter(deps));
  return { app, todoStore, settingsStore, prompts, sessions: () => createdSessions };
}

describe('create-issue round-trip', () => {
  let server: Server;
  let base: string;
  let ctx: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    ctx = buildApp();
    server = ctx.app.listen(0);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('dispatches onto a lazily-created system track and seeds a pending job', async () => {
    const res = await fetch(`${base}/todos/todo-1/create-issue`, { method: 'POST' });
    expect(res.status).toBe(201);
    expect(ctx.sessions()).toBe(1);
    expect(ctx.settingsStore.get('linear_ticket_track_id')).toBe('sys-track');

    const status = await (await fetch(`${base}/todos/todo-1/issue-status`)).json();
    expect(status.status).toBe('pending');
  });

  it('records the reported issue and links the issue key to the todo', async () => {
    const report = await fetch(`${base}/todos/report-issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        todoId: 'todo-1',
        issueKey: 'ASY-1402',
        url: 'https://linear.app/x/issue/ASY-1402',
        title: 'Add dedup',
        body: '## Description\n...',
      }),
    });
    expect(report.status).toBe(200);

    const status = await (await fetch(`${base}/todos/todo-1/issue-status`)).json();
    expect(status).toMatchObject({
      status: 'done',
      issueKey: 'ASY-1402',
      url: 'https://linear.app/x/issue/ASY-1402',
      title: 'Add dedup',
    });
    // issue key written back onto the todo
    expect(ctx.todoStore.get('todo-1').issueKey).toBe('ASY-1402');
  });

  it('rejects a report with no todoId', async () => {
    const res = await fetch(`${base}/todos/report-issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueKey: 'ASY-9' }),
    });
    expect(res.status).toBe(400);
  });

  it('files a GitHub issue in the confirmed repo with the confirmed labels', async () => {
    ctx.settingsStore.set('issue_tracker', 'github');
    ctx.settingsStore.set('issue_tracker_github_repo', 'default/repo');
    const res = await fetch(`${base}/todos/todo-1/create-issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'me/other', labels: ['bug', 'good first issue'] }),
    });
    expect(res.status).toBe(201);
    const prompt = ctx.prompts.at(-1)!;
    expect(prompt).toContain(
      'gh issue create --repo me/other --assignee @me --label "bug" --label "good first issue"',
    );
    expect(prompt).not.toContain('/linear');
  });

  it('falls back to the default repo and labels from settings', async () => {
    ctx.settingsStore.set('issue_tracker', 'github');
    ctx.settingsStore.set('issue_tracker_github_repo', 'default/repo');
    ctx.settingsStore.set('issue_tracker_github_labels', 'triage, ui');
    const res = await fetch(`${base}/todos/todo-1/create-issue`, { method: 'POST' });
    expect(res.status).toBe(201);
    expect(ctx.prompts.at(-1)).toContain('--repo default/repo --assignee @me --label "triage" --label "ui"');
  });

  it('rejects a malformed repo or a shell-unsafe label', async () => {
    ctx.settingsStore.set('issue_tracker', 'github');
    const post = (body: unknown) =>
      fetch(`${base}/todos/todo-1/create-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await post({ repo: 'not a repo; rm -rf /' })).status).toBe(400);
    expect((await post({ repo: 'me/repo', labels: ['x" && echo pwned "'] })).status).toBe(400);
  });
});
