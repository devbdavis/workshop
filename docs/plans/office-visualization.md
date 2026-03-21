# Implementation Plan: Cartoon Office Visualization

## Architecture Overview

The feature adds a `/office` route that renders active Workshop sessions as cartoon characters in an SVG office scene. Each session is a desk with a character whose animation state reflects real-time activity. The backend enhancement is minimal: add tmux pane hashing to the existing `syncSessionStates()` loop so the frontend can distinguish "actively producing output" from "idle."

```
                    ┌─────────────────────────────────────┐
                    │           Browser (React)            │
                    │                                      │
                    │  /office route                       │
                    │   ├─ GET /api/sessions (initial)     │
                    │   ├─ WS /ws/events (live updates)    │
                    │   └─ OfficeVisualization.tsx          │
                    │       ├─ OfficeDeskUnit.tsx (per-     │
                    │       │   session desk + character)   │
                    │       ├─ OfficeTooltip.tsx            │
                    │       └─ TerminalModal (click-thru)   │
                    └────────────┬────────────────────────┘
                                 │
              ───── HTTP / WS ───┤
                                 │
                    ┌────────────▼────────────────────────┐
                    │        Express Server (api.ts)       │
                    │                                      │
                    │  syncSessionStates() — every 30s     │
                    │   └─ tmux capture-pane hashing       │
                    │   └─ updates lastActivityAt on       │
                    │      Session if output changed       │
                    │   └─ broadcasts session:updated      │
                    └─────────────────────────────────────┘
```

---

## File Change Inventory

| # | File | Action | Lines (est.) | Description |
|---|------|--------|-------------|-------------|
| 1 | `src/foundation/types.ts` | Edit | +1 | Add `lastActivityAt?: string` to Session |
| 2 | `src/infrastructure/terminal/manager.ts` | Edit | +25 | Pane hashing + lastActivityAt updates in syncSessionStates |
| 3 | `src/domain/session/repository.ts` | Edit | +1 | Add `updateLastActivity` method |
| 4 | `src/infrastructure/persistence/database.ts` | Edit | +8 | Migration for `last_activity_at` column + repo method impl |
| 5 | `src/infrastructure/persistence/session-repository.ts` | Edit | +10 | Implement `updateLastActivity`, include field in row mapping |
| 6 | `src/server/api.ts` | Edit | +3 | Broadcast `session:updated` when activity changes |
| 7 | `src/ui/sessions/OfficeVisualization.tsx` | **New** | ~250 | Main office scene component |
| 8 | `src/ui/sessions/OfficeDeskUnit.tsx` | **New** | ~180 | Single desk + character SVG with animation states |
| 9 | `src/ui/sessions/OfficeTooltip.tsx` | **New** | ~60 | Hover tooltip with session metadata |
| 10 | `src/ui/sessions/office-characters.ts` | **New** | ~80 | Character appearance generation from session ID hash |
| 11 | `src/ui/sessions/office-animations.css` | **New** | ~100 | CSS keyframe animations (typing, sleeping, Zzz) |
| 12 | `src/ui/App.tsx` | Edit | +2 | Add `/office` route |
| 13 | `src/ui/TopNav.tsx` | Edit | +1 | Add "Office" nav item |
| 14 | `tests/infrastructure/terminal/activity-hash.test.ts` | **New** | ~50 | Unit tests for pane hash logic |
| 15 | `tests/ui/office-characters.test.ts` | **New** | ~40 | Unit tests for deterministic character generation |

**Total new files: 7 | Modified files: 8 | Estimated new lines: ~810**

---

## Step-by-Step Implementation

### Step 1: Backend — Add `lastActivityAt` to Session type

**File: `src/foundation/types.ts`** (line 71)

Add one field to the `Session` interface:

```typescript
export interface Session {
  // ... existing fields ...
  updatedAt: string;
  lastActivityAt?: string;  // ← NEW: ISO timestamp of last tmux output change
}
```

**Why optional?** Existing sessions created before this change won't have it. The frontend treats `undefined` as "unknown activity" and falls back to showing the session as working (safe default).

---

### Step 2: Backend — DB migration for `last_activity_at`

**File: `src/infrastructure/persistence/database.ts`**

Add migration block (follows existing pattern at lines 184-216):

