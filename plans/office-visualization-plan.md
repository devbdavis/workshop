# Implementation Plan: Cartoon Office Visualization for Active Sessions

> **Revision 6** — Major revision incorporating all human answers and resolving all 5 blocking findings from the workflow critique. Key changes from R5: in-memory-only activity tracking (no DB migration), dying animation with speech bubble, Replicate sprite generation, combined pane capture, preserved idle-detection safety guards.

## Discussion Answers (from workflow 687e8f06)

These answers override prior assumptions. Each is annotated with the blocking finding it resolves.

| # | Question | Answer | Resolved Finding |
|---|---|---|---|
| 1 | `lastActivityAt` storage strategy? | **"in memory is fine"** | B1: Plan was persisting to SQLite |
| 2 | Broadcast `session:updated` on activity changes? | **"sure"** | (already planned, confirmed) |
| 3 | Should hash detection and idle detection share the capture call? | **"let's combine those"** | B5: Duplicate tmux capture |
| 4 | Dead session visual? | **"let's have a visual where the agent leaves the room.. slowly fades out (over 30 sec) with a 'dying' speech bubble"** | B2: Dying animation was out of scope |
| 5 | Character art source? | **"we use the replicate mcp with gpt-image-1.5. make sure you have a consistent style basis for all prompts for this."** | B3: Replicate sprites were out of scope |

---

## Architecture

### Data Flow

```
tmux pane output → syncSessionStates() calls shared capturePaneLines()
    → hash comparison via in-memory Map<SessionId, string>
    → if changed, updates in-memory lastActivityAt Map<SessionId, string>
    → returns activityChanged[] in SyncResult
    → api.ts broadcasts session:updated events per affected track
    → api.ts enriches GET /api/sessions responses from in-memory activity map
    → frontend WebSocket handler refetches /api/sessions (500ms debounced)
    → OfficeVisualization derives visual state from session.lastActivityAt
    → Replicate-generated sprite (or SVG fallback) with CSS animation class
    → Click → opens existing TerminalModal
```

### Key Design Decisions

1. **`lastActivityAt` is in-memory only** — `Map<SessionId, string>` in the terminal manager. Lost on restart; self-corrects within one 30s sync cycle. The API layer enriches session objects from this map before responding. **No DB migration, no repository changes, no prepared statements.** (Answer 1)

2. **Hash kept in-memory only** — `Map<SessionId, string>` for pane content hashes. Same lifecycle as `lastActivityAt` and `idleFirstSeen`.

3. **Replicate-generated character sprites** — Each session gets a unique character image generated via Replicate MCP (`gpt-image-1.5`). Cached as PNGs in `~/.workshop/sprites/`. SVG fallback renders immediately while sprites are generating. Consistent style prompt ensures visual cohesion. (Answer 5)

4. **No new API endpoints for sessions** — `GET /api/sessions` returns Session objects enriched with `lastActivityAt` from the in-memory map. One new endpoint: `GET /api/sprites/:hash.png` serves cached sprites. Existing `session:updated` WebSocket event suffices.

5. **Single shared pane capture** — `capturePaneLines()` in `pane-detection.ts` is refactored to accept optional pre-captured output. `syncSessionStates()` calls `capturePaneLines()` once per session and passes the result to `isSessionIdle()`, `isSessionLoggedOut()`, and `isSessionExited()`. No duplicate capture calls. (Answer 3)

6. **Dying animation with soft-delete delay** — When tmux dies, session enters `dying` state (in-memory `Map<SessionId, number>`) for 30 seconds before actual cleanup. Frontend shows fade-out animation + "I'm dying..." speech bubble. After 30s, the next sync cycle reaps normally. (Answer 4)

7. **Preserved idle-detection safety guards** — `isSessionIdle()` retains the `Running…|Thinking|thinking` active-work-indicator check and the scan-last-N-lines logic from `pane-detection.ts`. Only refactored to accept pre-captured lines, not rewritten. (Resolves B4)

8. **Client-side visual state derivation** — Server provides `lastActivityAt` timestamp; client computes `working` vs `sleeping` from a 60s threshold. `dying` state comes from the session state field.

9. **Remove sync-on-GET** — `GET /api/sessions` no longer calls `runSessionSync()` synchronously. The 30s interval + WebSocket events provide sufficient freshness.

### Layer Responsibilities

