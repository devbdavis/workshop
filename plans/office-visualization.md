# Implementation Plan: Cartoon Office Visualization for Active Sessions

> **Revision 4** — Complete rewrite grounded in thorough codebase analysis. Addresses all prior critique findings.

## 1. Architecture Overview

### Concept

A new `/office` route renders all active Workshop sessions as cartoon characters at desks in an "office" scene. Each session gets a deterministic character appearance (hashed from session ID). Character animation state (typing, sleeping, dying, gone) reflects real-time tmux pane activity. Click any character to open the existing `TerminalModal`.

### Data Flow

```
tmux panes (every 30s via syncSessionStates)
  ↓
single capturePaneOutput() call per session
  ↓ (shared between isSessionIdle + activity hash)
hash comparison → update in-memory activityMap
  ↓ (only on visual state transitions)
broadcast('session:activity-changed', trackId)
  ↓
WebSocket → frontend (500ms debounced)
  ↓
GET /api/sessions + GET /api/sessions/activity
  ↓
OfficeVisualization renders character sprites with CSS animations
```

### Key Design Decisions

1. **Activity data stays in-memory only** — no DB migration, no Session type change. The terminal manager holds a `Map<SessionId, ActivityEntry>` exposed via a new `GET /api/sessions/activity` endpoint. This avoids modifying the well-tested Session persistence layer.

2. **Single tmux capture per session per cycle** — the existing `isSessionIdle()` (line 70 of `manager.ts`) already calls `tmux capture-pane`. We refactor to capture once and share the output between idle detection and activity hashing. No double `execSync` calls.

3. **Broadcast only on state transitions** — `session:activity-changed` fires only when a session's visual state changes (working→sleeping or sleeping→working), not every 30s cycle. Prevents broadcast storms.

4. **Pre-generated character sprites** — character art generated via Replicate MCP (gpt-image-1.5) at development time, committed as static PNGs in `public/office-sprites/`. SVG used only for desk furniture, Zzz overlays, and speech bubbles. No runtime image generation.

5. **Dying animation** — when `syncSessionStates()` detects a dead session, it emits `session:dying` with the sessionId before DB cleanup. The frontend retains the session for 30s with a fade-out animation.

6. **No blocking on GET /sessions** — the existing code (line 76 of `api.ts`) runs `terminal.syncSessionStates()` synchronously on every `GET /sessions` request. With activity tracking adding `capture-pane` per session, this could block for seconds. We remove the synchronous sync from the GET handler and rely solely on the existing 30s interval.

### Layer Boundaries

```
Foundation (types.ts)  — NO CHANGE to Session type
Domain (repository.ts) — NO CHANGE to SessionRepository
Infrastructure (manager.ts) — Activity tracking logic + shared capture
Server (api.ts, events.ts) — New endpoint + new event types
UI (office/) — New route + visualization components
```

---

## 2. Detailed File Changes

### Phase 1: Backend — Activity Detection (3 files changed)

#### 2.1 `src/infrastructure/terminal/manager.ts`

**Current state** (relevant sections):
- Lines 67-94: `idleFirstSeen` map, `isSessionIdle()`, `getIdleMinutes()`
- Line 70-84: `isSessionIdle()` calls `tmux capture-pane -t ${session.tmuxSession} -p` inline
- Lines 480-525: `syncSessionStates()` loop
- Lines 49-54: `TerminalManager` interface

**Changes**:

**(a) New shared capture function** (replace inline capture in `isSessionIdle`):

```typescript
/** Capture tmux pane content once, reusable by both idle detection and activity tracking */
function capturePaneOutput(tmuxSession: string): string {
  try {
    return execSync(
      `tmux capture-pane -t ${tmuxSession} -p`,
      { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 },
    );
  } catch {
    return '';
  }
}
```

**(b) Refactor `isSessionIdle` to accept pre-captured output** (currently lines 70-84):

```typescript
// BEFORE (line 70):
function isSessionIdle(session: Session): boolean {
  try {
    const output = execSync(
      `tmux capture-pane -t ${session.tmuxSession} -p`,
      { stdio: 'pipe', encoding: 'utf-8' },
    );
    const lines = output.trimEnd().split('\n');
    const lastLine = lines[lines.length - 1]?.trim() || '';
    return lastLine === '❯' || lastLine.endsWith('❯') || lastLine === '>';
  } catch {
    return false;
  }
}

// AFTER:
function isSessionIdleFromOutput(output: string): boolean {
  if (!output) return false;
  const lines = output.trimEnd().split('\n');
  const lastLine = lines[lines.length - 1]?.trim() || '';
  return lastLine === '❯' || lastLine.endsWith('❯') || lastLine === '>';
}
```

**(c) New in-memory activity tracking state** (alongside `idleFirstSeen` at line 67):

```typescript
interface ActivityEntry {
  lastActivityAt: string;
  lastHash: string;
  lastVisualState: 'working' | 'sleeping';
}
const activityMap = new Map<string, ActivityEntry>();
```

