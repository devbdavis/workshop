/** User preferences for session attention notifications, persisted locally. */
export interface NotifyPrefs {
  system: boolean;
  sound: boolean;
  chip: boolean;
  /** Also alert when a session goes idle after working, not just needs-input. */
  idle: boolean;
  /** Ping volume, 0-1. */
  volume: number;
}

const STORAGE_KEY = 'workshop:notify-prefs';

const DEFAULT_PREFS: NotifyPrefs = {
  system: true,
  sound: true,
  chip: true,
  idle: true,
  volume: 0.5,
};

export function loadPrefs(): NotifyPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<NotifyPrefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: NotifyPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore — e.g. storage quota or disabled localStorage
  }
}

let audioCtx: AudioContext | undefined;

/** Browsers keep an AudioContext suspended unless created/resumed during a user gesture — call from one. */
export function unlockAudio(): void {
  try {
    audioCtx ??= new AudioContext();
    audioCtx.resume().catch(() => { /* ignore */ });
  } catch {
    // ignore — WebAudio unavailable
  }
}

/** Short sine blip with a gain envelope — no sound asset needed. */
export function playPing(volume: number): void {
  try {
    audioCtx ??= new AudioContext();
    audioCtx.resume().catch(() => { /* ignore */ });
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.type = 'sine';
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.02);
    gain.gain.linearRampToValueAtTime(0, now + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  } catch {
    // ignore — WebAudio unavailable or blocked
  }
}
