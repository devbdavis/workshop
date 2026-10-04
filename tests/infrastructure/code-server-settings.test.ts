import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { seedUserSettings } from '../../src/infrastructure/code-server/code-server';

describe('seedUserSettings', () => {
  it('seeds system-following theme defaults once and never overwrites user edits', () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'cs-settings-'));
    const file = path.join(dataDir, 'User', 'settings.json');
    seedUserSettings(dataDir);
    const seeded = JSON.parse(readFileSync(file, 'utf8'));
    expect(seeded['window.autoDetectColorScheme']).toBe(true);
    expect(seeded['workbench.colorTheme']).toBe('Default Dark Modern');

    writeFileSync(file, '{ "workbench.colorTheme": "Solarized Light" }');
    seedUserSettings(dataDir);
    expect(readFileSync(file, 'utf8')).toBe('{ "workbench.colorTheme": "Solarized Light" }');
  });
});
