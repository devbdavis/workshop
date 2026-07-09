import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { createClaudePluginInstaller } from '@infrastructure/plugins/claude-plugin-installer';

/**
 * Tests run against a fake `claude` shim placed first on PATH. The shim's
 * behavior is driven by a mode file so each test can reconfigure it.
 */
const shimDir = path.join(os.tmpdir(), `workshop-test-claude-shim-${randomUUID()}`);
const modeFile = path.join(shimDir, 'mode');
const originalPath = process.env.PATH;

const SHIM = `#!/bin/bash
MODE=$(cat ${JSON.stringify(modeFile)})
case "$MODE" in
  no-plugin-support)
    if [ "$1" = "plugin" ]; then echo "unknown command: plugin" >&2; exit 1; fi
    exit 0 ;;
  installed)
    if [ "$1 $2" = "plugin list" ]; then echo '[{"id":"ponytail@ponytail","enabled":true}]'; exit 0; fi
    exit 0 ;;
  empty-ok)
    if [ "$1 $2" = "plugin list" ]; then echo '[]'; exit 0; fi
    exit 0 ;;
  already)
    if [ "$1 $2" = "plugin list" ]; then echo '[]'; exit 0; fi
    if [ "$1 $2" = "plugin install" ] || [ "$2 $3" = "marketplace add" ]; then echo "Error: already installed" >&2; exit 1; fi
    exit 0 ;;
  fail)
    if [ "$1 $2" = "plugin list" ]; then echo '[]'; exit 0; fi
    if [ "$1" = "plugin" ] && [ "$2" != "--help" ]; then echo "network error: could not clone" >&2; exit 1; fi
    exit 0 ;;
  *)
    exit 0 ;;
esac
`;

function setMode(mode: string): void {
  fs.writeFileSync(modeFile, mode, 'utf-8');
}

describe('claude-plugin-installer', () => {
  beforeAll(() => {
    fs.mkdirSync(shimDir, { recursive: true });
    const shimPath = path.join(shimDir, 'claude');
    fs.writeFileSync(shimPath, SHIM, 'utf-8');
    fs.chmodSync(shimPath, 0o755);
    process.env.PATH = `${shimDir}:${originalPath}`;
  });

  afterAll(() => {
    process.env.PATH = originalPath;
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('isAvailable is false when the CLI lacks plugin subcommands', async () => {
    setMode('no-plugin-support');
    expect(await createClaudePluginInstaller().isAvailable()).toBe(false);
  });

  it('isAvailable is true when plugin --help succeeds', async () => {
    setMode('empty-ok');
    expect(await createClaudePluginInstaller().isAvailable()).toBe(true);
  });

  it('reports already-installed plugins as success without reinstalling', async () => {
    setMode('installed');
    const result = await createClaudePluginInstaller().ensureInstalled('ponytail@ponytail', 'DietrichGebert/ponytail');
    expect(result.success).toBe(true);
    expect(result.message).toContain('already installed');
  });

  it('installs when not present and reports success', async () => {
    setMode('empty-ok');
    const result = await createClaudePluginInstaller().ensureInstalled('ponytail@ponytail', 'DietrichGebert/ponytail');
    expect(result.success).toBe(true);
  });

  it('treats "already" errors as success', async () => {
    setMode('already');
    const installer = createClaudePluginInstaller();
    expect((await installer.ensureMarketplaceAdded('DietrichGebert/ponytail')).success).toBe(true);
    expect((await installer.ensureInstalled('ponytail@ponytail', 'DietrichGebert/ponytail')).success).toBe(true);
  });

  it('reports real failures without throwing', async () => {
    setMode('fail');
    const installer = createClaudePluginInstaller();
    const marketplace = await installer.ensureMarketplaceAdded('DietrichGebert/ponytail');
    expect(marketplace.success).toBe(false);
    expect(marketplace.message).toContain('network error');
    const install = await installer.ensureInstalled('ponytail@ponytail', 'DietrichGebert/ponytail');
    expect(install.success).toBe(false);
  });
});