| Layer | Responsibility | Files Changed |
|---|---|---|
| Foundation | Add `lastActivityAt` to Session type (optional, not persisted) | `src/foundation/types.ts` |
| Domain | Extend SyncResult with `activityChanged` and `dying` | `src/domain/terminal/manager.ts` |
| Infrastructure | Refactor pane-detection for shared capture; add activity hashing + dying delay in sync loop | `pane-detection.ts`, `manager.ts` |
| Server | Enrich sessions from activity map; broadcast changes; serve sprites | `src/server/api.ts` |
| UI | Office visualization page + sprite/SVG characters + CSS animations | `src/ui/office/` (new), `App.tsx`, `TopNav.tsx`, `index.css` |

---

## Step-by-Step Changes

### Step 1: Foundation — Extend Session Type

**File**: `src/foundation/types.ts`

Add `lastActivityAt` to the `Session` interface (after `updatedAt`):

```typescript
  /** Timestamp of last observed tmux pane output change (in-memory only, set by sync loop) */
  lastActivityAt?: string;
```

Optional field. Not persisted in SQLite — enriched by the API layer from the terminal manager's in-memory map.

**No changes to**: `SessionRepository`, `database.ts`, `session-repository.ts`. (This is the primary difference from R5.)

---

### Step 2: Domain — Extend SyncResult

**File**: `src/domain/terminal/manager.ts`

Update the existing `SyncResult` interface:

```typescript
export interface SyncResult {
  cleaned: { sessionId: SessionId; trackId: TrackId }[];
  suspended: { sessionId: SessionId; trackId: TrackId }[];
  dying: { sessionId: SessionId; trackId: TrackId }[];
  activityChanged: TrackId[];
}
```

New fields:
- `dying` — sessions that just entered the dying state this cycle (for WS broadcast)
- `activityChanged` — deduplicated track IDs where activity changed (for WS broadcast)

---

### Step 3: Infrastructure — Refactor Pane Detection for Shared Capture

**File**: `src/infrastructure/terminal/pane-detection.ts`

Refactor all three detection functions to accept optional pre-captured lines. This eliminates duplicate `tmux capture-pane` calls when the sync loop has already captured output.

```typescript
import { execSync } from 'child_process';
import type { Session } from '@foundation/types';

/** Capture the last N non-empty lines from a tmux pane */
export function capturePaneLines(tmuxSession: string, count = 20): string[] {
  try {
    const output = execSync(
      `tmux capture-pane -t ${tmuxSession} -p`,
      { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 },
    );
    return output.trimEnd().split('\n').filter(l => l.trim() !== '').slice(-count);
  } catch {
    return [];
  }
}

/** Check if the tmux pane shows an idle CLI prompt (❯ or > at end).
 *  Scans last several lines (Claude TUI renders status bar below prompt).
 *  Verifies no active work indicator (spinner/thinking) is present.
 *  Accepts optional pre-captured lines to avoid duplicate tmux calls. */
export function isSessionIdle(session: Session, preCapture?: string[]): boolean {
  const lines = preCapture ?? capturePaneLines(session.tmuxSession, 8);
  if (lines.length === 0) return false;
  const tail = lines.join(' ');
  // Active work indicators — if any are present, session is NOT idle
  if (/Running…|Thinking|thinking/.test(tail)) return false;
  return lines.some(line => {
    const t = line.trim();
    return t === '❯' || t === '>' || t.endsWith('❯');
  });
}

/** Check if the session shows Claude is not logged in.
 *  Accepts optional pre-captured lines. */
export function isSessionLoggedOut(session: Session, preCapture?: string[]): boolean {
  const lines = preCapture ?? capturePaneLines(session.tmuxSession, 10);
  const tail = lines.join(' ');
  return /not logged in|Please run \/login/i.test(tail);
}

/** Check if the CLI process has exited and the pane shows a bare shell.
 *  Accepts optional pre-captured lines. */
export function isSessionExited(session: Session, preCapture?: string[]): boolean {
  const lines = preCapture ?? capturePaneLines(session.tmuxSession, 5);
  if (lines.length === 0) return false;
  const lastLine = lines[lines.length - 1]?.trim() || '';
  return /^[$%]$/.test(lastLine) || /^➜\s/.test(lastLine);
}
```

Key points:
- All functions gain an optional `preCapture?: string[]` parameter
- When omitted, they capture pane output themselves (backward-compatible)
- When provided by the sync loop, no duplicate `tmux capture-pane` call occurs
- `isSessionIdle()` retains the `Running…|Thinking|thinking` safety guard (resolves B4)
- Added `timeout: 5000` to `capturePaneLines()` to prevent hangs

---

### Step 4: Infrastructure — Activity Tracking + Dying Delay in Sync Loop

**File**: `src/infrastructure/terminal/manager.ts`

Five sub-changes:

#### 4a. New in-memory maps (alongside `idleFirstSeen`)