```typescript
// Migration: add last_activity_at column to sessions
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN last_activity_at TEXT;`);
} catch {
  // Column already exists — safe to ignore
}
```

**File: `src/infrastructure/persistence/session-repository.ts`**

- Add `last_activity_at` to the row-to-Session mapping (same pattern as `name`, `provider`, `background`)
- Implement `updateLastActivity(id: SessionId, timestamp: string): void`:
  ```sql
  UPDATE sessions SET last_activity_at = ?, updated_at = ? WHERE id = ?
  ```

**File: `src/domain/session/repository.ts`**

Add to interface:
```typescript
updateLastActivity(id: SessionId, timestamp: string): void;
```

---

### Step 3: Backend — Tmux pane hashing in syncSessionStates

**File: `src/infrastructure/terminal/manager.ts`**

This is the core backend change. Add an in-memory hash map and integrate with the existing sync loop.

```typescript
// At module level inside createTerminalManager():
/** Track content hash of last 20 lines per session for activity detection */
const lastPaneHash = new Map<string, number>();

/** Simple string hash (djb2) — no crypto dependency needed */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}
```

Inside `syncSessionStates()`, after the existing `alive && session.background` block (line 497), add a new block for ALL alive sessions:

```typescript
// Activity detection: hash tmux pane content to detect output changes
if (alive) {
  try {
    const output = execSync(
      `tmux capture-pane -t ${session.tmuxSession} -p | tail -20`,
      { stdio: 'pipe', encoding: 'utf-8', timeout: 2000 },
    );
    const hash = hashString(output);
    const prevHash = lastPaneHash.get(session.id);
    lastPaneHash.set(session.id, hash);

    if (prevHash !== undefined && hash !== prevHash) {
      // Output changed — session is producing work
      sessionRepo.updateLastActivity(session.id, new Date().toISOString());
      activityChanged.push(session);
    }
  } catch {
    // tmux pane read failed — skip this cycle
  }
}
```

**Changes to `syncSessionStates` return type:**

```typescript
export interface SyncResult {
  cleaned: { sessionId: SessionId; trackId: TrackId }[];
  activityUpdated: { sessionId: SessionId; trackId: TrackId }[];  // NEW
}
```

**Changes to `src/server/api.ts` (line 76):**

```typescript
function runSessionSync() {
  const result = terminal.syncSessionStates();
  for (const { trackId } of result.cleaned) {
    broadcast('session:deleted', trackId);
  }
  // NEW: broadcast activity changes so office view updates in real-time
  for (const { trackId } of result.activityUpdated) {
    broadcast('session:updated', trackId);
  }
}
```

**Memory cleanup:** When a session is cleaned/deleted in `syncSessionStates`, also call `lastPaneHash.delete(session.id)` (same pattern as existing `idleFirstSeen.delete()`).

---

### Step 4: Frontend — Character generation utility

**New file: `src/ui/sessions/office-characters.ts`**

Deterministic character appearance from session ID. Hash the ID to select from predefined traits:

```typescript
export interface CharacterAppearance {
  skinTone: string;       // hex color
  hairColor: string;      // hex color
  hairStyle: 'short' | 'long' | 'bun' | 'spiky' | 'bald';
  shirtColor: string;     // hex color
  accessory: 'none' | 'glasses' | 'headphones' | 'hat';
}

/**
 * Generate a consistent character look from a session ID.
 * Same ID always produces the same character.
 */
export function generateCharacter(sessionId: string): CharacterAppearance { ... }
```

Uses a seeded PRNG from the session ID hash. Pools:
- 6 skin tones, 5 hair colors, 5 hair styles, 8 shirt colors, 4 accessories
- Total combinations: 6 × 5 × 5 × 8 × 4 = 4,800 unique looks

---

### Step 5: Frontend — CSS animations

**New file: `src/ui/sessions/office-animations.css`**

```css
/* Typing animation: character hands bob up and down */
@keyframes typing-hands {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}

/* Monitor screen flicker for active typing */
@keyframes screen-flicker {
  0%, 100% { opacity: 0.9; }
  50% { opacity: 1; }
}

/* Zzz bubble floating up */
@keyframes zzz-float {
  0% { opacity: 0; transform: translate(0, 0) scale(0.5); }
  20% { opacity: 1; transform: translate(2px, -5px) scale(0.8); }
  80% { opacity: 0.8; transform: translate(-2px, -15px) scale(1); }
  100% { opacity: 0; transform: translate(0, -20px) scale(1.2); }
}

