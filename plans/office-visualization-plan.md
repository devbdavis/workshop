# Implementation Plan: Cartoon Office Visualization for Active Sessions

> **Revision 5** — Builds on Revision 4. Fixes: GET /sessions sync blocking, test location convention, `create()` type compatibility, and WebSocket debounce for activity events.

## Overview

Build a cartoon "office" visualization at `/office` that shows all active Workshop sessions as animated SVG characters at desks. Animation state reflects session activity (typing vs sleeping vs gone), with click-to-attach terminal interaction.

---

## Architecture

### Data Flow

```
tmux pane output → syncSessionStates() captures + hashes last 20 lines
    → compares to in-memory hash map → if changed, persists lastActivityAt to SQLite
    → returns activityChanged[] in SyncResult
    → api.ts broadcasts session:updated events per affected track
    → frontend WebSocket handler refetches /api/sessions (500ms debounced)
    → OfficeVisualization derives visual state from session.lastActivityAt
    → SVG character CSS class toggles (working/sleeping/floor-sleeping/empty)
    → Click → opens existing TerminalModal
```

### Key Design Decisions

1. **`lastActivityAt` persisted in SQLite** — Survives server restarts. Flows through existing repository/API/frontend pipeline with no new endpoints. Optional field; backward-compatible.

2. **Hash kept in-memory only** — `lastPaneHash: Map<SessionId, string>` is transient. Lost on restart; self-corrects within one 30s sync cycle.

3. **Pure SVG characters with CSS animations** — No sprite generation, no external dependency, no build step. SVG elements colored deterministically from session ID hash. CSS class toggles control animation. GPU-accelerated (`transform`, `opacity`, `filter` only).

4. **No new API endpoints** — `GET /api/sessions` returns Session objects that now include `lastActivityAt`. Existing `session:updated` WebSocket event suffices.

5. **Shared tmux capture** — Single `capturePaneOutput()` call per session per sync cycle. Both `isSessionIdle()` (background reaper) and hash comparison share the same output.

6. **Client-side visual state derivation** — Server stores `lastActivityAt`; client computes `working` vs `sleeping` from a 60s threshold. No presentation logic in the API.

7. **Remove sync-on-GET** — `GET /api/sessions` currently calls `runSessionSync()` synchronously, which would now block for seconds with many sessions due to the added `capturePaneOutput()` calls. The 30s interval is sufficient for freshness.

### Layer Responsibilities

| Layer | Responsibility | Files Changed |
|---|---|---|
| Foundation | Add `lastActivityAt` to Session type | `src/foundation/types.ts` |
| Domain | Add `updateLastActivityAt` to SessionRepository interface | `src/domain/session/repository.ts` |
| Infrastructure | DB migration + repo impl + pane hashing in sync loop | `database.ts`, `session-repository.ts`, `manager.ts` |
| Server | Remove sync-on-GET; broadcast `session:updated` on activity changes | `src/server/api.ts` |
| UI | New OfficeVisualization page + SVG characters + CSS animations | `src/ui/office/` (new), `App.tsx`, `TopNav.tsx`, `index.css` |

---

## Step-by-Step Changes

### Step 1: Foundation — Extend Session Type

**File**: `src/foundation/types.ts`

Add `lastActivityAt` to the `Session` interface (after `updatedAt`, line 71):

```typescript
  /** Timestamp of last observed tmux pane output change (set by sync loop) */
  lastActivityAt?: string;
```

Optional field, so `Omit<Session, 'id' | 'createdAt' | 'updatedAt'>` used in `SessionRepository.create()` still works — callers can omit it since it's optional.

---

### Step 2: Domain — Extend SessionRepository Interface

**File**: `src/domain/session/repository.ts`

Add after `updateClaudeResumeId` (line 11):

```typescript
  updateLastActivityAt(id: SessionId, lastActivityAt: string): Session | null;
```

---

### Step 3: Infrastructure — Persistence Layer

#### 3a. `src/infrastructure/persistence/database.ts` — Migration

After existing session migrations (the same try/catch pattern used for `name`, `provider`, `background` columns):

```typescript
  // Migration: add last_activity_at column to sessions
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN last_activity_at TEXT;`);
  } catch {
    // Column already exists
  }
