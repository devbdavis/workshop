import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { Plugin, PluginId } from '@foundation/types';

const originalHome = process.env.HOME;
const testHome = path.join(os.tmpdir(), `workshop-test-rules-${randomUUID()}`);

import { readAgentsRules, writeCodexGlobalRules, pluginCloneDir, detectCloneProviders } from '@infrastructure/plugins/rules-writer';

const codexAgentsPath = () => path.join(testHome, '.codex', 'AGENTS.md');

function makePlugin(marketplaceRepo: string, pluginName: string): Plugin {
  return {
    id: randomUUID() as PluginId,
    marketplaceRepo,
    pluginName,
    enabled: true,
    createdAt: '',
    updatedAt: '',
  };
}

function writeCloneFile(marketplaceRepo: string, relPath: string, content: string): void {
  const dir = pluginCloneDir(marketplaceRepo);
  fs.mkdirSync(path.join(dir, path.dirname(relPath)), { recursive: true });
  fs.writeFileSync(path.join(dir, relPath), content, 'utf-8');
}

describe('rules-writer', () => {
  beforeEach(() => {
    process.env.HOME = testHome;
    fs.rmSync(testHome, { recursive: true, force: true });
    fs.mkdirSync(testHome, { recursive: true });
  });

  afterAll(() => {
    process.env.HOME = originalHome;
    fs.rmSync(testHome, { recursive: true, force: true });
  });

  describe('readAgentsRules', () => {
    it('concatenates AGENTS.md from plugin clones', () => {
      writeCloneFile('a/one', 'AGENTS.md', '# One rules');
      writeCloneFile('b/two', 'AGENTS.md', '# Two rules');
      const rules = readAgentsRules([makePlugin('a/one', 'one@a'), makePlugin('b/two', 'two@b')]);
      expect(rules).toContain('# One rules');
      expect(rules).toContain('# Two rules');
    });

    it('skips plugins without AGENTS.md and returns null when none ship rules', () => {
      writeCloneFile('a/bare', 'README.md', 'no rules here');
      expect(readAgentsRules([makePlugin('a/bare', 'bare@a')])).toBeNull();
      expect(readAgentsRules([])).toBeNull();
    });
  });

  describe('detectCloneProviders', () => {
    it('detects markers in the clone', () => {
      writeCloneFile('a/full', 'AGENTS.md', 'rules');
      writeCloneFile('a/full', 'gemini-extension.json', '{}');
      fs.mkdirSync(path.join(pluginCloneDir('a/full'), '.claude-plugin'), { recursive: true });
      expect(detectCloneProviders('a/full')).toEqual({ claude: true, gemini: true, codex: true, cursor: true });
      expect(detectCloneProviders('a/absent')).toEqual({ claude: false, gemini: false, codex: false, cursor: false });
    });
  });

  describe('writeCodexGlobalRules', () => {
    it('creates the managed block in a fresh ~/.codex/AGENTS.md', () => {
      const result = writeCodexGlobalRules('# Ponytail rules');
      expect(result.success).toBe(true);
      const content = fs.readFileSync(codexAgentsPath(), 'utf-8');
      expect(content).toContain('<!-- workshop:plugins:start -->');
      expect(content).toContain('# Ponytail rules');
      expect(content).toContain('<!-- workshop:plugins:end -->');
    });

    it('preserves user content outside the markers and updates in place', () => {
      fs.mkdirSync(path.join(testHome, '.codex'), { recursive: true });
      fs.writeFileSync(codexAgentsPath(), '# My own codex notes\n', 'utf-8');

      writeCodexGlobalRules('v1 rules');
      writeCodexGlobalRules('v2 rules');

      const content = fs.readFileSync(codexAgentsPath(), 'utf-8');
      expect(content).toContain('# My own codex notes');
      expect(content).toContain('v2 rules');
      expect(content).not.toContain('v1 rules');
      // Only one managed block
      expect(content.match(/workshop:plugins:start/g)).toHaveLength(1);
    });

    it('removes the block when rules are null, preserving user content', () => {
      fs.mkdirSync(path.join(testHome, '.codex'), { recursive: true });
      fs.writeFileSync(codexAgentsPath(), '# Keep me\n', 'utf-8');
      writeCodexGlobalRules('temp rules');

      const removal = writeCodexGlobalRules(null);
      expect(removal.success).toBe(true);
      const content = fs.readFileSync(codexAgentsPath(), 'utf-8');
      expect(content).toContain('# Keep me');
      expect(content).not.toContain('workshop:plugins:start');
      expect(content).not.toContain('temp rules');
    });

    it('is a no-op removal when no block exists', () => {
      const result = writeCodexGlobalRules(null);
      expect(result.success).toBe(true);
      expect(fs.existsSync(codexAgentsPath())).toBe(false);
    });
  });
});
