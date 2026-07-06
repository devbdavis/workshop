/**
 * Minimal unified-diff parsing for PR review inline-comment anchoring.
 * GitHub's review API only accepts inline comments on lines that appear in the
 * diff (added or context lines for side=RIGHT); anything else 422s the whole
 * review. We parse `gh pr diff` output once to (a) validate finding lines and
 * (b) extract the surrounding hunk as display context for the dashboard.
 */

export interface DiffHunk {
  /** First line number of the hunk in the new (RIGHT) version of the file. */
  newStart: number;
  /** Last line number of the hunk in the new version. */
  newEnd: number;
  /** The `@@ ... @@` header line. */
  header: string;
  /** Raw diff lines including the +/-/space prefix. */
  lines: string[];
}

export interface DiffFile {
  /** New-version repo-relative path. */
  path: string;
  /** New-version line numbers present in the diff (added + context) — anchorable for side=RIGHT. */
  rightLines: Set<number>;
  hunks: DiffHunk[];
}

export type ParsedDiff = Map<string, DiffFile>;

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(diff: string): ParsedDiff {
  const files: ParsedDiff = new Map();
  let current: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let newLine = 0;
  /** Last new-side line number this hunk may produce — stops stray blank lines after a hunk from counting. */
  let hunkLimit = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const rawPath = line.slice(4).trim();
      if (rawPath === '/dev/null') {
        current = null; // deleted file — nothing anchorable on the RIGHT side
      } else {
        const path = rawPath.startsWith('b/') ? rawPath.slice(2) : rawPath;
        current = { path, rightLines: new Set(), hunks: [] };
        files.set(path, current);
      }
      hunk = null;
      continue;
    }

    const hunkMatch = HUNK_RE.exec(line);
    if (hunkMatch && current) {
      newLine = Number.parseInt(hunkMatch[1], 10);
      const newCount = hunkMatch[2] !== undefined ? Number.parseInt(hunkMatch[2], 10) : 1;
      hunkLimit = newLine + newCount - 1;
      hunk = { newStart: newLine, newEnd: newLine - 1, header: line, lines: [] };
      current.hunks.push(hunk);
      continue;
    }

    if (!current || !hunk) continue;
    if (line.startsWith('diff --git')) {
      current = null;
      hunk = null;
      continue;
    }

    // An entirely empty line inside a hunk is a blank context line whose
    // leading space was stripped somewhere in transit — treat it as context,
    // but only while the hunk still expects new-side lines (hunkLimit).
    if ((line.startsWith('+') || line.startsWith(' ') || line === '') && newLine <= hunkLimit) {
      current.rightLines.add(newLine);
      hunk.newEnd = newLine;
      newLine++;
      hunk.lines.push(line);
    } else if (line.startsWith('-')) {
      hunk.lines.push(line);
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" — keep for display fidelity
      hunk.lines.push(line);
    }
  }

  return files;
}

/** True when a RIGHT-side inline comment can be attached at file:line. */
export function isAnchorable(parsed: ParsedDiff, file: string, line: number | undefined): boolean {
  if (line === undefined) return false;
  return parsed.get(file)?.rightLines.has(line) ?? false;
}

/** Max raw diff lines returned as display context per finding. */
const CONTEXT_MAX_LINES = 24;

/**
 * The hunk containing `line` (new-version numbering), clamped to a window
 * around the target so a giant hunk doesn't swamp the finding card.
 */
export function extractHunkForLine(parsed: ParsedDiff, file: string, line: number | undefined): string | undefined {
  if (line === undefined) return undefined;
  const hunk = parsed.get(file)?.hunks.find((h) => line >= h.newStart && line <= h.newEnd);
  if (!hunk) return undefined;

  if (hunk.lines.length <= CONTEXT_MAX_LINES) {
    return [hunk.header, ...hunk.lines].join('\n');
  }

  // Locate the target within the hunk by walking the new-side counter.
  let newLine = hunk.newStart;
  let targetIndex = hunk.lines.length - 1;
  for (let i = 0; i < hunk.lines.length; i++) {
    const l = hunk.lines[i];
    if (l.startsWith('+') || l.startsWith(' ')) {
      if (newLine === line) {
        targetIndex = i;
        break;
      }
      newLine++;
    }
  }
  const half = Math.floor(CONTEXT_MAX_LINES / 2);
  const start = Math.max(0, targetIndex - half);
  const window = hunk.lines.slice(start, start + CONTEXT_MAX_LINES);
  return [hunk.header, ...(start > 0 ? ['…'] : []), ...window].join('\n');
}