**(d) Simple hash function** (no crypto dependency needed):

```typescript
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(36);
}
```

**(e) Unified capture + activity tracking in `syncSessionStates()`** (lines 480-525):

The existing loop structure stays. For each alive session, we capture once and reuse:

```typescript
syncSessionStates(): SyncResult {
  const allSessions = sessionRepo.findAll();
  const cleaned: SyncResult['cleaned'] = [];
  const dying: SyncResult['dying'] = [];
  const activityChanged: TrackId[] = [];

  for (const session of allSessions) {
    const alive = this.isSessionAlive(session);

    if (!alive && session.state !== 'dead') {
      // Capture session data BEFORE cleanup for dying animation
      dying.push({ sessionId: session.id, trackId: session.trackId });
      // Existing cleanup logic (kill tmux, clean dir, delete from DB)
      try { execSync(`tmux kill-session -t ${session.tmuxSession}`, { stdio: 'pipe' }); } catch {}
      cleanSessionDir(session.id);
      sessionRepo.delete(session.id);
      idleFirstSeen.delete(session.id);
      activityMap.delete(session.id);           // ← NEW: clean up activity
      cleaned.push({ sessionId: session.id, trackId: session.trackId });

    } else if (alive && session.state === 'dead') {
      sessionRepo.updateState(session.id, 'active');

    } else if (alive) {
      // ── Shared capture (NEW) ──
      const paneOutput = capturePaneOutput(session.tmuxSession);

      // ── Activity hash tracking (NEW) ──
      if (paneOutput) {
        const tailLines = paneOutput.trimEnd().split('\n').slice(-20).join('\n');
        const hash = simpleHash(tailLines);
        const prev = activityMap.get(session.id);

        if (!prev || prev.lastHash !== hash) {
          // Content changed → session is working
          const newState: 'working' | 'sleeping' = 'working';
          if (prev && prev.lastVisualState !== newState) {
            activityChanged.push(session.trackId);
          }
          activityMap.set(session.id, {
            lastActivityAt: new Date().toISOString(),
            lastHash: hash,
            lastVisualState: 'working',
          });
        } else {
          // Hash unchanged → check if should transition to sleeping
          const idleMs = Date.now() - new Date(prev.lastActivityAt).getTime();
          if (idleMs > 60_000 && prev.lastVisualState !== 'sleeping') {
            prev.lastVisualState = 'sleeping';
            activityChanged.push(session.trackId);
          }
        }
      }

      // ── Background idle reaping (existing logic, now uses shared output) ──
      if (session.background) {
        if (isSessionIdleFromOutput(paneOutput)) {
          const idleMinutes = getIdleMinutes(session);
          if (idleMinutes >= BACKGROUND_IDLE_TIMEOUT_MINUTES) {
            // ... existing reaping logic unchanged ...
            activityMap.delete(session.id);  // ← NEW: clean up
          }
        } else {
          idleFirstSeen.delete(session.id);
        }
      }
    }
  }

  if (cleaned.length > 0) {
    console.log(`Session sync: cleaned up ${cleaned.length} dead/idle session(s)`);
  }
  return { cleaned, dying, activityChanged };
}
```

**(f) Extend `SyncResult` and `TerminalManager` interface** (lines 45-54):

```typescript
export interface SyncResult {
  cleaned: { sessionId: SessionId; trackId: TrackId }[];
  dying: { sessionId: SessionId; trackId: TrackId }[];     // NEW
  activityChanged: TrackId[];                                // NEW
}

export interface TerminalManager {
  createSession(trackId: TrackId, options?: CreateSessionOptions): Promise<Session>;
  destroySession(sessionId: SessionId): Promise<void>;
  isSessionAlive(session: Session): boolean;
  syncSessionStates(): SyncResult;
  /** Returns in-memory activity data for office visualization */
  getSessionActivity(): Record<string, { lastActivityAt: string; visualState: string }>;  // NEW
}
```

**(g) Implement `getSessionActivity()`**:

```typescript
getSessionActivity(): Record<string, { lastActivityAt: string; visualState: string }> {
  const result: Record<string, { lastActivityAt: string; visualState: string }> = {};
  for (const [id, entry] of activityMap) {
    result[id] = { lastActivityAt: entry.lastActivityAt, visualState: entry.lastVisualState };
  }
  return result;
},
```

**Total changes to this file**: ~60 lines added/modified. File remains well under 300 lines (currently ~527 lines; with shared capture replacing inline capture, net add is ~40 lines).

---

#### 2.2 `src/server/events.ts`

**Current state**: 33 lines. Defines `EventType` union, `WorkshopEvent` interface, `broadcast()` function.

**Changes**:

Add 2 new event types to the `EventType` union (line 4):

```typescript
type EventType = /* ...existing 30+ types... */
  | 'session:dying'             // NEW
  | 'session:activity-changed'; // NEW
```