/* Gentle breathing for sleeping character */
@keyframes breathing {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(1.02); }
}

/* Empty desk subtle pulse */
@keyframes desk-empty-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.5; }
}

.office-typing .hands    { animation: typing-hands 0.3s infinite; }
.office-typing .screen   { animation: screen-flicker 2s infinite; }
.office-sleeping .body   { animation: breathing 3s ease-in-out infinite; }
.office-sleeping .zzz    { animation: zzz-float 2.5s ease-out infinite; }
.office-sleeping .zzz:nth-child(2) { animation-delay: 0.8s; }
.office-sleeping .zzz:nth-child(3) { animation-delay: 1.6s; }
.office-empty             { animation: desk-empty-pulse 4s ease-in-out infinite; }
```

Import in `OfficeVisualization.tsx` via standard CSS import.

---

### Step 6: Frontend — OfficeDeskUnit component

**New file: `src/ui/sessions/OfficeDeskUnit.tsx`** (~180 lines)

Each unit is a self-contained SVG group rendering one desk + character. Props:

```typescript
interface OfficeDeskUnitProps {
  session: Session;
  trackName: string;
  character: CharacterAppearance;
  onHover: (session: Session, rect: DOMRect) => void;
  onLeave: () => void;
  onClick: (session: Session) => void;
}
```

**Visual state derivation** (pure function, no backend field needed for state/detached/dead):

```typescript
type VisualState = 'working' | 'sleeping' | 'floor-sleeping' | 'empty';

function deriveVisualState(session: Session): VisualState {
  if (session.state === 'dead') return 'empty';
  if (session.state === 'detached') return 'floor-sleeping';
  // Active session: check lastActivityAt
  if (!session.lastActivityAt) return 'working'; // unknown = assume working
  const idleMs = Date.now() - new Date(session.lastActivityAt).getTime();
  return idleMs > 60_000 ? 'sleeping' : 'working';
}
```

**SVG structure per desk unit** (viewBox 0 0 120 140):

```
┌──────────────────────┐
│    [Monitor]         │  ← Rectangle with colored screen
│   ┌──────────┐       │
│   │  ░░░░░░  │       │  ← Screen content (green flicker when working)
│   └──────────┘       │
│     ┌──┐             │  ← Character body (circle head + rectangle torso)
│     │  │  ← hands    │  ← Hands on keyboard (animated when typing)
│  ═══╧══╧═══          │  ← Desk surface
│  │        │           │  ← Desk legs
│                       │
│  "session-name"       │  ← Label below desk
└──────────────────────┘
```

For `floor-sleeping`: Character is drawn lying horizontally beside the desk instead of sitting.

For `empty`: Desk only, no character, muted opacity.

The character head, hair, shirt, and accessory are rendered using the `CharacterAppearance` traits. All elements use CSS classes (`office-typing`, `office-sleeping`, `office-empty`) applied to the SVG group for animation.

---

### Step 7: Frontend — OfficeTooltip component

**New file: `src/ui/sessions/OfficeTooltip.tsx`** (~60 lines)

Follows the existing `DiagramTooltip.tsx` pattern:

```typescript
interface OfficeTooltipProps {
  session: Session;
  trackName: string;
  position: { x: number; y: number };
}
```

Content:
- **Session name** (bold)
- **Track**: track name
- **Provider**: claude / codex / gemini (with icon badge)
- **Status**: Active (working) / Active (idle Xm) / Detached / Dead
- **Background**: yes/no badge
- **Created**: relative time ("2h ago")

Styling: `bg-gray-900 border border-gray-700 rounded-lg shadow-xl` with `pointer-events-none`, positioned via `fixed` at mouse coordinates with viewport edge clamping.

---

### Step 8: Frontend — Main OfficeVisualization component

**New file: `src/ui/sessions/OfficeVisualization.tsx`** (~250 lines)

```typescript
export function OfficeVisualization() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [attachedSession, setAttachedSession] = useState<Session | null>(null);
  const [showDead, setShowDead] = useState(false);

  // ... data loading (same pattern as SessionsPage) ...
  // ... WebSocket subscription for session:* events ...
