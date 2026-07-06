import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Set up isolated test database before any imports that use it
const testDbPath = path.join(os.tmpdir(), `workshop-test-plugin-${randomUUID()}.db`);
process.env.WORKSHOP_DB_PATH = testDbPath;

import { createPluginRepository } from '@infrastructure/persistence/plugin-repository';
import { toEnabledPluginsMap, detectProviders } from '@domain/plugin/repository';
import { resetDatabase } from '@infrastructure/persistence/database';
import type { PluginId } from '@foundation/types';

describe('Plugin Repository', () => {
  const repo = createPluginRepository();

  afterAll(() => {
    resetDatabase();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it('seeds ponytail by default', () => {
    const ponytail = repo.findByName('ponytail@ponytail');
    expect(ponytail).not.toBeNull();
    expect(ponytail!.marketplaceRepo).toBe('DietrichGebert/ponytail');
    expect(ponytail!.enabled).toBe(true);
  });

  it('creates and finds a plugin', () => {
    const plugin = repo.create({
      marketplaceRepo: 'acme/tools',
      pluginName: 'tools@acme',
      description: 'Acme tools',
    });
    expect(plugin.enabled).toBe(true);
    expect(repo.findById(plugin.id)?.pluginName).toBe('tools@acme');
    expect(repo.findByName('tools@acme')?.id).toBe(plugin.id);
  });

  it('enforces unique plugin_name', () => {
    expect(() => repo.create({ marketplaceRepo: 'acme/tools2', pluginName: 'tools@acme' })).toThrow();
  });

  it('updates enabled, description, and providers', () => {
    const plugin = repo.create({ marketplaceRepo: 'acme/other', pluginName: 'other@acme' });
    const updated = repo.update(plugin.id, {
      enabled: false,
      description: 'Updated',
      providers: { claude: true, gemini: false, codex: true, cursor: true },
    });
    expect(updated!.enabled).toBe(false);
    expect(updated!.description).toBe('Updated');
    expect(updated!.providers).toEqual({ claude: true, gemini: false, codex: true, cursor: true });

    // Partial update preserves other fields
    const reEnabled = repo.update(plugin.id, { enabled: true });
    expect(reEnabled!.description).toBe('Updated');
    expect(reEnabled!.providers?.codex).toBe(true);
  });

  it('returns null when updating a missing plugin', () => {
    expect(repo.update('missing' as PluginId, { enabled: false })).toBeNull();
  });

  it('deletes a plugin', () => {
    const plugin = repo.create({ marketplaceRepo: 'acme/gone', pluginName: 'gone@acme' });
    expect(repo.delete(plugin.id)).toBe(true);
    expect(repo.findById(plugin.id)).toBeNull();
    expect(repo.delete(plugin.id)).toBe(false);
  });
});

describe('toEnabledPluginsMap', () => {
  const base = { id: 'x' as PluginId, marketplaceRepo: 'a/b', createdAt: '', updatedAt: '' };

  it('maps every registered plugin with explicit enabled flags', () => {
    const map = toEnabledPluginsMap([
      { ...base, pluginName: 'on@a', enabled: true },
      { ...base, pluginName: 'off@a', enabled: false },
    ]);
    expect(map).toEqual({ 'on@a': true, 'off@a': false });
  });

  it('returns an empty map for no plugins', () => {
    expect(toEnabledPluginsMap([])).toEqual({});
  });
});

describe('detectProviders', () => {
  it('maps repo markers to provider coverage', () => {
    expect(detectProviders({ hasClaudePlugin: true, hasGeminiExtension: false, hasAgentsMd: true })).toEqual({
      claude: true,
      gemini: false,
      codex: true,
      cursor: true,
    });
  });
});