Add optional `sessionId` to `WorkshopEvent` (line 7):

```typescript
interface WorkshopEvent {
  type: EventType;
  trackId: string;
  timestamp: string;
  sessionId?: string;  // NEW — included for session:dying
}
```

Add a second broadcast function for events that include sessionId:

```typescript
export function broadcastWithSession(type: EventType, trackId: TrackId | string, sessionId: string): void {
  const event: WorkshopEvent = {
    type,
    trackId,
    timestamp: new Date().toISOString(),
    sessionId,
  };
  const msg = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}
```

**Total changes**: ~15 lines added.

---

#### 2.3 `src/server/api.ts`

**Current state**: ~520+ lines. Lines 73-85 define `runSessionSync()` + interval. Lines 419-430 define `GET /sessions`.

**Changes**:

**(a) Import `broadcastWithSession`** (line 3 area):

```typescript
import { broadcast, broadcastWithSession } from './events.js';
```

**(b) Update `runSessionSync()`** (lines 75-80):

```typescript
function runSessionSync() {
  const result = terminal.syncSessionStates();

  // Broadcast dying events WITH sessionId (before deletion broadcast)
  for (const { sessionId, trackId } of result.dying) {
    broadcastWithSession('session:dying', trackId, sessionId);
  }

  // Broadcast deletion events (existing)
  for (const { trackId } of result.cleaned) {
    broadcast('session:deleted', trackId);
  }

  // Broadcast activity state transitions
  const uniqueTracks = [...new Set(result.activityChanged)];
  for (const trackId of uniqueTracks) {
    broadcast('session:activity-changed', trackId);
  }
}
```

**(c) Remove synchronous sync from GET /sessions** (around line 420):

```typescript
// BEFORE:
router.get('/sessions', (_req, res) => {
  terminal.syncSessionStates(); // ← blocks for seconds with many sessions
  const allSessions = sessions.findAll();
  res.json(allSessions);
});

// AFTER:
router.get('/sessions', (_req, res) => {
  // Rely on 30s interval for freshness — no blocking sync per request
  const allSessions = sessions.findAll();
  res.json(allSessions);
});
```

**(d) New activity endpoint** (after existing session routes):

```typescript
router.get('/sessions/activity', (_req, res) => {
  res.json(terminal.getSessionActivity());
});
```

**Note on route ordering**: `/sessions/activity` must be registered before any `/sessions/:id` route to prevent Express from treating "activity" as a session ID. Currently there is no `/sessions/:id` route (session operations are nested under `/tracks/:id/sessions/:sessionId`), so this is safe.

**Total changes**: ~20 lines added/modified.

---

### Phase 2: Frontend — Office Visualization (6 new files, 3 existing files modified)

#### 2.4 New: `src/ui/office/office-animations.css` (~90 lines)

Pure CSS keyframe animations. No animation library dependency.

```css
/* Monitor glow pulse for working state */
@keyframes monitor-pulse {
  0%, 100% { filter: drop-shadow(0 0 4px rgba(0, 255, 65, 0.4)); }
  50% { filter: drop-shadow(0 0 10px rgba(0, 255, 65, 0.7)); }
}

/* Cursor blink on monitor */
@keyframes cursor-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}

/* Zzz float up and fade out (staggered via animation-delay) */
@keyframes zzz-float {
  0% { opacity: 0; transform: translate(0, 0) scale(0.5); }
  20% { opacity: 1; }
  100% { opacity: 0; transform: translate(10px, -30px) scale(1.2); }
}

/* Dying: 30s fade to nothing */
@keyframes dying-fade {
  0% { opacity: 1; }
  70% { opacity: 0.6; }
  100% { opacity: 0; }
}

/* Speech bubble pop-in then fade */
@keyframes speech-pop {
  0% { opacity: 0; transform: scale(0.5); }
  10% { opacity: 1; transform: scale(1.05); }
  15% { transform: scale(1); }
  80% { opacity: 1; }
  100% { opacity: 0; }
}

/* New desk entrance */
@keyframes desk-appear {
  from { opacity: 0; transform: scale(0.9) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

/* Initializing pulse */
@keyframes init-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

/* State-driven class applications */
.desk-unit { animation: desk-appear 0.3s ease-out; }

.desk-unit--working .monitor-glow { animation: monitor-pulse 2s ease-in-out infinite; }
.desk-unit--working .cursor-bar { animation: cursor-blink 1s step-end infinite; }

.desk-unit--sleeping .zzz-group { display: block; }
.desk-unit--sleeping .z1 { animation: zzz-float 2s ease-out infinite; }
.desk-unit--sleeping .z2 { animation: zzz-float 2s ease-out 0.6s infinite; }
.desk-unit--sleeping .z3 { animation: zzz-float 2s ease-out 1.2s infinite; }

.desk-unit--detached { filter: grayscale(0.5); opacity: 0.7; }
.desk-unit--detached .zzz-group { display: block; }
.desk-unit--detached .z1 { animation: zzz-float 2s ease-out infinite; }
.desk-unit--detached .z2 { animation: zzz-float 2s ease-out 0.6s infinite; }
.desk-unit--detached .z3 { animation: zzz-float 2s ease-out 1.2s infinite; }

.desk-unit--dying { animation: dying-fade 30s ease-out forwards; pointer-events: none; }
.desk-unit--dying .speech-bubble { animation: speech-pop 30s ease-out forwards; }

.desk-unit--initializing .character-sprite { animation: init-pulse 1.5s ease-in-out infinite; }

/* Hidden by default */
.zzz-group { display: none; }
.speech-bubble { display: none; }
.desk-unit--dying .speech-bubble { display: block; }
```