```typescript
/** Previous pane content hash, keyed by session ID */
const lastPaneHash = new Map<string, string>();

/** Last activity timestamp (ISO string), keyed by session ID — NOT persisted */
const lastActivityAt = new Map<string, string>();

/** When a session entered the dying state (epoch ms) */
const dyingSince = new Map<string, number>();
```

#### 4b. Expose activity map for API enrichment

Add to the returned object:

```typescript
getLastActivityAt(sessionId: SessionId): string | undefined {
  return lastActivityAt.get(sessionId);
},
```

#### 4c. djb2 hash function (internal to createTerminalManager)

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

#### 4d. Clean maps in destroySession()

Add to `destroySession()` after `idleFirstSeen.delete(sessionId)`:

```typescript
lastPaneHash.delete(sessionId);
lastActivityAt.delete(sessionId);
dyingSince.delete(sessionId);
```

#### 4e. Restructured `syncSessionStates()` main loop

The core change. Adds activity hashing for all alive sessions, shared pane capture, and dying delay:

```typescript
syncSessionStates(): SyncResult {
  const syncStart = Date.now();
  const allSessions = sessionRepo.findAll();
  const cleaned: SyncResult['cleaned'] = [];
  const suspended: SyncResult['suspended'] = [];
  const dying: SyncResult['dying'] = [];
  const activityChangedTracks = new Set<TrackId>();

  for (const session of allSessions) {
    if (session.state === 'suspended') continue;

    const alive = this.isSessionAlive(session);

    // ── Dead tmux: dying delay instead of immediate reap ──
    if (!alive && session.state !== 'dead') {
      if (dyingSince.has(session.id)) {
        // Already dying — check if 30s have passed
        const elapsed = Date.now() - dyingSince.get(session.id)!;
        if (elapsed >= 30_000) {
          // Grace period over — reap or suspend
          dyingSince.delete(session.id);
          if (session.claudeResumeId && session.provider === 'claude') {
            // (existing suspend logic)
            console.log(`Session sync: suspending ${session.id} (resume: ${session.claudeResumeId}) — dying period ended`);
            sessionRepo.updateState(session.id, 'suspended');
            idleFirstSeen.delete(session.id);
            lastPaneHash.delete(session.id);
            lastActivityAt.delete(session.id);
            suspended.push({ sessionId: session.id, trackId: session.trackId });
          } else {
            // (existing reap logic)
            try {
              execSync(`tmux kill-session -t ${session.tmuxSession}`, { stdio: 'pipe' });
            } catch { /* already dead */ }
            cleanSessionDir(session.id);
            sessionRepo.delete(session.id);
            idleFirstSeen.delete(session.id);
            lastPaneHash.delete(session.id);
            lastActivityAt.delete(session.id);
            cleaned.push({ sessionId: session.id, trackId: session.trackId });
          }
        }
        // else: still within grace period, skip
      } else {
        // First detection — start dying period
        dyingSince.set(session.id, Date.now());
        dying.push({ sessionId: session.id, trackId: session.trackId });
      }
      continue;
    }

    // Session came back alive while dying — cancel the dying state
    if (alive && dyingSince.has(session.id)) {
      dyingSince.delete(session.id);
    }

    // Marked dead in DB but tmux is alive — resurrect
    if (alive && session.state === 'dead') {
      sessionRepo.updateState(session.id, 'active');
      continue;
    }

    if (!alive) continue;

    // ── Activity tracking for ALL alive sessions ──
    const capturedLines = capturePaneLines(session.tmuxSession, 20);
    if (capturedLines.length > 0) {
      const joined = capturedLines.join('\n');
      const hash = hashString(joined);
      const prevHash = lastPaneHash.get(session.id);
      lastPaneHash.set(session.id, hash);

      if (prevHash !== undefined && hash !== prevHash) {
        lastActivityAt.set(session.id, new Date().toISOString());
        activityChangedTracks.add(session.trackId);
      } else if (prevHash === undefined && !lastActivityAt.has(session.id)) {
        // First observation — seed initial activity timestamp
        lastActivityAt.set(session.id, new Date().toISOString());
      }
    }

    // ── Background session cleanup (uses shared capturedLines) ──
    if (session.background) {
      if (isSessionLoggedOut(session, capturedLines)) {
        reap(session, 'background: Claude not logged in');
        continue;
      }
      if (isSessionExited(session, capturedLines)) {
        reap(session, 'background: CLI exited (bare shell prompt)');
        continue;
      }
      if (isSessionIdle(session, capturedLines)) {
        const idleMinutes = getIdleMinutes(session);
        if (idleMinutes >= BACKGROUND_IDLE_TIMEOUT_MINUTES) {
          reap(session, `background: idle ${Math.round(idleMinutes)}m`);
        }
      } else {
        idleFirstSeen.delete(session.id);
      }
    }
  }

  const syncMs = Date.now() - syncStart;
  if (syncMs > 1000) {
    console.warn(`Session sync took ${syncMs}ms (${allSessions.length} sessions) — consider async capture`);
  }
  if (cleaned.length > 0) {
    console.log(`Session sync: cleaned up ${cleaned.length} dead/idle session(s)`);
  }
  if (suspended.length > 0) {
    console.log(`Session sync: suspended ${suspended.length} resumable session(s)`);
  }
  if (dying.length > 0) {
    console.log(`Session sync: ${dying.length} session(s) entered dying state`);
  }
  return { cleaned, suspended, dying, activityChanged: [...activityChangedTracks] };
}
```

