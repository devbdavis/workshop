#!/usr/bin/env node
/*
 * Workaround for microsoft/node-pty#850 — the published npm tarball for
 * node-pty@1.1.0 ships the per-platform `spawn-helper` binary with 0644
 * permissions instead of 0755.  npm 11 (and pnpm) preserve the tarball
 * permissions on install, so the helper ends up non-executable and every
 * call to `pty.spawn(...)` fails with the cryptic `posix_spawnp failed`
 * error — no stderr, no errno detail.
 *
 * This script chmods every prebuilt `spawn-helper` to 0755 after install.
 * It's idempotent, only touches unix prebuilds, and skips silently when
 * node-pty isn't installed (so it's safe to keep wired up if the dep is
 * later removed).
 *
 * Reference: https://github.com/microsoft/node-pty/issues/850
 */

const fs = require('node:fs');
const path = require('node:path');

const PREBUILD_ROOT = path.resolve(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds');

if (!fs.existsSync(PREBUILD_ROOT)) {
  // node-pty isn't installed (or installed without prebuilds) — nothing to fix.
  process.exit(0);
}

let fixed = 0;
for (const entry of fs.readdirSync(PREBUILD_ROOT)) {
  // win32-* prebuilds use winpty-agent.exe, not spawn-helper.
  if (entry.startsWith('win32-')) continue;
  const helper = path.join(PREBUILD_ROOT, entry, 'spawn-helper');
  if (!fs.existsSync(helper)) continue;
  const mode = fs.statSync(helper).mode & 0o777;
  if (mode === 0o755) continue;
  fs.chmodSync(helper, 0o755);
  fixed++;
}

if (fixed > 0) {
  console.log(`fix-node-pty-permissions: chmod 755 on ${fixed} spawn-helper binar${fixed === 1 ? 'y' : 'ies'}`);
}