All animations use only `transform`, `opacity`, and `filter` — GPU-accelerated, no layout thrashing.

---

#### 2.5 New: `src/ui/office/useSessionsWithActivity.ts` (~90 lines)

Custom hook extracting data-fetching + WebSocket subscription logic. Keeps the main component clean.

```typescript
import { useEffect, useState, useCallback, useRef } from 'react';
import type { Session, Track } from '@foundation/types';

interface ActivityEntry { lastActivityAt: string; visualState: string; }
interface DyingEntry { session: Session; diedAt: number; }

export function useSessionsWithActivity() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activity, setActivity] = useState<Record<string, ActivityEntry>>({});
  const [tracks, setTracks] = useState<Track[]>([]);
  const [dyingSessions, setDyingSessions] = useState<Map<string, DyingEntry>>(new Map());
  const sessionsRef = useRef(sessions); // ref for WS callback closure
  sessionsRef.current = sessions;

  const loadData = useCallback(async () => {
    const [sessRes, actRes, trkRes] = await Promise.all([
      fetch('/api/sessions'),
      fetch('/api/sessions/activity'),
      fetch('/api/tracks'),
    ]);
    if (sessRes.ok) setSessions(await sessRes.json());
    if (actRes.ok) setActivity(await actRes.json());
    if (trkRes.ok) setTracks(await trkRes.json());
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // WebSocket with 500ms debounce
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);

    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data);
        if (event.type === 'session:dying' && event.sessionId) {
          const sess = sessionsRef.current.find(s => s.id === event.sessionId);
          if (sess) {
            setDyingSessions(prev => {
              const next = new Map(prev);
              next.set(event.sessionId, { session: sess, diedAt: Date.now() });
              return next;
            });
          }
        }
        if (event.type?.startsWith('session:')) {
          if (timer) clearTimeout(timer);
          timer = setTimeout(loadData, 500);
        }
      } catch { /* ignore */ }
    };

    return () => { if (timer) clearTimeout(timer); ws.close(); };
  }, [loadData]);

  // Cleanup dying sessions after 30s
  useEffect(() => {
    const interval = setInterval(() => {
      setDyingSessions(prev => {
        const next = new Map(prev);
        const now = Date.now();
        for (const [id, entry] of next) {
          if (now - entry.diedAt > 30_000) next.delete(id);
        }
        return next.size !== prev.size ? next : prev;
      });
    }, 5_000);
    return () => clearInterval(interval);
  }, []);

  return { sessions, activity, tracks, dyingSessions };
}
```

---

#### 2.6 New: `src/ui/office/visualState.ts` (~50 lines)

Pure utility module — exported functions with no React dependency. Easy to unit test.

```typescript
import type { Session } from '@foundation/types';

export type VisualState = 'initializing' | 'working' | 'sleeping' | 'detached' | 'dying' | 'empty';

export function deriveVisualState(
  session: Session,
  activityEntry?: { lastActivityAt: string; visualState: string },
  isDying?: boolean,
): VisualState {
  if (isDying) return 'dying';
  if (session.state === 'dead') return 'empty';
  if (session.state === 'detached') return 'detached';
  if (!activityEntry) return 'initializing';
  return activityEntry.visualState === 'sleeping' ? 'sleeping' : 'working';
}

const CHAR_VARIANTS = 8;
const POSE_MAP: Record<VisualState, string> = {
  initializing: 'typing',
  working: 'typing',
  sleeping: 'sleeping',
  detached: 'slumped',
  dying: 'walking-away',
  empty: 'walking-away',
};

export function getCharacterVariant(sessionId: string): number {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = ((hash << 5) - hash + sessionId.charCodeAt(i)) & 0xffffffff;
  }
  return (Math.abs(hash) % CHAR_VARIANTS) + 1;
}

export function getSpritePath(sessionId: string, state: VisualState): string {
  const variant = getCharacterVariant(sessionId);
  const pose = POSE_MAP[state];
  return `/office-sprites/char${variant}-${pose}.png`;
}

export function formatIdleDuration(lastActivityAt: string): string {
  const ms = Date.now() - new Date(lastActivityAt).getTime();
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m idle`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m idle`;
}
```