Note: the `reap()` helper already exists in the current code. The above adds `lastPaneHash.delete()`, `lastActivityAt.delete()`, and `dyingSince.delete()` calls into it.

**Also update `TerminalManager` interface** to include the new method:

```typescript
export interface TerminalManager {
  createSession(trackId: TrackId, options?: CreateSessionOptions): Promise<Session>;
  destroySession(sessionId: SessionId): Promise<void>;
  isSessionAlive(session: Session): boolean;
  syncSessionStates(): SyncResult;
  resumeSuspendedSessions(): Promise<Session[]>;
  /** Get in-memory last-activity timestamp for a session */
  getLastActivityAt(sessionId: SessionId): string | undefined;
  /** Check if a session is in the dying grace period */
  isDying(sessionId: SessionId): boolean;
}
```

Add `isDying` implementation:

```typescript
isDying(sessionId: SessionId): boolean {
  return dyingSince.has(sessionId);
},
```

---

### Step 5: Server — Enrich Responses, Broadcast Changes, Serve Sprites

**File**: `src/server/api.ts`

#### 5a. Update `runSessionSync()` to broadcast activity + dying events

```typescript
function runSessionSync() {
  const result = terminal.syncSessionStates();
  for (const { trackId } of result.cleaned) {
    broadcast('session:deleted', trackId);
  }
  for (const { trackId } of result.suspended) {
    broadcast('session:updated', trackId);
  }
  for (const { trackId } of result.dying) {
    broadcast('session:updated', trackId);
  }
  for (const trackId of result.activityChanged) {
    broadcast('session:updated', trackId);
  }
}
```

#### 5b. Enrich GET /sessions with in-memory activity data

```typescript
router.get('/sessions', (_req, res) => {
  // No longer calls runSessionSync() — would block with capture-pane calls.
  // 30s interval + WebSocket events provide sufficient freshness.
  const allSessions = sessions.findAll();
  const enriched = allSessions.map(s => ({
    ...s,
    lastActivityAt: terminal.getLastActivityAt(s.id as SessionId),
    dying: terminal.isDying(s.id as SessionId),
  }));
  res.json(enriched);
});
```

#### 5c. Static sprite serving

```typescript
import { existsSync } from 'fs';
import path from 'path';

const SPRITE_DIR = path.join(process.env.HOME || '/tmp', '.workshop', 'sprites');

router.get('/sprites/:filename', (req, res) => {
  const filePath = path.join(SPRITE_DIR, req.params.filename);
  if (!existsSync(filePath)) {
    res.status(404).send('Not found');
    return;
  }
  res.sendFile(filePath);
});
```

---

### Step 6: Sprite Generation via Replicate

**New file**: `src/infrastructure/sprites/sprite-generator.ts` (~80 lines)

Generates character sprites via Replicate MCP and caches them locally.