```

#### 3b. `src/infrastructure/persistence/session-repository.ts`

Four changes:

**i. Prepared statement** (near line 20, after `updateClaudeResumeIdStmt`):
```typescript
const updateLastActivityAtStmt = db.prepare(
  'UPDATE sessions SET last_activity_at = ?, updated_at = ? WHERE id = ?'
);
```

**ii. New method** (after `updateClaudeResumeId`, ~line 82):
```typescript
updateLastActivityAt(id: SessionId, lastActivityAt: string): Session | null {
  const now = new Date().toISOString();
  const result = updateLastActivityAtStmt.run(lastActivityAt, now, id);
  if (result.changes === 0) return null;
  return this.findById(id);
},
```

**iii. SessionRow interface** — add field (line ~98):
```typescript
last_activity_at: string | null;
```

**iv. rowToSession()** — add mapping (line ~117, after `updatedAt`):
```typescript
lastActivityAt: row.last_activity_at || undefined,
```

---

### Step 4: Infrastructure — Tmux Pane Hashing

**File**: `src/infrastructure/terminal/manager.ts`

Six sub-changes:

#### 4a. Shared capture function (replaces inline `execSync` in `isSessionIdle`)

New function, placed near the top of `createTerminalManager` (after the `idleFirstSeen` map):

```typescript
/** Capture the last N lines of a tmux pane. Returns empty string on failure. */
function capturePaneOutput(tmuxSession: string, lines = 20): string {
  try {
    return execSync(
      `tmux capture-pane -t ${tmuxSession} -p | tail -${lines}`,
      { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 },
    );
  } catch {
    return '';
  }
}
```

#### 4b. Refactor `isSessionIdle` to accept pre-captured output

Replace the existing `isSessionIdle(session: Session)` function (lines 70-84) with:

```typescript
/** Check if captured pane output shows an idle CLI prompt */
function isSessionIdleFromOutput(output: string): boolean {
  const lines = output.trimEnd().split('\n');
  const lastLine = lines[lines.length - 1]?.trim() || '';
  return lastLine === '❯' || lastLine.endsWith('❯') || lastLine === '>';
}
```

#### 4c. In-memory hash map (alongside `idleFirstSeen`, line ~67)

```typescript
/** Previous pane content hash, keyed by session ID */
const lastPaneHash = new Map<string, string>();
```

#### 4d. djb2 hash function

```typescript
/** Fast string hash for pane content comparison */
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(36);
}
```

#### 4e. Extend SyncResult

```typescript
export interface SyncResult {
  cleaned: { sessionId: SessionId; trackId: TrackId }[];
  activityChanged: { sessionId: SessionId; trackId: TrackId }[];
}
```

#### 4f. Restructure `syncSessionStates()` main loop

Current structure only checks activity for `alive && session.background`. New structure runs activity hashing for ALL alive sessions, with background reaping nested inside:

```typescript
syncSessionStates(): SyncResult {
  const allSessions = sessionRepo.findAll();
  const cleaned: SyncResult['cleaned'] = [];
  const activityChanged: SyncResult['activityChanged'] = [];

  for (const session of allSessions) {
    const alive = this.isSessionAlive(session);

    if (!alive && session.state !== 'dead') {
      // Dead tmux — clean up (existing logic)
      try {
        execSync(`tmux kill-session -t ${session.tmuxSession}`, { stdio: 'pipe' });
      } catch { /* Already dead */ }
      cleanSessionDir(session.id);
      sessionRepo.delete(session.id);
      idleFirstSeen.delete(session.id);
      lastPaneHash.delete(session.id);  // NEW: clean hash map
      cleaned.push({ sessionId: session.id, trackId: session.trackId });

    } else if (alive && session.state === 'dead') {
      // Revive (existing, unchanged)
      sessionRepo.updateState(session.id, 'active');

    } else if (alive) {
      // ── Activity tracking for ALL alive sessions (NEW) ──
      const paneOutput = capturePaneOutput(session.tmuxSession);
      if (paneOutput) {
        const hash = hashString(paneOutput);
        const prevHash = lastPaneHash.get(session.id);
        lastPaneHash.set(session.id, hash);

        if (prevHash !== undefined && hash !== prevHash) {
          // Output changed → update activity timestamp
          sessionRepo.updateLastActivityAt(session.id, new Date().toISOString());
          activityChanged.push({ sessionId: session.id, trackId: session.trackId });
        } else if (prevHash === undefined && !session.lastActivityAt) {
          // First observation → seed initial activity timestamp
          sessionRepo.updateLastActivityAt(session.id, new Date().toISOString());
        }
      }

      // ── Background session reaping (existing logic, uses shared paneOutput) ──
      if (session.background) {
        if (isSessionIdleFromOutput(paneOutput)) {
          const idleMinutes = getIdleMinutes(session);
          if (idleMinutes >= BACKGROUND_IDLE_TIMEOUT_MINUTES) {
            console.log(
              `Session sync: reaping idle background session ${session.id} ` +
              `(${session.tmuxSession}, idle ${Math.round(idleMinutes)}m)`,
            );
            try {
              execSync(`tmux kill-session -t ${session.tmuxSession}`, { stdio: 'pipe' });
            } catch { /* already dead */ }
            cleanSessionDir(session.id);
            sessionRepo.delete(session.id);
            idleFirstSeen.delete(session.id);
            lastPaneHash.delete(session.id);
            cleaned.push({ sessionId: session.id, trackId: session.trackId });
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
  return { cleaned, activityChanged };
}
```

**Performance**: `capturePaneOutput` adds ~5-10ms per session (piped `execSync` + `tail`). 50 sessions ≈ 500ms. Well within the 30s interval. The `updateLastActivityAt` DB write is only triggered when hashes differ, not every cycle.

---

### Step 5: Server — Update Sync Loop and Remove Sync-on-GET

**File**: `src/server/api.ts`

**a) Update `runSessionSync()`** to broadcast activity changes:

```typescript
function runSessionSync() {
  const result = terminal.syncSessionStates();
  for (const { trackId } of result.cleaned) {
    broadcast('session:deleted', trackId);
  }
  // Broadcast activity changes, deduplicated by trackId
  if (result.activityChanged.length > 0) {
    const trackIds = new Set(result.activityChanged.map(u => u.trackId));
    for (const trackId of trackIds) {
      broadcast('session:updated', trackId);
    }
  }
}
```

**b) Remove synchronous `runSessionSync()` from GET /sessions** (line 422):

Before:
```typescript
router.get('/sessions', (_req, res) => {
  runSessionSync();
  const allSessions = sessions.findAll();
  res.json(allSessions);
});
```

After:
```typescript
router.get('/sessions', (_req, res) => {
  // Activity tracking in syncSessionStates() now runs capturePaneOutput() per session,
  // which would block this request. Rely on the 30s interval instead.
  const allSessions = sessions.findAll();
  res.json(allSessions);
});
```

This is the most consequential behavioral change in the plan. The existing code guarantees perfectly fresh data on every GET. After this change, data is at most ~30s stale. This is acceptable because:
- WebSocket events provide near-real-time notifications that trigger re-fetches
- The office visualization itself only needs 30s granularity
- The SessionsPage also benefits from non-blocking GETs

---

### Step 6: Frontend — Office Visualization

New directory `src/ui/office/` with four files:

#### 6a. `src/ui/office/activity.ts` (~30 lines)

Pure functions for visual state derivation + idle duration formatting:

```typescript
import type { Session } from '@foundation/types';

export type ActivityState = 'working' | 'sleeping' | 'floor-sleeping' | 'empty';

/** Derive visual state from session data + lastActivityAt */
export function getActivityState(session: Session): ActivityState {
  if (session.state === 'dead') return 'empty';
  if (session.state === 'detached') return 'floor-sleeping';

  // Active session
  if (!session.lastActivityAt) return 'working'; // Optimistic: no data yet means probably working
  const idleMs = Date.now() - new Date(session.lastActivityAt).getTime();
  return idleMs > 60_000 ? 'sleeping' : 'working';
}

/** Human-readable idle duration */
export function getIdleDuration(session: Session): string {
  if (!session.lastActivityAt) return '';
  const ms = Date.now() - new Date(session.lastActivityAt).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3600_000)}h`;
}
```

#### 6b. `src/ui/office/OfficeVisualization.tsx` (~130 lines)

Main page component. Structure:

```
OfficeVisualization
  ├── header (title + active count)
  ├── OfficeGrid (responsive CSS grid)
  │   └── OfficeDeskUnit[] (one per visible session)
  └── TerminalModal (existing, shown on click)
```

Data flow:
- `useCallback` `loadData` fetches `GET /api/sessions` + `GET /api/tracks`
- WebSocket subscription on `session:*` events with **500ms debounce** to prevent fetch storms during activity broadcasts
- Filters out dead sessions by default
- Click on active session opens `TerminalModal` (same pattern as `SessionsPage`)

Grid layout: `grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4`

Empty state: "The office is empty — no active sessions" centered message.

#### 6c. `src/ui/office/OfficeDeskUnit.tsx` (~90 lines)

Individual desk card. Props: `session`, `activityState`, `trackName`, `onAttach`.

Contains:
- `CharacterSvg` (the desk+person SVG)
- Name plate: session name (or truncated ID) + track name
- Provider badge: top-right corner, color-coded (claude=blue, codex=red, gemini=yellow)
- Background badge: small "bg" indicator if `session.background`
- Idle duration label (shown for sleeping state): e.g., "idle 5m"
- Hover tooltip (absolute div): full metadata — name, track, provider, state, background, last active, created time
- Click handler: calls `onAttach` for active sessions, no-op for others
- Cursor: `pointer` for active sessions, `default` for others

#### 6d. `src/ui/office/CharacterSvg.tsx` (~130 lines)

SVG cartoon character at desk. Deterministic appearance from session ID:

```typescript
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
```

Hash selects from 5 hair colors × 5 shirt colors × 5 skin tones = 125 unique combinations.

SVG elements (all simple primitives — rects, circles, paths):
- Desk surface + legs (rect)
- Monitor + stand (rect + line)
- Monitor screen content (green text lines for working, blank for sleeping)
- Character: head (circle), hair (path, varies by hash), eyes (circles), body (rect), arms (paths), legs (rects)
- Zzz text elements (3 staggered, hidden by default, shown via CSS class)

The component accepts an `activityState` prop and applies the corresponding CSS class: `office-char-working`, `office-char-sleeping`, `office-char-floor-sleeping`, or `office-char-empty`.

---

### Step 7: CSS Animations

**File**: `src/ui/index.css` (append ~65 lines)

Four animation states:

```css
/* ── Office Character Animations ── */

/* Working: typing bob on arms, green monitor glow */
@keyframes office-typing {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-1.5px); }
}

@keyframes office-monitor-glow {
  0%, 100% { filter: drop-shadow(0 0 3px #22c55e40); }
  50% { filter: drop-shadow(0 0 6px #22c55e80); }
}

.office-char-working .char-arms { animation: office-typing 0.5s ease-in-out infinite; }
.office-char-working .char-monitor { animation: office-monitor-glow 2s ease-in-out infinite; }
.office-char-working .char-zzz { display: none; }

/* Sleeping: slumped, Zzz floating up */
@keyframes office-zzz-float {
  0% { opacity: 0; transform: translate(0, 0) scale(0.6); }
  20% { opacity: 1; }
  100% { opacity: 0; transform: translate(8px, -25px) scale(1.2); }
}

.office-char-sleeping .char-body { transform: translateY(3px); }
.office-char-sleeping .char-eyes { transform: scaleY(0.1); }
.office-char-sleeping .char-zzz { display: block; }
.office-char-sleeping .z1 { animation: office-zzz-float 2s ease-out infinite; }
.office-char-sleeping .z2 { animation: office-zzz-float 2s ease-out 0.6s infinite; }
.office-char-sleeping .z3 { animation: office-zzz-float 2s ease-out 1.2s infinite; }
.office-char-sleeping .char-monitor { opacity: 0.4; }

/* Detached: on floor, dimmed, Zzz */
.office-char-floor-sleeping .char-body { transform: translate(10px, 20px) rotate(-80deg); }
.office-char-floor-sleeping .char-eyes { transform: scaleY(0.1); }
.office-char-floor-sleeping .char-zzz { display: block; }
.office-char-floor-sleeping .z1 { animation: office-zzz-float 2.5s ease-out infinite; }
.office-char-floor-sleeping .z2 { animation: office-zzz-float 2.5s ease-out 0.8s infinite; }
.office-char-floor-sleeping .z3 { animation: office-zzz-float 2.5s ease-out 1.6s infinite; }
.office-char-floor-sleeping .char-monitor { opacity: 0.2; }
.office-char-floor-sleeping { opacity: 0.6; }

/* Empty: no character, dimmed desk */
.office-char-empty .char-body,
.office-char-empty .char-head,
.office-char-empty .char-arms,
.office-char-empty .char-eyes,
.office-char-empty .char-zzz { display: none; }
.office-char-empty .char-monitor { opacity: 0.15; }
.office-char-empty { opacity: 0.3; }

/* Desk entrance animation */
@keyframes office-desk-appear {
  from { opacity: 0; transform: scale(0.92) translateY(8px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.office-desk-unit { animation: office-desk-appear 0.3s ease-out; }
```

All animations use `transform`, `opacity`, `filter` — GPU-accelerated, no layout reflow.

---

### Step 8: Routing + Navigation

**`src/ui/App.tsx`** — Add import and route:

```typescript
import { OfficeVisualization } from './office/OfficeVisualization';
// In Routes (after /sessions):
<Route path="/office" element={<OfficeVisualization />} />
```

**`src/ui/TopNav.tsx`** — Add to `navItems` array (after the Sessions entry, line 7):

```typescript
{ to: '/office', label: 'Office', end: false },
```

---

## File Summary

| # | File | Action | Est. Lines Changed |
|---|---|---|---|
| 1 | `src/foundation/types.ts` | Edit | +2 |
| 2 | `src/domain/session/repository.ts` | Edit | +1 |
| 3 | `src/infrastructure/persistence/database.ts` | Edit | +5 |
| 4 | `src/infrastructure/persistence/session-repository.ts` | Edit | +15 |
| 5 | `src/infrastructure/terminal/manager.ts` | Edit | +45 |
| 6 | `src/server/api.ts` | Edit | +10 (−2 for removing runSessionSync call) |
| 7 | **`src/ui/office/activity.ts`** | **New** | ~30 |
| 8 | **`src/ui/office/OfficeVisualization.tsx`** | **New** | ~130 |
| 9 | **`src/ui/office/OfficeDeskUnit.tsx`** | **New** | ~90 |
| 10 | **`src/ui/office/CharacterSvg.tsx`** | **New** | ~130 |
| 11 | `src/ui/index.css` | Edit | +65 |
| 12 | `src/ui/App.tsx` | Edit | +2 |
| 13 | `src/ui/TopNav.tsx` | Edit | +1 |
| 14 | **`tests/application/office-activity.test.ts`** | **New** | ~60 |
| 15 | **`tests/domain/office-character.test.ts`** | **New** | ~30 |

**Total**: ~616 lines across 15 files (6 new, 9 modified). All files under 300-line limit.

---

## Files NOT Changed

- **`src/server/events.ts`** — No new event types needed. Reuses `session:updated`.
- **`src/server/websocket.ts`** — Terminal WebSocket bridge, unrelated.
- **`src/ui/sessions/SessionsPage.tsx`** — Could add a cross-link, but not required for v1.

---

## Implementation Order

```
Step 1 (types.ts)
  → Step 2 (repo interface)
    → Step 3 (DB migration + repo impl)
      → Step 4 (terminal manager: capture, hash, sync)
        → Step 5 (api.ts: sync loop + remove sync-on-GET)
          → Step 6-8 (all frontend: office components + routing)
```

Steps 6-8 (frontend) can be developed in parallel with Steps 2-5 (backend) since the frontend only needs `lastActivityAt` on the Session type — it can be stubbed/undefined during development.

**Commits** (incremental per project convention):
1. Backend: Steps 1-5 (types + domain + infra + server)
2. Frontend: Steps 6-8 (office UI + CSS + routing)
3. Tests: Step 9 (test files)

---

## Test Strategy

### Unit Tests

**`tests/application/office-activity.test.ts`** (~60 lines):

Tests for `getActivityState()` pure function:

| Test Case | Input | Expected |
|---|---|---|
| Dead session | `state: 'dead'` | `'empty'` |
| Detached session | `state: 'detached'` | `'floor-sleeping'` |
| Active, recent output | `state: 'active', lastActivityAt: 30s ago` | `'working'` |
| Active, idle >60s | `state: 'active', lastActivityAt: 90s ago` | `'sleeping'` |
| Active, no activity data | `state: 'active', lastActivityAt: undefined` | `'working'` |
| Boundary: exactly 60s | `state: 'active', lastActivityAt: 60s ago` | `'sleeping'` |

Tests for `getIdleDuration()`:

| Test Case | Input | Expected |
|---|---|---|
| No data | `lastActivityAt: undefined` | `''` |
| Seconds | `lastActivityAt: 45s ago` | `'45s'` |
| Minutes | `lastActivityAt: 5m ago` | `'5m'` |
| Hours | `lastActivityAt: 2h ago` | `'2h'` |

**`tests/domain/office-character.test.ts`** (~30 lines):

Tests for `hashCode()` determinism:

| Test Case | Assertion |
|---|---|
| Same ID, same result | `hashCode('abc') === hashCode('abc')` |
| Different IDs, different results | `hashCode('abc') !== hashCode('xyz')` |
| 5 UUIDs produce ≥3 unique color combos | Set size ≥ 3 |

### Existing Test Compatibility

Run `npm test` — existing session repository tests should pass unchanged since:
- `lastActivityAt` is an optional field (no breaking change to create signature)
- The `ALTER TABLE ADD COLUMN` migration is idempotent
- `rowToSession()` gracefully handles `null` → `undefined`

### Manual Test Checklist

- [ ] Start 3+ sessions across different tracks → characters appear at desks typing
- [ ] Wait 60s with no terminal activity → characters transition to sleeping with Zzz
- [ ] Send input to a sleeping session → character wakes up within 30s
- [ ] Detach a tmux session → character moves to floor-sleeping
- [ ] Kill a session → desk empties / disappears
- [ ] Click a working character → TerminalModal opens and attaches
- [ ] Hover over desk → tooltip shows session name, track, provider, state, idle duration
- [ ] Resize browser → grid reflows responsively
- [ ] Provider badges show correct colors (claude=blue, codex=red, gemini=yellow)
- [ ] Background sessions show "bg" badge
- [ ] Navigate to `/office` via TopNav link
- [ ] Verify dark theme consistency (gray-950 background, gray-100 text)
- [ ] Different sessions show visually distinct characters (varied hair/shirt/skin)

### Build Validation

```bash
npm run typecheck   # SyncResult extension + new interface method compile
npm test            # All existing + new tests pass
npm run build       # Production bundle succeeds
```

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `tmux capture-pane` latency with many sessions | 5s timeout per call; shared call (not double); skip on failure |
| Hash false positives (timestamps in output trigger constant "working") | Acceptable for v1; spec acknowledges. Content-heavy sessions stay "working" |
| SVG animation jank at 20+ sessions | CSS-only, GPU-accelerated; `will-change: transform` if needed |
| Server restart loses hash map | Self-corrects in one 30s cycle; `lastActivityAt` persisted in SQLite |
| Synchronous `execSync` blocks event loop during sync | Existing pattern; 30s interval is wide; could move to async worker in v2 |
| Removing sync-on-GET makes session list stale | Data is at most 30s old; WebSocket events push updates in near-real-time |
| `updateLastActivityAt` DB writes on every hash change | SQLite WAL mode handles frequent small writes well; only triggered when output actually changes |

---

## Out of Scope (v1)

- Sound effects, drag-to-rearrange, custom character selection
- Real-time streaming detection (needs per-session WebSocket)
- Dying/walking-away animation (dead = empty desk for v1)
- Separate activity endpoint, sprite generation via AI
- Async tmux capture (v2 optimization)

---

**Plan file**: `/Users/fabian.haupt/projects/workshop/plans/office-visualization-plan.md`