---

#### 2.7 New: `src/ui/office/DeskScene.tsx` (~120 lines)

Individual desk + character unit. Combines SVG desk with character sprite `<img>`.

```typescript
import type { Session } from '@foundation/types';
import type { VisualState } from './visualState';
import { getSpritePath, formatIdleDuration } from './visualState';

interface Props {
  session: Session;
  visualState: VisualState;
  trackName: string;
  lastActivityAt?: string;
  onAttach: () => void;
}

export function DeskScene({ session, visualState, trackName, lastActivityAt, onAttach }: Props) {
  const spritePath = getSpritePath(session.id, visualState);
  const displayName = session.name || `session:${session.id.slice(0, 8)}`;
  const canAttach = session.state === 'active';
  const providerInitial = session.provider[0].toUpperCase(); // C, X, or G

  return (
    <div
      className={`desk-unit desk-unit--${visualState} relative group cursor-pointer`}
      onClick={canAttach ? onAttach : undefined}
    >
      {/* Desk + monitor SVG base */}
      <svg viewBox="0 0 200 180" className="w-full">
        {/* Desk surface */}
        <rect x="20" y="120" width="160" height="10" rx="3" fill="#183218" stroke="#275027" />
        {/* Desk legs */}
        <rect x="30" y="130" width="8" height="40" fill="#183218" />
        <rect x="162" y="130" width="8" height="40" fill="#183218" />
        {/* Monitor */}
        <rect className="monitor" x="55" y="60" width="90" height="58" rx="4"
              fill="#0d1f0d" stroke="#275027" strokeWidth="2" />
        {/* Monitor glow overlay */}
        <rect className="monitor-glow" x="59" y="64" width="82" height="50" rx="2"
              fill="rgba(0,255,65,0.05)" />
        {/* Cursor bar on monitor */}
        <rect className="cursor-bar" x="70" y="85" width="8" height="14" fill="#22c55e" />
        {/* Monitor stand */}
        <rect x="92" y="118" width="16" height="6" fill="#183218" />
        {/* Keyboard */}
        <rect x="65" y="122" width="70" height="6" rx="1" fill="#0d1f0d" stroke="#275027" />
        {/* Provider badge in monitor corner */}
        <text x="130" y="76" fontSize="10" fill="#387038" fontFamily="monospace">
          {providerInitial}
        </text>
      </svg>

      {/* Character sprite (positioned over desk) */}
      <img
        src={spritePath}
        alt={displayName}
        className="character-sprite absolute bottom-[45%] left-1/2 -translate-x-1/2 w-[60%] pointer-events-none"
        draggable={false}
      />

      {/* Zzz overlay (hidden by default, shown via CSS class) */}
      <svg className="zzz-group absolute top-0 right-0 w-12 h-16" viewBox="0 0 48 64">
        <text className="z1" x="8" y="50" fontSize="14" fill="#4d964d" fontFamily="serif" fontWeight="bold">z</text>
        <text className="z2" x="18" y="36" fontSize="18" fill="#68c468" fontFamily="serif" fontWeight="bold">Z</text>
        <text className="z3" x="28" y="20" fontSize="12" fill="#387038" fontFamily="serif" fontWeight="bold">z</text>
      </svg>

      {/* Speech bubble (dying state only, shown via CSS class) */}
      <div className="speech-bubble absolute -top-2 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-[10px] text-gray-400 whitespace-nowrap">
        gone home...
      </div>

      {/* Name plate */}
      <div className="text-center mt-1">
        <div className="text-[11px] text-gray-400 font-mono truncate px-1">{displayName}</div>
        <div className="text-[9px] text-gray-600 truncate px-1">{trackName}</div>
        {lastActivityAt && visualState === 'sleeping' && (
          <div className="text-[9px] text-yellow-700">{formatIdleDuration(lastActivityAt)}</div>
        )}
      </div>

      {/* Hover tooltip */}
      <div className="hidden group-hover:block absolute z-10 bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl min-w-[180px]">
        <div className="text-xs text-gray-200 font-mono mb-1">{displayName}</div>
        <div className="text-[10px] text-gray-500 space-y-0.5">
          <div>Track: {trackName}</div>
          <div>Provider: {session.provider}</div>
          <div>State: {session.state} / {visualState}</div>
          {session.background && <div className="text-emerald-600">background</div>}
          {lastActivityAt && <div>Last active: {formatIdleDuration(lastActivityAt)}</div>}
          <div>Created: {new Date(session.createdAt).toLocaleTimeString()}</div>
        </div>
        {canAttach && (
          <div className="text-[9px] text-green-600 mt-1">Click to attach terminal</div>
        )}
      </div>

      {/* Background badge */}
      {session.background && (
        <div className="absolute top-1 left-1 text-[8px] px-1 bg-emerald-900/50 text-emerald-500 rounded">
          bg
        </div>
      )}
    </div>
  );
}
```

