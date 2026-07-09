/**
 * Strip HTML comments and tags from a markdown-ish string.
 *
 * Bot reviewers (Cursor Bugbot, etc.) embed `<!-- … -->` markers and
 * `<a>/<picture>/<img>` markup. react-markdown *escapes* raw HTML rather than
 * removing it, so those render as visible `&lt;!-- … --&gt;` noise. We strip
 * them instead.
 *
 * Used in two places for two reasons:
 * - server-side (gh-adapter) BEFORE clamping, so the length budget is spent on
 *   real text rather than a multi-KB base64 "fix-in-cursor" link blob;
 * - client-side at render time, so comments already stored raw (before the
 *   server strip landed) also display clean without waiting for a re-poll.
 *
 * The tag regex requires a letter or `/` immediately after `<`, so markdown
 * autolinks like `<https://example.com>` survive.
 */
export function stripHtmlNoise(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>]*)?>/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
