import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { seedUserSettings } from '../../src/infrastructure/code-server/code-server';

function setup(): { dataDir: string; file: string } {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cs-settings-'));
  return { dataDir, file: path.join(dataDir, 'User', 'settings.json') };
}

describe('seedUserSettings', () => {
  it('seeds defaults into a fresh install', () => {
    const { dataDir, file } = setup();
    seedUserSettings(dataDir);
    const seeded = JSON.parse(readFileSync(file, 'utf8'));
    expect(seeded['window.autoDetectColorScheme']).toBe(true);
    expect(seeded['workbench.colorTheme']).toBe('Default Dark Modern');
    expect(seeded['editor.editContext']).toBe(false);
  });

  it('adds missing defaults to an existing file without changing user values', () => {
    const { dataDir, file } = setup();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ 'workbench.colorTheme': 'Solarized Light', 'editor.fontSize': 16 }));
    seedUserSettings(dataDir);
    const merged = JSON.parse(readFileSync(file, 'utf8'));
    expect(merged['workbench.colorTheme']).toBe('Solarized Light');
    expect(merged['editor.fontSize']).toBe(16);
    expect(merged['editor.editContext']).toBe(false);
  });

  it('leaves a file it cannot parse (JSONC comments) untouched', () => {
    const { dataDir, file } = setup();
    mkdirSync(path.dirname(file), { recursive: true });
    const jsonc = '{\n  // mine\n  "editor.fontSize": 14\n}\n';
    writeFileSync(file, jsonc);
    seedUserSettings(dataDir);
    expect(readFileSync(file, 'utf8')).toBe(jsonc);
  });
});