---

#### 2.8 New: `src/ui/office/OfficeVisualization.tsx` (~120 lines)

Main page component. Orchestrates data, renders grid.

```typescript
import { useState } from 'react';
import type { Session } from '@foundation/types';
import { useSessionsWithActivity } from './useSessionsWithActivity';
import { deriveVisualState } from './visualState';
import { DeskScene } from './DeskScene';
import { TerminalModal } from '../track-view/TerminalModal';
import './office-animations.css';

export function OfficeVisualization() {
  const { sessions, activity, tracks, dyingSessions } = useSessionsWithActivity();
  const [attachedSession, setAttachedSession] = useState<Session | null>(null);

  const trackNames = Object.fromEntries(tracks.map(t => [t.id, t.name]));

  // Build display list: active/detached sessions + dying sessions
  const activeSessions = sessions.filter(s => s.state !== 'dead');
  const dyingIds = new Set(dyingSessions.keys());

  // Combine: active sessions + dying (but not in active list)
  const displayList = [
    ...activeSessions.map(s => ({
      session: s,
      isDying: false,
      visualState: deriveVisualState(s, activity[s.id]),
    })),
    ...Array.from(dyingSessions.values())
      .filter(d => !activeSessions.some(s => s.id === d.session.id))
      .map(d => ({
        session: d.session,
        isDying: true,
        visualState: deriveVisualState(d.session, undefined, true),
      })),
  ];

  const workingCount = displayList.filter(d => d.visualState === 'working').length;
  const sleepingCount = displayList.filter(d => d.visualState === 'sleeping').length;

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-4 px-6 py-2 border-b border-gray-800 shrink-0">
        <h1 className="text-lg font-semibold">Office</h1>
        <span className="text-xs text-gray-500">
          {workingCount} working, {sleepingCount} sleeping, {displayList.length} total
        </span>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {displayList.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            The office is empty. No active sessions.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {displayList.map(({ session, visualState }) => (
              <DeskScene
                key={session.id}
                session={session}
                visualState={visualState}
                trackName={trackNames[session.trackId] || session.trackId.slice(0, 8)}
                lastActivityAt={activity[session.id]?.lastActivityAt}
                onAttach={() => setAttachedSession(session)}
              />
            ))}
          </div>
        )}
      </div>

      {attachedSession && (
        <TerminalModal
          trackId={attachedSession.trackId}
          sessionId={attachedSession.id}
          title={attachedSession.name || `session:${attachedSession.id.slice(0, 8)}`}
          onClose={() => setAttachedSession(null)}
        />
      )}
    </div>
  );
}
```

---

#### 2.9 `src/ui/App.tsx` — Add route (2 lines changed)

```typescript
import { OfficeVisualization } from './office/OfficeVisualization';  // NEW import

// In <Routes>, after the /sessions route (line 27):
<Route path="/office" element={<OfficeVisualization />} />
```

---

#### 2.10 `src/ui/TopNav.tsx` — Add nav item (1 line changed)

Add after the Sessions entry in `navItems` array (line 7):

```typescript
{ to: '/office', label: 'Office', end: false },
```

---

#### 2.11 `src/ui/sessions/SessionsPage.tsx` — Cross-link (3 lines changed)

Add a link from the sessions list view to the office view:

```typescript
import { NavLink } from 'react-router-dom';  // NEW import

// In header, after the filter buttons (after line 79):
<NavLink
  to="/office"
  className="text-xs px-2.5 py-1 text-gray-500 hover:text-gray-300 hover:bg-gray-900 rounded transition-colors ml-2"
>
  Office View
</NavLink>
```

---

### Phase 3: Character Art Generation (1 new file)

#### 2.12 New: `scripts/generate-office-sprites.ts` (~80 lines)

Script to generate character sprite sheets via Replicate MCP at development time.

- Uses `create_predictions` with gpt-image-1.5 model
- 8 character variants × 4 poses (typing, sleeping, slumped, walking-away) = 32 PNGs
- All share a style prefix: `"Cartoon pixel-art office worker, chibi proportions, flat colors, thick outlines, dark background #0a0a0a, green monitor glow, retro terminal aesthetic, transparent background, 200x200px"`
- Output: `public/office-sprites/char{1-8}-{pose}.png`
- Run once at development time: `npx tsx scripts/generate-office-sprites.ts`
- Generated assets committed to git (no runtime generation)

**Fallback**: If Replicate is unavailable, provide 4 hand-drawn SVG characters as `public/office-sprites/char{1-4}-{pose}.svg` and adjust the variant count. The component uses `<img>` tags, so either PNG or SVG works.

---

## 3. API Design

### New Endpoint

```
GET /api/sessions/activity
```

