import { describe, it, expect } from 'vitest';
import { buildItems, rankItems, type PaletteItem } from '../../src/ui/command-palette/palette-items';
import type { Session, Track } from '../../src/foundation/types';

const item = (label: string, at?: string, sub?: string): PaletteItem => ({ key: label, kind: 'Page', label, to: '/', at, sub });

describe('rankItems', () => {
  it('orders by recency on an empty query, undated entries last', () => {
    const ranked = rankItems([item('static'), item('old', '2026-01-01'), item('new', '2026-02-01')], '');
    expect(ranked.map((i) => i.label)).toEqual(['new', 'old', 'static']);
  });

  it('prefers prefix > word-start > substring > subsequence, and drops non-matches', () => {
    const items = [item('xxkanbanx'), item('k-a-n'), item('Kanban'), item('PR kanban'), item('nothing')];
    expect(rankItems(items, 'kan').map((i) => i.label)).toEqual(['Kanban', 'PR kanban', 'xxkanbanx', 'k-a-n']);
  });

  it('breaks score ties by recency and matches the sub line', () => {
    const items = [item('alpha', '2026-01-01', 'workshop'), item('beta', '2026-03-01', 'workshop')];
    expect(rankItems(items, 'work').map((i) => i.label)).toEqual(['beta', 'alpha']);
  });
});

describe('buildItems', () => {
  it('skips dead sessions, archived/hidden tracks, links sessions to the Sessions view', () => {
    const tracks = [
      { id: 't1', name: 'Workshop', status: 'active', updatedAt: '2026-01-01' },
      { id: 't2', name: 'Old', status: 'archived', updatedAt: '2026-01-01' },
      { id: 't3', name: 'Hidden', status: 'active', hidden: true, updatedAt: '2026-01-01' },
    ] as Track[];
    const sessions = [
      { id: 's1', trackId: 't1', name: 'live', state: 'active', updatedAt: '2026-01-01', activityStatus: 'working' },
      { id: 's2', trackId: 't1', name: 'gone', state: 'dead', updatedAt: '2026-01-01' },
      { id: 's3', trackId: 't3', name: 'on hidden', state: 'active', updatedAt: '2026-01-01' },
    ] as Session[];
    const items = buildItems({ tracks, sessions, todos: [], epics: [], reviews: [] }, []);
    expect(items.map((i) => i.label)).toEqual(['Workshop', 'live']);
    expect(items[1]).toMatchObject({ sub: 'Workshop', to: '/sessions?session=s1', activity: 'working' });
  });
});
