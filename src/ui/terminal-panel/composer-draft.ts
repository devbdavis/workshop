// Per-session composer drafts in localStorage: saved on every keystroke, dropped after a week untouched.
const PREFIX = 'workshop:composer-draft:';
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface Draft { text: string; at: number }

function parse(raw: string | null): Draft | null {
  try {
    const d = raw ? (JSON.parse(raw) as Draft) : null;
    return d && typeof d.text === 'string' && typeof d.at === 'number' ? d : null;
  } catch {
    return null;
  }
}

/** Returns the session's draft, removing it (and any other expired drafts) when stale. */
export function loadDraft(sessionId: string, storage: Storage = localStorage, now = Date.now()): string {
  try {
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const d = parse(storage.getItem(key));
      if (!d || now - d.at > DRAFT_TTL_MS) storage.removeItem(key);
    }
    return parse(storage.getItem(PREFIX + sessionId))?.text ?? '';
  } catch {
    return ''; // storage blocked (private mode etc.): drafts just don't persist
  }
}

export function saveDraft(sessionId: string, text: string, storage: Storage = localStorage, now = Date.now()): void {
  try {
    if (text) storage.setItem(PREFIX + sessionId, JSON.stringify({ text, at: now }));
    else storage.removeItem(PREFIX + sessionId);
  } catch {
    // Quota or blocked storage: losing a draft beats breaking the composer.
  }
}