```typescript
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import path from 'path';

const SPRITE_DIR = path.join(process.env.HOME || '/tmp', '.workshop', 'sprites');
const PENDING = new Set<string>();

/** Consistent style basis for all character prompts */
const STYLE_BASIS = [
  'Pixar-style 3D cartoon character sitting at a modern desk with a computer monitor.',
  'Soft ambient lighting, clean cel-shaded look, slightly exaggerated proportions.',
  'Solid color background (#111827). Viewed from a 3/4 angle.',
  'High detail on face and hands. Warm, friendly expression.',
].join(' ');

/** Deterministic appearance traits from a hash number */
function traitsFromHash(hash: number): string {
  const hairColors = ['dark brown', 'blonde', 'red', 'black', 'silver gray'];
  const shirtColors = ['blue', 'green', 'purple', 'orange', 'red'];
  const accessories = ['glasses', 'headphones', 'a hat', 'a scarf', 'no accessories'];
  return [
    `${hairColors[hash % 5]} hair`,
    `${shirtColors[Math.floor(hash / 5) % 5]} shirt`,
    `wearing ${accessories[Math.floor(hash / 25) % 5]}`,
  ].join(', ');
}

/** Hash a string to a stable number for trait selection */
function stableHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export interface SpriteGenerator {
  /** Get sprite filename for a session ID. Returns undefined if not yet cached. */
  getSpriteFilename(sessionId: string): string | undefined;
  /** Queue sprite generation for a session ID (no-op if already cached/pending). */
  queueGeneration(sessionId: string): void;
}

export function createSpriteGenerator(): SpriteGenerator {
  mkdirSync(SPRITE_DIR, { recursive: true });

  function filenameFor(sessionId: string): string {
    const hash = stableHash(sessionId);
    return `char-${hash % 125}.png`;
  }

  return {
    getSpriteFilename(sessionId: string): string | undefined {
      const filename = filenameFor(sessionId);
      const filePath = path.join(SPRITE_DIR, filename);
      return existsSync(filePath) ? filename : undefined;
    },

    queueGeneration(sessionId: string): void {
      const filename = filenameFor(sessionId);
      const filePath = path.join(SPRITE_DIR, filename);
      if (existsSync(filePath) || PENDING.has(filename)) return;
      PENDING.add(filename);

      // NOTE: Actual Replicate API call is made via the Replicate MCP tool
      // from a background Claude session or manual invocation.
      // This queues the prompt and parameters for generation.
      const hash = stableHash(sessionId);
      const traits = traitsFromHash(hash);
      const prompt = `${STYLE_BASIS} Character has ${traits}.`;

      console.log(`Sprite queued: ${filename} — "${traits}"`);
      // Generation is handled externally — see "Sprite Generation Workflow" below
      // The queue stores prompt metadata for the generation worker
      const metaPath = path.join(SPRITE_DIR, `${filename}.prompt.json`);
      writeFileSync(metaPath, JSON.stringify({ prompt, model: 'gpt-image-1.5', filename }));
    },
  };
}
```

#### Sprite Generation Workflow

Sprite generation is **async and external** — it does not block the office visualization:

1. `queueGeneration()` writes a `.prompt.json` sidecar file to `~/.workshop/sprites/`
2. A background Claude session (or manual invocation) reads pending `.prompt.json` files
3. Calls `mcp__replicate__create_predictions` with model `gpt-image-1.5` and the prompt
4. Downloads the result PNG to `~/.workshop/sprites/{filename}.png`
5. Removes the `.prompt.json` sidecar
6. Frontend polls/re-renders on next data refresh — sprite appears

**All 125 unique trait combinations** can be pre-generated in a single batch run, then reused across all sessions.

---

### Step 7: Frontend — Office Visualization

New directory `src/ui/office/` with five files:

#### 7a. `src/ui/office/activity.ts` (~40 lines)

Pure functions for visual state derivation:

```typescript
import type { Session } from '@foundation/types';

export type ActivityState = 'working' | 'sleeping' | 'floor-sleeping' | 'dying' | 'empty';

/** Derive visual state from session data */
export function getActivityState(session: Session & { dying?: boolean }): ActivityState {
  if ((session as any).dying) return 'dying';
  if (session.state === 'dead') return 'empty';
  if (session.state === 'suspended') return 'floor-sleeping';

  if (!session.lastActivityAt) return 'working';
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

/** Provider badge color */
export function providerColor(provider: string): string {
  switch (provider) {
    case 'claude': return 'bg-blue-500';
    case 'codex': return 'bg-red-500';
    case 'gemini': return 'bg-yellow-500';
    default: return 'bg-gray-500';
  }
}
```

#### 7b. `src/ui/office/OfficeVisualization.tsx` (~120 lines)

Main page component:

```
OfficeVisualization
  ├── header (title + active count)
  ├── OfficeGrid (responsive CSS grid)
  │   └── OfficeDeskUnit[] (one per visible session)
  └── TerminalModal (existing, shown on click)
```

Data flow:
- Fetch tracks **once on mount** (tracks rarely change)
- Fetch sessions on mount and on WebSocket `session:*` events (500ms debounced)
- Sessions include `lastActivityAt` and `dying` from enriched API response
- Dying sessions are shown (with fade-out animation) for up to 30s
- Dead sessions with no dying flag are filtered out
- Click on active session opens `TerminalModal`

Grid: `grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4`

Empty state: "The office is empty — no active sessions" centered.

#### 7c. `src/ui/office/OfficeDeskUnit.tsx` (~100 lines)

Individual desk card. Props: `session`, `activityState`, `trackName`, `spriteUrl`, `onAttach`.

