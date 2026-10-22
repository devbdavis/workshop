import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActivityDot } from '../shared/ActivityDot';
import { navItems } from '../TopNav';
import { SETTINGS_TABS } from '../settings/Settings';
import { buildItems, rankItems, type PaletteData, type PaletteItem } from './palette-items';

const STATICS: PaletteItem[] = [
  { to: '/', label: 'Tracks' },
  { to: '/sessions', label: 'Sessions' },
  ...navItems.filter((n) => n.to !== '/settings'),
  { to: '/notifications', label: 'Notifications' },
]
  .map(({ to, label }): PaletteItem => ({ key: `p:${to}`, kind: 'Page', label, to }))
  .concat(SETTINGS_TABS.map(({ id, label }) => ({ key: `st:${id}`, kind: 'Settings', label, sub: 'Settings', to: `/settings/${id}` })));

const IS_MAC = /mac|iphone|ipad|ipod/i.test(navigator.platform);

const EMPTY: PaletteData = { tracks: [], sessions: [], todos: [], epics: [], reviews: [] };

function getJson<T>(url: string): Promise<T[]> {
  return fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<T[]>) : []))
    .catch(() => []);
}

export function CommandPalette() {
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [data, setData] = useState<PaletteData>(EMPTY);

  // Capture phase on window runs before xterm's textarea handler, so the hotkey works with a terminal focused.
  // Cmd on macOS (leaves Ctrl-K to the shell), Ctrl elsewhere — mirrors the terminal's find shortcut.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (!mod || e.altKey || e.shiftKey || e.repeat || e.code !== 'KeyK') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen((v) => !v);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    setQuery('');
    setActive(0);
    dialog.showModal();
    // Refetch on every open so session activity badges are current.
    Promise.all([
      getJson<PaletteData['tracks'][number]>('/api/tracks'),
      getJson<PaletteData['sessions'][number]>('/api/sessions'),
      getJson<PaletteData['todos'][number]>('/api/todos'),
      getJson<PaletteData['epics'][number]>('/api/workflow/issues?type=epic'),
      getJson<PaletteData['reviews'][number]>('/api/pr-reviews'),
    ]).then(([tracks, sessions, todos, epics, reviews]) => {
      setData({ tracks, sessions, todos, epics, reviews });
      setActive(0); // results reorder under the cursor; don't let Enter pick an unseen row
    });
  }, [open]);

  const results = useMemo(() => rankItems(buildItems(data, STATICS), query), [data, query]);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function go(item: PaletteItem | undefined) {
    if (!item) return;
    setOpen(false);
    navigate(item.to);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') setActive((i) => Math.max(0, Math.min(i + 1, results.length - 1)));
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
    else if (e.key === 'Enter') go(results[active]);
    else return;
    e.preventDefault();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={() => setOpen(false)}
      onClick={(e) => e.target === dialogRef.current && setOpen(false)}
      aria-label="Command palette"
      className="mt-[12vh] mx-auto w-[min(36rem,calc(100vw-2rem))] p-0 rounded-lg border border-gray-700 bg-gray-900 text-gray-100 shadow-2xl backdrop:bg-black/60"
    >
      {open && (
        <>
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            placeholder="Jump to track, session, todo, epic, PR, page…"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={results[active] ? `cp-${results[active].key}` : undefined}
            className="w-full px-4 py-3 bg-transparent border-b border-gray-800 text-sm outline-none placeholder:text-gray-500"
          />
          <ul id="command-palette-list" role="listbox" ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
            {results.length === 0 && <li className="px-4 py-3 text-sm text-gray-500">No matches</li>}
            {results.map((item, i) => (
              <li
                key={item.key}
                id={`cp-${item.key}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(item)}
                className={`flex items-center gap-2 px-4 py-1.5 text-sm cursor-pointer ${i === active ? 'bg-gray-800' : ''}`}
              >
                <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-gray-500">{item.kind}</span>
                {item.kind === 'Session' && <ActivityDot activityStatus={item.activity} className="shrink-0" />}
                <span className="truncate text-gray-200">{item.label}</span>
                {item.sub && <span className="ml-auto pl-2 shrink-0 max-w-[40%] truncate text-xs text-gray-500">{item.sub}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </dialog>
  );
}
