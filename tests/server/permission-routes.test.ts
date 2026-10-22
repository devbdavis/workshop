import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testDbPath = path.join(os.tmpdir(), `workshop-test-permissions-${randomUUID()}.db`);
process.env.WORKSHOP_DB_PATH = testDbPath;
import { resetDatabase } from '@infrastructure/persistence/database';
import { createPermissionRepository } from '@infrastructure/persistence/permission-repository';
import { createPermissionService } from '@application/permissions/permission-service';
import { createPermissionRouter } from '@server/permission-routes.js';

describe('permission routes (real sqlite)', () => {
  let server: Server;
  let base: string;
  const hdr = { 'content-type': 'application/json', 'x-workshop-session': 's1' };

  beforeAll(async () => {
    resetDatabase();
    const repo = createPermissionRepository();
    const service = createPermissionService({
      repo,
      broadcast: () => {},
      resolveTask: () => ({ trackId: null, taskName: 'T' }),
    });
    const app = express();
    app.use(express.json());
    app.use('/api', createPermissionRouter({ repo, service }));
    await new Promise<void>((r) => {
      server = app.listen(0, r);
    });
    base = `http://127.0.0.1:${(server.address() as any).port}/api/permissions`;
  });
  afterAll(() => {
    server.close();
    resetDatabase();
    fs.rmSync(testDbPath, { force: true });
  });

  it('holds a request until decided, then auto-approves the next via the rule', async () => {
    const body = JSON.stringify({
      harness: 'codex',
      toolName: 'shell',
      toolInput: { command: 'gh pr create --draft' },
    });
    const held = fetch(`${base}/requests`, { method: 'POST', headers: hdr, body }).then((r) =>
      r.json(),
    );
    let pending: any[] = [];
    while (!pending.length) {
      pending = await (await fetch(`${base}/requests?status=pending`)).json();
    }
    expect(pending[0].suggestedPattern).toBe('gh pr create');
    const d = await fetch(`${base}/requests/${pending[0].id}/decide`, {
      method: 'POST',
      headers: hdr,
      body: JSON.stringify({ decision: 'allow', always: true }),
    });
    expect(d.status).toBe(200);
    expect(await held).toEqual({ decision: 'allow' });
    expect(
      await (await fetch(`${base}/requests`, { method: 'POST', headers: hdr, body })).json(),
    ).toEqual({ decision: 'allow' });
    expect((await fetch(`${base}/rules`).then((r) => r.json())).length).toBe(1);
  });

  it('validates input', async () => {
    const r = await fetch(`${base}/requests`, {
      method: 'POST',
      headers: hdr,
      body: JSON.stringify({ harness: 'x', toolName: 'a' }),
    });
    expect(r.status).toBe(400);
  });
});