Contains:
- Character image: `<img>` if sprite URL available, `<CharacterSvg>` fallback
- Name plate: session name (or truncated ID) + track name
- Provider badge: top-right, color from `providerColor()`
- Background badge: small "bg" pill if `session.background`
- Idle duration label (sleeping states): "idle 5m"
- Dying state: "I'm dying..." speech bubble overlay, entire card fading out
- Hover tooltip (absolute div): name, track, provider, state, background, last active, created
- Click: `onAttach` for active sessions, no-op for dying/sleeping
- Cursor: `pointer` for active, `default` for others

#### 7d. `src/ui/office/CharacterSvg.tsx` (~130 lines)

SVG fallback character (used when Replicate sprite not yet cached).

Deterministic appearance from session ID hash → 5 hair colors × 5 shirt colors × 5 skin tones = 125 combinations.

SVG elements (simple primitives):
- Desk surface + legs (rect)
- Monitor + stand (rect + line)
- Monitor screen content (green text lines for working, blank for sleeping)
- Character: head, hair, eyes, body, arms, legs
- Zzz text elements (staggered, CSS-controlled visibility)

Accepts `activityState` prop → CSS class: `office-char-working`, `office-char-sleeping`, etc.

Uses `transform-box: fill-box` on SVG `<g>` elements for consistent Firefox behavior.

#### 7e. `src/ui/office/SpeechBubble.tsx` (~30 lines)

SVG speech bubble overlay for the dying state:

```typescript
interface Props {
  text: string;
}

export function SpeechBubble({ text }: Props) {
  return (
    <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/4
                    bg-white text-gray-900 text-xs px-2 py-1 rounded-lg
                    shadow-md office-speech-bubble">
      {text}
      {/* Tail triangle */}
      <div className="absolute bottom-0 left-3 translate-y-full
                      w-0 h-0 border-l-4 border-r-4 border-t-4
                      border-transparent border-t-white" />
    </div>
  );
}
```

---

### Step 8: CSS Animations

**File**: `src/ui/index.css` (append ~80 lines)

Five animation states (was four in R5 — added `dying`):

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

.office-char-sleeping .char-body { transform: translateY(3px); transform-box: fill-box; }
.office-char-sleeping .char-eyes { transform: scaleY(0.1); transform-box: fill-box; }
.office-char-sleeping .char-zzz { display: block; }
.office-char-sleeping .z1 { animation: office-zzz-float 2s ease-out infinite; }
.office-char-sleeping .z2 { animation: office-zzz-float 2s ease-out 0.6s infinite; }
.office-char-sleeping .z3 { animation: office-zzz-float 2s ease-out 1.2s infinite; }
.office-char-sleeping .char-monitor { opacity: 0.4; }

/* Suspended/detached: on floor, dimmed */
.office-char-floor-sleeping .char-body { transform: translate(10px, 20px) rotate(-80deg); transform-box: fill-box; }
.office-char-floor-sleeping .char-eyes { transform: scaleY(0.1); transform-box: fill-box; }
.office-char-floor-sleeping .char-zzz { display: block; }
.office-char-floor-sleeping .z1 { animation: office-zzz-float 2.5s ease-out infinite; }
.office-char-floor-sleeping .z2 { animation: office-zzz-float 2.5s ease-out 0.8s infinite; }
.office-char-floor-sleeping .z3 { animation: office-zzz-float 2.5s ease-out 1.6s infinite; }
.office-char-floor-sleeping .char-monitor { opacity: 0.2; }
.office-char-floor-sleeping { opacity: 0.6; }

/* Dying: fade out over 30s with speech bubble */
@keyframes office-dying-fade {
  0% { opacity: 1; }
  70% { opacity: 0.6; }
  100% { opacity: 0; transform: scale(0.9) translateY(10px); }
}

@keyframes office-speech-pulse {
  0%, 100% { transform: scale(1) translate(-50%, -100%); }
  50% { transform: scale(1.05) translate(-50%, -100%); }
}

.office-char-dying {
  animation: office-dying-fade 30s ease-in forwards;
  pointer-events: none;
}

.office-speech-bubble {
  animation: office-speech-pulse 2s ease-in-out infinite;
}

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

All animations use `transform`, `opacity`, `filter` — GPU-accelerated. `transform-box: fill-box` on SVG elements for Firefox compatibility.

---

### Step 9: Routing + Navigation

**`src/ui/App.tsx`** — Add import and route:

```typescript
import { OfficeVisualization } from './office/OfficeVisualization';
// In Routes (after /sessions):
<Route path="/office" element={<OfficeVisualization />} />
```

**`src/ui/TopNav.tsx`** — Add to `navItems` array:

```typescript
{ to: '/office', label: 'Office', end: false },
```

