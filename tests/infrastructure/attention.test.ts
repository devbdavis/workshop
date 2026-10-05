import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted above the manager import — replaces real tmux/pane inspection with
// controllable fakes so activity-status transitions can be driven directly.
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execSync: vi.fn(() => ''),
  execFileSync: vi.fn(() => ''),
  exec: vi.fn(),
}));
vi.mock('@infrastructure/terminal/pane-detection.js', () => ({
  capturePaneLines: vi.fn(() => []),
  isSessionIdle: vi.fn(() => false),
  isSessionNeedsInput: vi.fn(() => false),
  isSessionLoggedOut: vi.fn(() => false),
  isSessionExited: vi.fn(() => false),
  isPaneBusy: vi.fn(() => false),
  hasBackgroundWork: vi.fn(() => false),
}));

import { createTerminalManager } from '@infrastructure/terminal/manager.js';
import { isSessionIdle, isSessionNeedsInput, isPaneBusy, hasBackgroundWork } from '@infrastructure/terminal/pane-detection.js';
import type { SessionRepository } from '@domain/session/repository';
import type { Session, SessionId, TrackId } from '@foundation/types';

const mockIsSessionIdle = vi.mocked(isSessionIdle);
const mockIsSessionNeedsInput = vi.mocked(isSessionNeedsInput);
const mockIsPaneBusy = vi.mocked(isPaneBusy);

const SESSION_ID = 'sess-1' as SessionId;
const TRACK_ID = 'track-1' as TrackId;

