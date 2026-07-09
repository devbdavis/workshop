/**
 * Per-user container→editor path remapping.
 *
 * Workshop's container roots come from different host locations: `/repos` is a
 * bind mount, `/config` is a named volume. One prefix pair can't cover both, so
 * a user supplies a list of `<from> -> <to>` rules. Longest matching prefix
 * wins, which lets a catch-all `/ -> /mnt/host` coexist with a more specific
 * `/repos -> /mnt/user/repos`.
 */

export interface PathRemap {
  from: string;
  to: string;
}

/** Per-user editor-launch setting keys (stored in user_settings). */
export const EDITOR_URI_PREFIX_KEY = 'editor_uri_prefix';
export const EDITOR_PATH_REMAPS_KEY = 'editor_path_remaps';
/** Superseded by EDITOR_PATH_REMAPS_KEY; still read so existing profiles keep working. */
export const EDITOR_PATH_FROM_KEY = 'editor_path_from';
export const EDITOR_PATH_TO_KEY = 'editor_path_to';

/** Drop a trailing slash, except on the root prefix where it is the whole path. */
function trimSlash(p: string): string {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

/** Parse `<from> -> <to>` lines, longest `from` first. Invalid lines are dropped. */
export function parsePathRemaps(text: string): PathRemap[] {
  return text
    .split('\n')
    .map((line) => line.split('->'))
    .filter((parts) => parts.length === 2)
    .map(([from, to]) => ({ from: trimSlash(from.trim()), to: trimSlash(to.trim()) }))
    .filter((r) => r.from.startsWith('/') && r.to.length > 0)
    .sort((a, b) => b.from.length - a.from.length);
}

/** True when `from` is a path-segment prefix of `target` (so /repos misses /repositories). */
function isPrefix(from: string, target: string): boolean {
  if (from === '/') return target.startsWith('/');
  return target === from || target.startsWith(`${from}/`);
}

/** Rewrite `target` using the first (longest) matching rule, or return it unchanged. */
export function applyPathRemaps(target: string, remaps: PathRemap[]): string {
  const hit = remaps.find((r) => isPrefix(r.from, target));
  if (!hit) return target;
  // The root prefixes contribute no text of their own: `/` consumes nothing from
  // `target`, and a `to` of `/` prepends nothing — otherwise `/ -> /` would
  // double the leading slash.
  const head = hit.to === '/' ? '' : hit.to;
  return head + target.slice(hit.from === '/' ? 0 : hit.from.length);
}

/**
 * The remap rules as editable text, falling back to the legacy single from/to
 * pair so profiles saved before multi-remap keep launching correctly.
 */
export function remapTextFromSettings(settings: Record<string, string>): string {
  const text = settings[EDITOR_PATH_REMAPS_KEY];
  if (text) return text;
  const from = settings[EDITOR_PATH_FROM_KEY];
  const to = settings[EDITOR_PATH_TO_KEY];
  return from && to ? `${from} -> ${to}` : '';
}