```

**Layout algorithm:**

```typescript
// Responsive grid: fill available width, wrap to rows
// Each desk unit is 120x140 in SVG space, rendered at ~150x170px with padding
const DESK_WIDTH = 160;   // px including padding
const DESK_HEIGHT = 180;  // px including padding

// Calculate columns based on container width
const cols = Math.max(1, Math.floor(containerWidth / DESK_WIDTH));
```

**Filtering:**
- By default, hide `dead` sessions (toggle to show empty desks)
- Option to filter by track

**Render structure:**

```tsx
<div className="h-full flex flex-col">
  <header> {/* Title + filter controls + dead toggle */} </header>

  <div className="flex-1 overflow-y-auto p-6" ref={containerRef}>
    <div className="flex flex-wrap gap-4 justify-start">
      {visibleSessions.map(session => (
        <OfficeDeskUnit
          key={session.id}
          session={session}
          trackName={trackNames[session.trackId]}
          character={generateCharacter(session.id)}
          onHover={handleHover}
          onLeave={handleLeave}
          onClick={handleClick}
        />
      ))}
      {visibleSessions.length === 0 && (
        <EmptyOffice />  {/* "The office is empty" message */}
      )}
    </div>
  </div>

  {tooltip && <OfficeTooltip {...tooltip} />}
  {attachedSession && <TerminalModal ... />}
</div>
```

**Real-time animation updates:** The `deriveVisualState()` runs on every render. Since `lastActivityAt` is updated via WebSocket → refetch, the animation classes switch automatically. A `useEffect` with a 30-second interval also re-evaluates idle states client-side (for the 60s idle threshold) without waiting for a server push.

---

### Step 9: Route and nav integration

**File: `src/ui/App.tsx`** (line 28)

```typescript
import { OfficeVisualization } from './sessions/OfficeVisualization';
// ...
<Route path="/office" element={<OfficeVisualization />} />
```

**File: `src/ui/TopNav.tsx`** (line 8, in navItems array)

```typescript
{ to: '/office', label: 'Office', end: false },
```

Place it after the existing Sessions nav item for discoverability.

---

## Activity State Derivation (Complete Logic)

```
                    ┌──────────────┐
                    │ session.state │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
           'dead'     'detached'    'active'
              │            │            │
              ▼            ▼            │
          ┌────────┐  ┌──────────┐     │
          │ EMPTY  │  │  FLOOR   │     │
          │ desk   │  │ SLEEPING │     │
          └────────┘  └──────────┘     │
                                       │
                            ┌──────────┴──────────┐
                            │  lastActivityAt?     │
                            └──────────┬──────────┘
                                       │
                          ┌────────────┼────────────┐
                          ▼            ▼            ▼
                       undefined   < 60s ago    >= 60s ago
                          │            │            │
                          ▼            ▼            ▼
                      ┌────────┐  ┌────────┐  ┌──────────┐
                      │WORKING │  │WORKING │  │ SLEEPING │
                      │(assume)│  │(typing)│  │ (in chair│
                      └────────┘  └────────┘  │  + Zzz)  │
                                              └──────────┘
```

---

## API Surface

**No new endpoints.** All data flows through existing infrastructure:

| Concern | Mechanism | Existing? |
|---------|-----------|-----------|
| Initial session list | `GET /api/sessions` | Yes |
| Session state changes | WS `session:created`, `session:updated`, `session:deleted` | Yes |
| Activity data | `lastActivityAt` field on Session response | New field on existing response |
| Track names | `GET /api/tracks` | Yes |
| Terminal attach | `WS /ws/tracks/:trackId/sessions/:sessionId/terminal` | Yes |

The only data contract change is the addition of `lastActivityAt?: string` to the Session JSON response. This is backward-compatible (optional field).

---

## Test Strategy

### Unit Tests

**1. `tests/infrastructure/terminal/activity-hash.test.ts`**

```typescript
describe('hashString', () => {
  it('returns consistent hash for same input', ...);
  it('returns different hash for different input', ...);
  it('handles empty string', ...);
});