---

## File Summary

| # | File | Action | Est. Lines |
|---|---|---|---|
| 1 | `src/foundation/types.ts` | Edit | +2 |
| 2 | `src/domain/terminal/manager.ts` | Edit | +8 |
| 3 | `src/infrastructure/terminal/pane-detection.ts` | Edit | +12 (add preCapture params + timeout) |
| 4 | `src/infrastructure/terminal/manager.ts` | Edit | +60 (maps, hash, dying delay, shared capture) |
| 5 | `src/server/api.ts` | Edit | +25 (enrich, broadcast, sprite serving) |
| 6 | **`src/infrastructure/sprites/sprite-generator.ts`** | **New** | ~80 |
| 7 | **`src/ui/office/activity.ts`** | **New** | ~40 |
| 8 | **`src/ui/office/OfficeVisualization.tsx`** | **New** | ~120 |
| 9 | **`src/ui/office/OfficeDeskUnit.tsx`** | **New** | ~100 |
| 10 | **`src/ui/office/CharacterSvg.tsx`** | **New** | ~130 |
| 11 | **`src/ui/office/SpeechBubble.tsx`** | **New** | ~30 |
| 12 | `src/ui/index.css` | Edit | +80 |
| 13 | `src/ui/App.tsx` | Edit | +2 |
| 14 | `src/ui/TopNav.tsx` | Edit | +1 |
| 15 | **`tests/application/office-activity.test.ts`** | **New** | ~80 |
| 16 | **`tests/infrastructure/pane-detection.test.ts`** | **New** | ~50 |

**Total**: ~820 lines across 16 files (7 new, 9 modified). All files under 300-line limit.

### Files NOT Changed (vs R5)

- ~~`src/domain/session/repository.ts`~~ — No `updateLastActivityAt` method needed (in-memory)
- ~~`src/infrastructure/persistence/database.ts`~~ — No migration needed (in-memory)
- ~~`src/infrastructure/persistence/session-repository.ts`~~ — No prepared statements needed (in-memory)
- `src/server/events.ts` — Reuses `session:updated`
- `src/server/websocket.ts` — Terminal WebSocket bridge, unrelated

---

## Implementation Order

```
Step 1 (types.ts)
  → Step 2 (SyncResult in domain)
    → Step 3 (pane-detection.ts refactor)
      → Step 4 (manager.ts: maps, hash, dying, shared capture)
        → Step 5 (api.ts: enrich, broadcast, sprite serving)
          → Step 6 (sprite-generator.ts)
            → Step 7-9 (frontend: office components + CSS + routing)
```

Steps 7-9 (frontend) can be developed in parallel with Steps 3-6 (backend) since the frontend only needs the enriched Session type.

**Commits** (incremental):
1. Backend core: Steps 1-4 (types + domain + pane-detection refactor + manager)
2. Server + sprites: Steps 5-6 (API enrichment + sprite infrastructure)
3. Frontend: Steps 7-9 (office UI + CSS + routing)
4. Tests: Step 10

---

## Test Strategy

### Unit Tests

**`tests/application/office-activity.test.ts`** (~80 lines):

Tests for `getActivityState()`:

| Test Case | Input | Expected |
|---|---|---|
| Dying session | `dying: true` | `'dying'` |
| Dead session (not dying) | `state: 'dead'` | `'empty'` |
| Suspended session | `state: 'suspended'` | `'floor-sleeping'` |
| Active, recent output | `lastActivityAt: 30s ago` | `'working'` |
| Active, idle >60s | `lastActivityAt: 90s ago` | `'sleeping'` |
| Active, no activity data | `lastActivityAt: undefined` | `'working'` |
| Boundary: exactly 60s | `lastActivityAt: 60s ago` | `'sleeping'` |

Tests for `getIdleDuration()`:

| Test Case | Input | Expected |
|---|---|---|
| No data | `undefined` | `''` |
| Seconds | `45s ago` | `'45s'` |
| Minutes | `5m ago` | `'5m'` |
| Hours | `2h ago` | `'2h'` |

Tests for `providerColor()`:

| Test Case | Expected |
|---|---|
| `'claude'` | `'bg-blue-500'` |
| `'codex'` | `'bg-red-500'` |
| `'unknown'` | `'bg-gray-500'` |

**`tests/infrastructure/pane-detection.test.ts`** (~50 lines):

Tests for refactored `isSessionIdle()` with pre-captured input:

| Test Case | Input | Expected |
|---|---|---|
| Prompt line `❯` | `['some output', '❯']` | `true` |
| Active work: `Thinking` present | `['Thinking...', '❯']` | `false` (safety guard) |
| Active work: `Running…` present | `['Running…', '❯']` | `false` (safety guard) |
| No prompt indicator | `['some output', 'more output']` | `false` |
| Empty lines | `[]` | `false` |

