import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

const originalHome = process.env.HOME;
const testHome = path.join(os.tmpdir(), `workshop-test-tpl-home-${randomUUID()}`);
const testProject = path.join(os.tmpdir(), `workshop-test-tpl-proj-${randomUUID()}`);

import { ensureAutoInstallAgents } from '@infrastructure/agents/template-installer';

const globalAgentPath = (slug: string) => path.join(testHome, '.claude', 'agents', `${slug}.md`);

function writeTemplate(slug: string, content: string): void {
  const dir = path.join(testProject, 'templates', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}.md`), content, 'utf-8');
}

const PR_REVIEW_TPL = `---
name: pr-review
description: Reviews pull requests.
model: sonnet
autoInstall: true
---

You are the PR review agent.`;

describe('ensureAutoInstallAgents', () => {
  beforeEach(() => {
    process.env.HOME = testHome;
    fs.rmSync(testHome, { recursive: true, force: true });
    fs.rmSync(testProject, { recursive: true, force: true });
    fs.mkdirSync(testHome, { recursive: true });
    fs.mkdirSync(testProject, { recursive: true });
  });

  afterAll(() => {
    process.env.HOME = originalHome;
    fs.rmSync(testHome, { recursive: true, force: true });
    fs.rmSync(testProject, { recursive: true, force: true });
  });

  it('installs autoInstall templates as global agents with template linkage', () => {
    writeTemplate('pr-review', PR_REVIEW_TPL);
    expect(ensureAutoInstallAgents(testProject)).toBe(1);

    const written = fs.readFileSync(globalAgentPath('pr-review'), 'utf-8');
    expect(written).toContain('name: pr-review');
    expect(written).toContain('model: sonnet');
    expect(written).toContain('templateName: pr-review');
    expect(written).toContain('You are the PR review agent.');
  });

  it('skips templates without the autoInstall flag', () => {
    writeTemplate('senior-node-engineer', '---\nname: Senior Node Engineer\ndescription: x\n---\n\nBody.');
    expect(ensureAutoInstallAgents(testProject)).toBe(0);
    expect(fs.existsSync(globalAgentPath('senior-node-engineer'))).toBe(false);
  });

  it('never overwrites an existing global agent', () => {
    writeTemplate('pr-review', PR_REVIEW_TPL);
    fs.mkdirSync(path.dirname(globalAgentPath('pr-review')), { recursive: true });
    fs.writeFileSync(globalAgentPath('pr-review'), 'USER EDITED', 'utf-8');

    expect(ensureAutoInstallAgents(testProject)).toBe(0);
    expect(fs.readFileSync(globalAgentPath('pr-review'), 'utf-8')).toBe('USER EDITED');
  });

  it('is a no-op when the templates dir is missing', () => {
    expect(ensureAutoInstallAgents(path.join(testProject, 'nowhere'))).toBe(0);
  });
});