describe('activity detection in syncSessionStates', () => {
  it('sets lastActivityAt when pane content changes between cycles', ...);
  it('does not update lastActivityAt when pane content is unchanged', ...);
  it('cleans up hash map when session is deleted', ...);
  it('handles tmux capture-pane failure gracefully', ...);
});
```

**Approach:** Extract `hashString` as a named export for direct unit testing. For `syncSessionStates`, mock `execSync` to simulate tmux responses. The existing test pattern in the codebase uses Vitest.

**2. `tests/ui/office-characters.test.ts`**

```typescript
describe('generateCharacter', () => {
  it('returns same appearance for same session ID', ...);
  it('returns different appearance for different session IDs', ...);
  it('all fields are valid values from the pool', ...);
});
```

**3. `tests/ui/office-visual-state.test.ts`**

```typescript
describe('deriveVisualState', () => {
  it('returns "empty" for dead sessions', ...);
  it('returns "floor-sleeping" for detached sessions', ...);
  it('returns "working" for active sessions with recent activity', ...);
  it('returns "sleeping" for active sessions idle > 60s', ...);
  it('returns "working" for active sessions with no lastActivityAt', ...);
});
```

### Integration Validation

- **Manual**: Start 3+ sessions across different tracks/providers, verify they appear in the office view with correct states
- **Manual**: Leave a session idle for 60+ seconds, verify transition from typing to sleeping animation
- **Manual**: Click a character, verify TerminalModal opens with correct session
- **Manual**: Kill a tmux session externally, verify desk transitions to empty (or disappears) within 30s
- **Typecheck**: `npm run typecheck` — ensures branded ID types and Session interface changes propagate correctly
- **Build**: `npm run build` — ensures CSS imports and new route resolve

### What We Don't Test (v1)

- Visual regression (no screenshot testing infrastructure exists)
- Animation timing (CSS animations are declarative, not logic)
- WebSocket reconnection (existing pattern, not new code)

---

## Implementation Order

Recommended commit sequence (each is independently shippable):

1. **Backend: types + migration + repo method** (Steps 1-2)
   - `types.ts`, `repository.ts`, `database.ts`, `session-repository.ts`
   - Safe: adds optional field, no behavior change

2. **Backend: pane hashing in syncSessionStates** (Step 3)
   - `manager.ts`, `api.ts`
   - Feature: sessions now get `lastActivityAt` populated

3. **Frontend: character generation + CSS** (Steps 4-5)
   - `office-characters.ts`, `office-animations.css`
   - Utility code, no UI yet

4. **Frontend: desk unit + tooltip** (Steps 6-7)
   - `OfficeDeskUnit.tsx`, `OfficeTooltip.tsx`
   - Components, not yet routed

5. **Frontend: main view + routing** (Steps 8-9)
   - `OfficeVisualization.tsx`, `App.tsx`, `TopNav.tsx`
   - Feature goes live

6. **Tests** (can run in parallel with steps 3-5)

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `tmux capture-pane` adds latency to sync loop | Sync loop takes >30s, overlapping calls | 2-second timeout per `execSync` call; skip on failure |
| Many sessions (20+) make office view cluttered | Hard to find specific sessions | Responsive grid + track filter + search (v2) |
| SVG character rendering is complex | Slow initial development | Start with minimal geometry (circles + rectangles), iterate on polish |
| `lastActivityAt` column migration on prod DB | Could fail if DB is locked | Uses try/catch pattern matching all other migrations |

---

## Known Limitations (v1)

Per the spec:
- **Streaming false positives**: A session tailing build output shows as "working" even if the agent is idle
- **30s granularity**: Activity detection tied to sync loop interval
- **Character variety**: Start with 5 hair styles, 6 skin tones, 8 shirt colors — expand later
- **No persistence of visual state**: Derived on the fly from `lastActivityAt`; if the server restarts, all sessions appear as "working" until the next sync cycle establishes baseline hashes

---

## File Paths

```
src/foundation/types.ts
src/domain/session/repository.ts
src/infrastructure/persistence/database.ts
src/infrastructure/persistence/session-repository.ts
src/infrastructure/terminal/manager.ts
src/server/api.ts
src/ui/App.tsx
src/ui/TopNav.tsx
src/ui/sessions/OfficeVisualization.tsx
src/ui/sessions/OfficeDeskUnit.tsx
src/ui/sessions/OfficeTooltip.tsx
src/ui/sessions/office-characters.ts
src/ui/sessions/office-animations.css
tests/infrastructure/terminal/activity-hash.test.ts
tests/ui/office-characters.test.ts
tests/ui/office-visual-state.test.ts
```

Plan file: `/Users/fabian.haupt/projects/workshop/docs/plans/office-visualization.md`