**Response** `200 OK`:
```json
{
  "a1b2c3d4-...": {
    "lastActivityAt": "2026-03-21T10:30:15.000Z",
    "visualState": "working"
  },
  "e5f6g7h8-...": {
    "lastActivityAt": "2026-03-21T10:29:45.000Z",
    "visualState": "sleeping"
  }
}
```

Sessions not present in this map have no activity data yet — the frontend treats them as `initializing`.

### Modified Endpoint

```
GET /api/sessions
```

**Breaking behavior change**: No longer calls `syncSessionStates()` synchronously. Data may be up to 30s stale. This is acceptable because:
1. The 30s interval runs regardless
2. WebSocket events push immediate updates for user-initiated actions (create/delete)
3. Prevents blocking the HTTP response when many sessions exist

### New WebSocket Event Types

| Event | Payload | When Emitted |
|-------|---------|-------------|
| `session:dying` | `{ type, trackId, timestamp, sessionId }` | Session detected dead, before DB cleanup (30s window for animation) |
| `session:activity-changed` | `{ type, trackId, timestamp }` | Visual state transition only (working↔sleeping) |

### Existing Events (unchanged)

| Event | When |
|-------|------|
| `session:created` | New session created via API |
| `session:updated` | Session name changed via API |
| `session:deleted` | Session cleaned up by sync or deleted via API |

---

## 4. New Directory Structure

```
src/ui/office/                          # NEW directory
├── OfficeVisualization.tsx              # Main page component (~120 lines)
├── DeskScene.tsx                        # Individual desk unit (~120 lines)
├── useSessionsWithActivity.ts           # Data hook (~90 lines)
├── visualState.ts                       # Pure utility functions (~50 lines)
├── office-animations.css                # CSS keyframes (~90 lines)
└── __tests__/
    ├── visualState.test.ts              # Unit tests for state derivation
    └── characterSelection.test.ts       # Unit tests for sprite selection

public/office-sprites/                   # NEW directory
├── char1-typing.png                     # Generated sprites (32 total)
├── char1-sleeping.png
├── char1-slumped.png
├── char1-walking-away.png
├── char2-typing.png
└── ... (8 variants × 4 poses)

scripts/
└── generate-office-sprites.ts           # NEW: sprite generation script
```

---

## 5. Test Strategy

### 5.1 Unit Tests (Vitest)

#### `src/infrastructure/terminal/__tests__/activity-tracking.test.ts` (NEW, ~80 lines)

1. **`simpleHash` determinism**: same input → same output
2. **`simpleHash` variation**: different inputs → different outputs
3. **`capturePaneOutput` returns empty on exec failure**: mock `execSync` to throw
4. **`getSessionActivity()` empty initially**: no sessions → empty object
5. **Activity updates on hash change**: mock capture returning different content → `lastActivityAt` updates
6. **No activity update when hash unchanged**: same content → same `lastActivityAt`
7. **Visual state transition**: hash unchanged >60s → `visualState` becomes `'sleeping'`
8. **Cleanup on session delete**: verify `activityMap` entry removed

#### `src/ui/office/__tests__/visualState.test.ts` (NEW, ~50 lines)

1. `state: 'dead'` → `'empty'`
2. `state: 'detached'` → `'detached'`
3. `state: 'active'` + `visualState: 'working'` → `'working'`
4. `state: 'active'` + `visualState: 'sleeping'` → `'sleeping'`
5. `state: 'active'` + no activity data → `'initializing'`
6. `isDying: true` → `'dying'` (overrides all)
7. `formatIdleDuration` returns correct human-readable strings

#### `src/ui/office/__tests__/characterSelection.test.ts` (NEW, ~30 lines)

1. Same session ID → same variant number (deterministic)
2. Different session IDs → varied variants (test 10 UUIDs, expect ≥3 unique)
3. Variant always in range `[1, CHAR_VARIANTS]`
4. `getSpritePath` returns correct path format: `/office-sprites/char{N}-{pose}.png`
5. All visual states map to valid pose strings

### 5.2 Integration Test

#### `src/server/__tests__/session-sync-activity.test.ts` (NEW, ~60 lines)

Uses mocked `execSync` to simulate tmux commands:

1. Session with changing pane content → `activityChanged` includes its trackId
2. Session with stable pane content → `activityChanged` empty
3. Session transitioning working→sleeping (>60s idle) → `activityChanged` includes trackId
4. Dead session → appears in `dying` array with sessionId
5. `getSessionActivity()` reflects accumulated state

