import { describe, it, expect } from 'vitest';
import { loadDraft, saveDraft, DRAFT_TTL_MS } from '../../src/ui/terminal-panel/composer-draft';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
  };
}

describe('composer drafts', () => {
  it('round-trips a draft per session and clears it when emptied', () => {
    const s = memoryStorage();
    saveDraft('a', 'hello', s, 1000);
    saveDraft('b', 'other', s, 1000);
    expect(loadDraft('a', s, 2000)).toBe('hello');
    expect(loadDraft('b', s, 2000)).toBe('other');
    saveDraft('a', '', s, 3000);
    expect(loadDraft('a', s, 3000)).toBe('');
  });

  it('drops drafts untouched for over a week, including other sessions', () => {
    const s = memoryStorage();
    saveDraft('old', 'stale', s, 0);
    saveDraft('fresh', 'keep', s, DRAFT_TTL_MS);
    expect(loadDraft('fresh', s, DRAFT_TTL_MS + 1)).toBe('keep');
    expect(s.length).toBe(1);
    expect(loadDraft('old', s, DRAFT_TTL_MS + 1)).toBe('');
  });

  it('survives corrupt entries', () => {
    const s = memoryStorage();
    s.setItem('workshop:composer-draft:x', '{nope');
    expect(loadDraft('x', s)).toBe('');
    expect(s.length).toBe(0);
  });
});