function makeSession(): Session {
  return {
    id: SESSION_ID,
    trackId: TRACK_ID,
    tmuxSession: 'ws-test',
    state: 'active',
    provider: 'claude',
    background: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Minimal fake — only findAll/findById are exercised by the paths under test. */
function makeSessionRepo(session: Session): SessionRepository {
  return {
    findById: () => session,
    findByTrack: () => [session],
    findDeletedByTrack: () => [],
    findAllDeleted: () => [],
    findByTmuxSession: () => session,
    findAll: () => [session],
    create: () => session,
    updateState: () => session,
    updateName: () => session,
    updateClaudeResumeId: () => session,
    updateTmuxSession: () => session,
    updateWorktreeRoot: () => session,
    updateWorkingDirectory: () => session,
    softDelete: () => session,
    restore: () => session,
    delete: () => true,
  };
}

describe('terminal manager attention tracking', () => {
  beforeEach(() => {
    mockIsSessionIdle.mockReset().mockReturnValue(false);
    mockIsSessionNeedsInput.mockReset().mockReturnValue(false);
  });

  it('sets attentionSince when status transitions to needs-input', () => {
    const terminal = createTerminalManager(makeSessionRepo(makeSession()));
    mockIsSessionNeedsInput.mockReturnValue(true);

    terminal.syncSessionStates();

    expect(terminal.getActivityStatus(SESSION_ID)).toBe('needs-input');
    expect(terminal.getAttentionSince(SESSION_ID)).toBeDefined();
  });

  it('sets attentionSince on the confirmed working→idle transition (after debounce)', () => {
    const terminal = createTerminalManager(makeSessionRepo(makeSession()));

    // First cycle: working (establishes a non-idle prior status).
    terminal.syncSessionStates();
    expect(terminal.getActivityStatus(SESSION_ID)).toBe('working');
    expect(terminal.getAttentionSince(SESSION_ID)).toBeUndefined();

    // Idle-looking pane for the next two cycles — IDLE_CONSECUTIVE_THRESHOLD is 2.
    mockIsSessionIdle.mockReturnValue(true);
    terminal.syncSessionStates();
    expect(terminal.getActivityStatus(SESSION_ID)).toBe('working'); // not yet confirmed
    expect(terminal.getAttentionSince(SESSION_ID)).toBeUndefined();

    terminal.syncSessionStates();
    expect(terminal.getActivityStatus(SESSION_ID)).toBe('idle'); // confirmed
    expect(terminal.getAttentionSince(SESSION_ID)).toBeDefined();
  });

  it('does not set attentionSince for a session already idle on first observation (e.g. server restart)', () => {
    const terminal = createTerminalManager(makeSessionRepo(makeSession()));
    mockIsSessionIdle.mockReturnValue(true);

    // Two consecutive idle observations with no prior 'working' status recorded.
    terminal.syncSessionStates();
    terminal.syncSessionStates();

    expect(terminal.getActivityStatus(SESSION_ID)).toBe('idle');
    expect(terminal.getAttentionSince(SESSION_ID)).toBeUndefined();
  });

  it('clears attentionSince when status transitions back to working', () => {
    const terminal = createTerminalManager(makeSessionRepo(makeSession()));

    terminal.syncSessionStates(); // working
    mockIsSessionIdle.mockReturnValue(true);
    terminal.syncSessionStates(); // idle count 1
    terminal.syncSessionStates(); // idle confirmed — attention set
    expect(terminal.getAttentionSince(SESSION_ID)).toBeDefined();

    mockIsSessionIdle.mockReturnValue(false);
    terminal.syncSessionStates(); // back to working

    expect(terminal.getActivityStatus(SESSION_ID)).toBe('working');
    expect(terminal.getAttentionSince(SESSION_ID)).toBeUndefined();
  });

  it('clearAttention() removes the entry and reports whether it cleared anything', () => {
    const terminal = createTerminalManager(makeSessionRepo(makeSession()));
    mockIsSessionNeedsInput.mockReturnValue(true);
    terminal.syncSessionStates();
    expect(terminal.getAttentionSince(SESSION_ID)).toBeDefined();

    expect(terminal.clearAttention(SESSION_ID)).toBe(true);
    expect(terminal.getAttentionSince(SESSION_ID)).toBeUndefined();
    expect(terminal.clearAttention(SESSION_ID)).toBe(false);
  });

  it('does not raise attention while a viewer is attached, and resumes after detach', () => {
    const terminal = createTerminalManager(makeSessionRepo(makeSession()));

    terminal.viewerAttached(SESSION_ID);
    terminal.syncSessionStates(); // working
    mockIsSessionIdle.mockReturnValue(true);
    terminal.syncSessionStates();
    terminal.syncSessionStates(); // idle confirmed — but someone is watching
    expect(terminal.getActivityStatus(SESSION_ID)).toBe('idle');
    expect(terminal.getAttentionSince(SESSION_ID)).toBeUndefined();

    // Detach, go back to working, then finish again — now it should flag.
    terminal.viewerDetached(SESSION_ID);
    mockIsSessionIdle.mockReturnValue(false);
    terminal.syncSessionStates(); // working
    mockIsSessionIdle.mockReturnValue(true);
    terminal.syncSessionStates();
    terminal.syncSessionStates(); // idle confirmed, no viewer
    expect(terminal.getAttentionSince(SESSION_ID)).toBeDefined();
  });

  it('viewer refcount: attention stays suppressed until the last viewer detaches', () => {
    const terminal = createTerminalManager(makeSessionRepo(makeSession()));

    terminal.viewerAttached(SESSION_ID);
    terminal.viewerAttached(SESSION_ID);
    terminal.viewerDetached(SESSION_ID); // one of two viewers left

    terminal.syncSessionStates(); // working
    mockIsSessionNeedsInput.mockReturnValue(true);
    terminal.syncSessionStates(); // needs-input while still viewed
    expect(terminal.getAttentionSince(SESSION_ID)).toBeUndefined();
  });

  it('removes the attention entry when a session is destroyed', async () => {
    const session = makeSession();
    const terminal = createTerminalManager(makeSessionRepo(session));
    mockIsSessionNeedsInput.mockReturnValue(true);
    terminal.syncSessionStates();
    expect(terminal.getAttentionSince(SESSION_ID)).toBeDefined();

    await terminal.destroySession(SESSION_ID);

    expect(terminal.getAttentionSince(SESSION_ID)).toBeUndefined();
  });
});

describe('hook-reported activity', () => {
  beforeEach(() => {
    mockIsSessionIdle.mockReset().mockReturnValue(false);
    mockIsSessionNeedsInput.mockReset().mockReturnValue(false);
    mockIsPaneBusy.mockReset().mockReturnValue(false);
    vi.mocked(hasBackgroundWork).mockReset().mockReturnValue(false);
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  function setup() {
    const terminal = createTerminalManager(makeSessionRepo(makeSession()));
    terminal.syncSessionStates(); // pane-observed working
    return terminal;
  }

  it('idle hook applies immediately, sets attention, and dedupes', () => {
    const terminal = setup();
    expect(terminal.reportHookActivity(SESSION_ID, 'idle')).toMatchObject({ trackId: TRACK_ID, changed: true });
    expect(terminal.getActivityStatus(SESSION_ID)).toBe('idle');
    expect(terminal.getAttentionSince(SESSION_ID)).toBeDefined();
    expect(terminal.reportHookActivity(SESSION_ID, 'idle')?.changed).toBe(false);
  });

  it('keeps hook status when the pane is unrecognized after the grace window', () => {
    const terminal = setup();
    terminal.reportHookActivity(SESSION_ID, 'idle');
    vi.advanceTimersByTime(6_000);
    terminal.syncSessionStates();
    expect(terminal.getActivityStatus(SESSION_ID)).toBe('idle');
  });

  it('pane busy signal overrides hook idle after the grace window', () => {
    const terminal = setup();
    terminal.reportHookActivity(SESSION_ID, 'idle');
    vi.advanceTimersByTime(6_000);
    mockIsPaneBusy.mockReturnValue(true);
    terminal.syncSessionStates();
    expect(terminal.getActivityStatus(SESSION_ID)).toBe('working');
  });

  it('does not let a contradicting pane signal override within the grace window', () => {
    const terminal = setup();
    terminal.reportHookActivity(SESSION_ID, 'idle');
    mockIsPaneBusy.mockReturnValue(true);
    terminal.syncSessionStates();
    expect(terminal.getActivityStatus(SESSION_ID)).toBe('idle');
  });

  it('does not re-alert idle from the pane fallback after a hook idle', () => {
    const terminal = setup();
    terminal.reportHookActivity(SESSION_ID, 'idle');
    mockIsSessionIdle.mockReturnValue(true);
    const alerts = [];
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(7_500);
      alerts.push(...terminal.syncSessionStates().idleAlerts);
    }
    expect(alerts).toHaveLength(0);
  });

  it('ignores a Stop hook while delegated agents are still running', () => {
    const terminal = setup();
    vi.mocked(hasBackgroundWork).mockReturnValue(true);
    expect(terminal.reportHookActivity(SESSION_ID, 'idle')).toBeUndefined();
    expect(terminal.getActivityStatus(SESSION_ID)).toBe('working');
  });
});
