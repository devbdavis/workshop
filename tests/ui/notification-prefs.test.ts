import { describe, it, expect, beforeEach } from 'vitest';
import { loadPrefs } from '../../src/ui/notifications/prefs';

function stubLocalStorage(value: string | null): void {
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: () => value,
    setItem: () => { /* unused in these tests */ },
    removeItem: () => { /* unused */ },
    clear: () => { /* unused */ },
    key: () => null,
    length: 0,
  } as Storage;
}

describe('loadPrefs', () => {
  beforeEach(() => {
    stubLocalStorage(null);
  });

  it('merges partial stored JSON over defaults', () => {
    stubLocalStorage(JSON.stringify({ sound: false, volume: 0.1 }));
    expect(loadPrefs()).toEqual({ system: true, sound: false, chip: true, idle: true, volume: 0.1 });
  });

  it('falls back to defaults on malformed JSON', () => {
    stubLocalStorage('{not json');
    expect(loadPrefs()).toEqual({ system: true, sound: true, chip: true, idle: true, volume: 0.5 });
  });
});
