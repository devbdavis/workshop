import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPermissionService } from '@application/permissions/permission-service';
import type { PermissionRepository } from '@domain/permissions/repository';

function fakeRepo(): PermissionRepository {
  const reqs: any[] = [];
  const rules: any[] = [];
  let n = 0;
  return {
    createRequest: (d) => {
      const r = { ...d, id: `r${++n}`, createdAt: 'now' };
      reqs.push(r);
      return r as any;
    },
    findRequestById: (id) => reqs.find((r) => r.id === id) ?? null,
    listRequests: () => reqs,
    updateRequestStatus: (id, status, ruleId) => {
      const r = reqs.find((x) => x.id === id);
      Object.assign(r, { status, ...(ruleId ? { ruleId } : {}) });
      return r;
    },
    listRules: () => rules,
    findRuleById: (id) => rules.find((r) => r.id === id) ?? null,
    createRule: (d) => {
      const r = { ...d, id: `u${++n}`, createdAt: 'now' };
      rules.push(r);
      return r as any;
    },
    deleteRule: () => true,
  };
}

function setup(opts: { timeoutMs?: number } = {}) {
  const repo = fakeRepo();
  const broadcast = vi.fn();
  const service = createPermissionService({
    repo,
    broadcast,
    resolveTask: () => ({ trackId: 't1' as any, taskName: 'Task' }),
    ...opts,
  });
  return { repo, broadcast, service };
}

const S = 's1' as any;
const input = (command: string, harness: 'claude' | 'codex' = 'claude') => ({
  sessionId: S,
  harness,
  toolName: 'Bash',
  toolInput: { command },
});

afterEach(() => vi.useRealTimers());

describe('permission service', () => {
  it('auto-allows and auto-declines via rules (deny first)', async () => {
    const { repo, service } = setup();
    repo.createRule({ toolName: 'shell', pattern: 'git push', decision: 'allow' });
    repo.createRule({ toolName: 'shell', pattern: 'git push --force', decision: 'deny' });
    expect(await service.submit(input('git push origin')).result).toBe('allow');
    expect(await service.submit(input('git push --force x')).result).toBe('deny');
    expect(repo.listRequests({ limit: 9 }).map((r) => r.status)).toEqual([
      'auto-approved',
      'auto-declined',
    ]);
  });

  it('holds a pending request until decided; always creates a rule', async () => {
    const { repo, service } = setup();
    const { id, result } = service.submit(input('gh pr create --draft'));
    const out: any = service.decide(id as any, { decision: 'allow', always: true });
    expect(await result).toBe('allow');
    expect(out.rule).toMatchObject({
      toolName: 'shell',
      pattern: 'gh pr create',
      decision: 'allow',
    });
    expect(repo.findRequestById(id as any)).toMatchObject({
      status: 'approved',
      ruleId: out.rule.id,
    });
    expect(service.decide(id as any, { decision: 'deny' })).toEqual({ error: 'not-pending' });
    expect(service.decide('nope' as any, { decision: 'deny' })).toEqual({ error: 'not-found' });
  });

  it('rejects an always shell rule with an empty pattern', () => {
    const { service } = setup();
    const { id } = service.submit(input('"quoted"'));
    expect(service.decide(id as any, { decision: 'allow', always: true })).toEqual({
      error: 'bad-pattern',
    });
  });

  it('expires on timeout and on client disconnect', async () => {
    vi.useFakeTimers();
    const { repo, service, broadcast } = setup({ timeoutMs: 1000 });
    const a = service.submit(input('ls a'));
    vi.advanceTimersByTime(1000);
    expect(await a.result).toBe('none');
    expect(repo.findRequestById(a.id as any)?.status).toBe('expired');
    const b = service.submit(input('ls b'));
    service.expire(b.id!);
    expect(await b.result).toBe('none');
    expect(broadcast).toHaveBeenCalledWith('permission:decided', 't1', expect.anything());
  });

  it('grant is consumed once by check; claude retry guard returns none', async () => {
    const { service } = setup();
    const { id } = service.submit(input('make deploy'));
    service.decide(id as any, { decision: 'allow' });
    expect(service.check(S, 'Bash', { command: 'make deploy' })).toBe('allow');
    expect(service.check(S, 'Bash', { command: 'make deploy' })).toBe('none');

    const second = service.submit(input('make test'));
    service.decide(second.id as any, { decision: 'allow' });
    // Auto mode blocked the retry anyway: don't prompt again.
    expect(await service.submit(input('make test')).result).toBe('none');
  });

  it('retry blocked after check allowed it does not loop, for approvals and allow rules', async () => {
    const { repo, service } = setup();
    const { id } = service.submit(input('make deploy'));
    service.decide(id as any, { decision: 'allow' });
    expect(service.check(S, 'Bash', { command: 'make deploy' })).toBe('allow');
    expect(await service.submit(input('make deploy')).result).toBe('none');

    repo.createRule({ toolName: 'shell', pattern: 'npm run', decision: 'allow' });
    expect(await service.submit(input('npm run x')).result).toBe('allow');
    expect(service.check(S, 'Bash', { command: 'npm run x' })).toBe('allow');
    expect(await service.submit(input('npm run x')).result).toBe('none');
  });

  it('check never denies and honors allow rules only', () => {
    const { repo, service } = setup();
    repo.createRule({ toolName: 'shell', pattern: 'rm', decision: 'deny' });
    expect(service.check(S, 'Bash', { command: 'rm x' })).toBe('none');
    repo.createRule({ toolName: 'shell', pattern: 'ls', decision: 'allow' });
    expect(service.check(S, 'Bash', { command: 'ls -la' })).toBe('allow');
  });
});