### Manual Test Checklist

- [ ] Start 3+ sessions → characters appear at desks typing (sprite or SVG fallback)
- [ ] Wait 60s idle → characters transition to sleeping with Zzz
- [ ] Send input to sleeping session → character wakes up within 30s
- [ ] Kill a tmux session → "I'm dying..." speech bubble, 30s fade-out, then removal
- [ ] Suspended session → floor-sleeping visual
- [ ] Click working character → TerminalModal opens
- [ ] Hover desk → tooltip with full metadata
- [ ] Resize browser → grid reflows
- [ ] Provider badges: claude=blue, codex=red, gemini=yellow
- [ ] Background sessions show "bg" badge
- [ ] Navigate via TopNav "Office" link
- [ ] Sprites load from `~/.workshop/sprites/` when cached
- [ ] SVG fallback renders when sprites not yet generated
- [ ] Different sessions show visually distinct characters
- [ ] Verify `Running…`/`Thinking` sessions are NOT detected as idle (safety guard)
- [ ] Dark theme consistency (gray-950 background, gray-100 text)

### Build Validation

```bash
npm run typecheck   # SyncResult extension + TerminalManager interface compile
npm test            # All existing + new tests pass
npm run build       # Production bundle succeeds
```

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `capturePaneLines` latency with many sessions | 5s timeout; single shared call per session; skip on failure; log warning >1s |
| Hash false positives (timestamps trigger constant "working") | Acceptable for v1; content-heavy sessions stay "working" |
| SVG animation jank at 20+ sessions | CSS-only, GPU-accelerated; `will-change: transform` if needed |
| Server restart loses all in-memory state | Self-corrects in one 30s cycle — activity + hash maps repopulate naturally |
| Dying animation timing mismatch | CSS animation is 30s, server grace period is 30s. If sync interval drifts, session may be reaped slightly before CSS completes. Acceptable — the fade is nearly invisible at that point. |
| Replicate API latency / cost | Sprites are async/background. Only 125 unique combinations. Pre-generate once, cache forever. SVG fallback ensures immediate rendering. |
| Synchronous `execSync` blocks event loop | Existing pattern; 30s interval; warn if >1s; async capture is a v2 optimization |
| Shell injection in `capturePaneLines` | tmux session names are generated by Workshop (`workshop-{uuid}`), not user input. Array-form `execFileSync` is a future hardening step. |

---

## Resolved Findings Summary

| Finding | Resolution |
|---|---|
| B1: lastActivityAt persisted to SQLite, human said "in memory" | Removed all DB changes. In-memory `Map` in terminal manager, API enriches responses. |
| B2: Dying animation out of scope, human wanted fade-out + speech bubble | Added `dying` ActivityState, 30s grace period in sync loop, CSS fade animation, SpeechBubble component. |
| B3: Replicate sprites out of scope, human specified gpt-image-1.5 | Added sprite-generator.ts, caching in ~/.workshop/sprites/, consistent style prompt, SVG fallback. |
| B4: isSessionIdleFromOutput drops Running/Thinking safety guard | Preserved original `isSessionIdle()` logic intact. Only added optional `preCapture` parameter. |
| B5: Duplicate tmux capture despite "combine those" answer | Single `capturePaneLines()` call per session in sync loop. All detection functions accept `preCapture`. |
| S1: destroySession doesn't clean lastPaneHash | Added cleanup for all three maps in destroySession(). |
| S2: Tracks refetched on every WS event | Tracks fetched once on mount; only sessions on WS events. |
| S3: CSS transforms inconsistent in Firefox | Added `transform-box: fill-box` on SVG transform targets. |
| S4: buildTooltip/providerColor undefined | Defined `providerColor()` in activity.ts. Tooltip is inline JSX in OfficeDeskUnit. |
| S5: No tests for syncSessionStates changes | Added pane-detection.test.ts for shared-capture behavior. |
| S6: No warning if sync takes >1s | Added timing + console.warn in syncSessionStates(). |
| S7: Shell injection in capturePaneOutput | Noted as future hardening; tmux names are Workshop-generated UUIDs. |

---

## Out of Scope (v1)

- Sound effects, drag-to-rearrange, custom character selection
- Real-time streaming detection (needs per-session WebSocket)
- Async tmux capture (v2 optimization — move to child_process.exec or worker)
- Array-form `execFileSync` hardening (v2 — no user-controlled input today)

---

**Plan file**: `/Users/fabian.haupt/projects/workshop/plans/office-visualization-plan.md`
