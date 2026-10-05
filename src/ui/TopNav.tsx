import { useEffect, useState, useCallback } from 'react';
import { NavLink, useMatch } from 'react-router-dom';
import { useProfile } from './hooks/useProfile';
import { useIsMobile } from './use-is-mobile';
import { useSessionAlerts } from './notifications/SessionAlerts';

const LAST_TRACK_KEY = 'workshop:last-track';

interface LastTrack {
  id: string;
  name: string;
}

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `px-3 py-1 text-xs font-medium rounded transition-colors ${
    isActive ? 'bg-gray-800 text-gray-100' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'
  }`;
}

const navItems = [
  { to: '/kanban', label: 'Kanban', end: false },
{ to: '/scheduled-tasks', label: 'Schedules', end: false },
  { to: '/workflow', label: 'Workflow', end: false },
  { to: '/pr-reviews', label: 'PR Reviews', end: false },
  { to: '/discussions', label: 'Discussions', end: false },
  { to: '/history', label: 'History', end: false },
  { to: '/settings', label: 'Settings', end: false },
];

export function TopNav() {
  const trackMatch = useMatch('/tracks/:trackId');
  const { user } = useProfile();
  const isMobile = useIsMobile();
  const { unread } = useSessionAlerts();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const alertCount = pendingCount + unread.length;
  const [lastTrack, setLastTrack] = useState<LastTrack | null>(() => {
    try {
      const raw = localStorage.getItem(LAST_TRACK_KEY);
      return raw ? (JSON.parse(raw) as LastTrack) : null;
    } catch {
      return null;
    }
  });

  const loadCount = useCallback(async () => {
    try {
      const wfRes = await fetch('/api/workflow/tickets');
      if (wfRes.ok) {
        const tickets = await wfRes.json();
        // Dynamic: use template-enriched stateData, fallback to legacy state names
        const legacyHumanStates = new Set(['spec-review', 'plan-review', 'final-review', 'needs-input', 'code-review']);
        const count = tickets.filter((t: { state: string; stateData?: Record<string, unknown> }) => {
          if (t.stateData?.currentStateHumanGate === true) return true;
          return legacyHumanStates.has(t.state);
        }).length;
        setPendingCount(count);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadCount();
  }, [loadCount]);

  // Persist last-visited track so the Back button survives navigation away
  useEffect(() => {
    const trackId = trackMatch?.params.trackId;
    if (!trackId) return;
    fetch(`/api/tracks/${trackId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((track: { id: string; name: string } | null) => {
        if (!track) return;
        const entry: LastTrack = { id: track.id, name: track.name };
        localStorage.setItem(LAST_TRACK_KEY, JSON.stringify(entry));
        setLastTrack(entry);
      })
      .catch(() => { /* non-fatal */ });
  }, [trackMatch?.params.trackId]);

  // WebSocket for real-time count updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data);
        if (event.type?.startsWith('workflow:')) loadCount();
      } catch { /* ignore */ }
    };
    return () => ws.close();
  }, [loadCount]);

  return (
    <nav className="relative flex items-center gap-1 px-4 py-1.5 bg-gray-950 border-b border-gray-800 shrink-0">
      {/* Hamburger toggle — mobile only; desktop keeps the flat horizontal nav */}
      <button
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Toggle navigation menu"
        aria-expanded={menuOpen}
        className="md:hidden px-2 py-1 mr-1 text-lg leading-none text-gray-400 hover:text-gray-200 rounded hover:bg-gray-900"
      >
        ☰
      </button>

      <NavLink
        to="/"
        className="text-sm font-semibold text-gray-300 hover:text-white mr-4 tracking-tight"
      >
        Workshop
      </NavLink>

      <div className="hidden md:flex items-center gap-0.5">
        <NavLink to="/" end className={navLinkClass}>
          Tracks
        </NavLink>
        <NavLink to="/sessions" className={navLinkClass}>
          Sessions
        </NavLink>
        {navItems.map(({ to, label, end }) => (
          <NavLink key={to} to={to} end={end} className={navLinkClass}>
            {label}
          </NavLink>
        ))}

        {/* Persistent back-to-track button — always shows the most recently visited track */}
        {lastTrack && (
          <NavLink
            to={`/tracks/${lastTrack.id}`}
            className="ml-1 px-2 py-0.5 text-[10px] font-medium text-gray-400 bg-gray-900 hover:bg-gray-800 hover:text-gray-200 rounded transition-colors"
          >
            {lastTrack.name}
          </NavLink>
        )}
      </div>

      {/* Profile chip + notification bell — pushed to the right */}
      <div className="ml-auto flex items-center gap-1">
        {user && (
          <NavLink
            to="/settings/profile"
            title={`Profile: ${user.name}`}
            className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-gray-400 hover:text-gray-200 hover:bg-gray-900 rounded transition-colors"
          >
            <span
              className="w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-[9px] font-semibold text-white"
              style={{ backgroundColor: user.color || '#3b82f6' }}
            >
              {user.name.charAt(0).toUpperCase()}
            </span>
            <span className="hidden sm:inline">{user.name}</span>
          </NavLink>
        )}
        <NavLink
          to="/notifications"
          className={({ isActive }) =>
            `relative flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-colors ${
              isActive
                ? 'bg-gray-800 text-gray-100'
                : alertCount > 0
                  ? 'text-amber-400 hover:text-amber-300 hover:bg-gray-900'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'
            }`
          }
        >
          {/* Bell icon */}
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
          {alertCount > 0 && (
            <>
              <span className="min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold bg-amber-600 text-white rounded-full animate-pulse">
                {alertCount}
              </span>
            </>
          )}
        </NavLink>
      </div>

      {/* Mobile dropdown drawer — same links stacked vertically, closes on navigate */}
      {isMobile && menuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 z-50 flex flex-col gap-0.5 p-2 bg-gray-950 border-b border-gray-800 shadow-lg">
          <NavLink to="/" end className={navLinkClass} onClick={() => setMenuOpen(false)}>
            Tracks
          </NavLink>
          <NavLink to="/sessions" className={navLinkClass} onClick={() => setMenuOpen(false)}>
            Sessions
          </NavLink>
          {navItems.map(({ to, label, end }) => (
            <NavLink key={to} to={to} end={end} className={navLinkClass} onClick={() => setMenuOpen(false)}>
              {label}
            </NavLink>
          ))}
          {lastTrack && (
            <NavLink
              to={`/tracks/${lastTrack.id}`}
              className={navLinkClass}
              onClick={() => setMenuOpen(false)}
            >
              {lastTrack.name}
            </NavLink>
          )}
        </div>
      )}
    </nav>
  );
}