### 5.3 Manual Testing Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run build` succeeds
- [ ] `npm test` passes (existing + new tests)
- [ ] Start dev server (`npm run dev`)
- [ ] Navigate to `/office` — shows "The office is empty"
- [ ] Create 3+ sessions across tracks/providers → desks appear with typing animation
- [ ] Wait 90s without terminal activity → characters transition to sleeping + Zzz
- [ ] Send activity in a session → character returns to typing within 30s
- [ ] Detach a tmux session externally → grayed out desk with Zzz
- [ ] Kill a tmux session externally → "gone home..." bubble + 30s fade-out
- [ ] Hover any desk → tooltip shows session name, track, provider, idle duration
- [ ] Click an active desk → TerminalModal opens
- [ ] Click a sleeping desk → TerminalModal opens (still active state)
- [ ] TopNav shows "Office" link, navigates correctly
- [ ] SessionsPage shows "Office View" link
- [ ] Responsive: test at 768px, 1024px, 1440px widths
- [ ] No console errors in browser DevTools

---

## 6. Implementation Order

| Step | Files | Depends On |
|------|-------|-----------|
| 1 | `scripts/generate-office-sprites.ts` + run → `public/office-sprites/` | Nothing |
| 2 | `src/infrastructure/terminal/manager.ts` (shared capture, hash, activity map) | Nothing |
| 3 | `src/server/events.ts` (new event types) | Nothing |
| 4 | `src/server/api.ts` (activity endpoint, sync loop changes) | Steps 2-3 |
| 5 | `src/ui/office/visualState.ts` | Nothing |
| 6 | `src/ui/office/office-animations.css` | Nothing |
| 7 | `src/ui/office/DeskScene.tsx` | Steps 5-6 |
| 8 | `src/ui/office/useSessionsWithActivity.ts` | Step 4 (API) |
| 9 | `src/ui/office/OfficeVisualization.tsx` | Steps 7-8 |
| 10 | `src/ui/App.tsx` + `TopNav.tsx` + `SessionsPage.tsx` | Step 9 |
| 11 | Test files | Steps 2, 5 |
| 12 | Typecheck + build + manual verification | All |

Steps 1-3 and 5-6 can be done in parallel. Steps 7-8 can be done in parallel.

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `tmux capture-pane` adds latency to sync loop | Medium | Low | Single call per session (shared); 5s timeout; non-blocking on failure |
| Replicate sprite generation produces inconsistent style | Medium | Low | Shared style prefix; regenerate individual sprites; fallback to hand-drawn SVGs |
| `session:activity-changed` triggers refetch in SessionsPage | Low | Low | SessionsPage listens for `session:` prefix and refetches — but activity-changed is rare (state transitions only), net 1-2 extra fetches per minute |
| GET /sessions data up to 30s stale | Low | Low | 30s interval is acceptable; WS events push immediate updates for user actions |
| 50+ sessions overflows office grid | Low | Medium | CSS grid with `auto-fill` + scrollable container handles this; can add pagination later |
| Server restart resets activity map | Low | Low | First sync cycle repopulates; sessions show as `initializing` briefly then correct |

---

## 8. File Summary

| File | Action | Lines (est.) |
|------|--------|-------------|
| **Backend** | | |
| `src/infrastructure/terminal/manager.ts` | Edit | +60 |
| `src/server/events.ts` | Edit | +15 |
| `src/server/api.ts` | Edit | +20 |
| **Frontend** | | |
| `src/ui/office/OfficeVisualization.tsx` | **New** | ~120 |
| `src/ui/office/DeskScene.tsx` | **New** | ~120 |
| `src/ui/office/useSessionsWithActivity.ts` | **New** | ~90 |
| `src/ui/office/visualState.ts` | **New** | ~50 |
| `src/ui/office/office-animations.css` | **New** | ~90 |
| `src/ui/App.tsx` | Edit | +2 |
| `src/ui/TopNav.tsx` | Edit | +1 |
| `src/ui/sessions/SessionsPage.tsx` | Edit | +3 |
| **Scripts** | | |
| `scripts/generate-office-sprites.ts` | **New** | ~80 |
| **Tests** | | |
| `src/infrastructure/terminal/__tests__/activity-tracking.test.ts` | **New** | ~80 |
| `src/ui/office/__tests__/visualState.test.ts` | **New** | ~50 |
| `src/ui/office/__tests__/characterSelection.test.ts` | **New** | ~30 |
| `src/server/__tests__/session-sync-activity.test.ts` | **New** | ~60 |

**Totals**: 3 backend files edited, 5 new source files, 1 new CSS file, 1 new script, 4 new test files. Zero DB migrations. Zero new npm dependencies.

---

## 9. Files NOT Changed

- `src/foundation/types.ts` — Session type unchanged (activity is ephemeral, in-memory only)
- `src/domain/session/repository.ts` — No new repository methods needed
- `src/infrastructure/persistence/session-repository.ts` — No persistence changes
- `src/infrastructure/persistence/database.ts` — No DB migration

---

## 10. Out of Scope (v1)

- Drag-and-drop desk rearrangement
- Sound effects
- Character customization UI
- Streaming-aware activity detection (build output vs. agent typing)
- Persistent desk layout preferences
- Animation library (Lottie, Framer Motion)
- Dead session "graveyard" view
- Office "floor plan" canvas mode (free-form placement vs. grid)
