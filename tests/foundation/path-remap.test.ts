import { describe, it, expect } from 'vitest';
import {
  applyPathRemaps,
  parsePathRemaps,
  remapTextFromSettings,
} from '@foundation/path-remap.js';

const RULES = parsePathRemaps(`
  /repos -> /mnt/user/repos
  / -> /mnt/host
`);

describe('parsePathRemaps', () => {
  it('orders rules longest-prefix first and drops junk lines', () => {
    expect(RULES).toEqual([
      { from: '/repos', to: '/mnt/user/repos' },
      { from: '/', to: '/mnt/host' },
    ]);
    expect(parsePathRemaps('nonsense\nrelative -> /x\n/a -> ')).toEqual([]);
  });

  it('trims trailing slashes but keeps the root prefix', () => {
    expect(parsePathRemaps('/repos/ -> /mnt/repos/')).toEqual([
      { from: '/repos', to: '/mnt/repos' },
    ]);
  });
});

describe('applyPathRemaps', () => {
  it('prefers the more specific rule over the catch-all', () => {
    expect(applyPathRemaps('/repos/workshop', RULES)).toBe('/mnt/user/repos/workshop');
    expect(applyPathRemaps('/config/.workshop/sessions/a', RULES)).toBe(
      '/mnt/host/config/.workshop/sessions/a',
    );
  });

  it('matches on segment boundaries only', () => {
    expect(applyPathRemaps('/repositories/x', RULES)).toBe('/mnt/host/repositories/x');
  });

  it('rewrites an exact prefix match', () => {
    expect(applyPathRemaps('/repos', RULES)).toBe('/mnt/user/repos');
  });

  it('leaves the path alone when nothing matches', () => {
    expect(applyPathRemaps('/repos/x', [])).toBe('/repos/x');
  });

  it('never doubles the leading slash when a root prefix is involved', () => {
    expect(applyPathRemaps('/repos/x', parsePathRemaps('/ -> /'))).toBe('/repos/x');
    expect(applyPathRemaps('/repos/x', parsePathRemaps('/repos -> /'))).toBe('/x');
  });
});

describe('remapTextFromSettings', () => {
  it('falls back to the legacy from/to pair', () => {
    expect(remapTextFromSettings({ editor_path_from: '/repos', editor_path_to: '/mnt/r' })).toBe(
      '/repos -> /mnt/r',
    );
    expect(remapTextFromSettings({ editor_path_remaps: '/a -> /b', editor_path_from: '/c' })).toBe(
      '/a -> /b',
    );
    expect(remapTextFromSettings({})).toBe('');
  });
});
