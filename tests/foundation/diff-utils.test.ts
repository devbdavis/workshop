import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff, isAnchorable, extractHunkForLine, relocateLine, rightLineNumbers } from '@foundation/diff-utils';

const MULTI_HUNK_DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,5 @@
 import a from 'a';
+import b from 'b';
 import c from 'c';

 const x = 1;
@@ -20,3 +21,4 @@ function later() {
   return x;
-  // dead
+  // alive
+  // extra
 }
diff --git a/docs/old.md b/docs/old.md
deleted file mode 100644
index 3333333..0000000
--- a/docs/old.md
+++ /dev/null
@@ -1,2 +0,0 @@
-# Old
-gone
diff --git a/src/renamed-old.ts b/src/renamed-new.ts
similarity index 90%
rename from src/renamed-old.ts
rename to src/renamed-new.ts
index 4444444..5555555 100644
--- a/src/renamed-old.ts
+++ b/src/renamed-new.ts
@@ -5,2 +5,3 @@
 keep();
+added();
 also();
`;

describe('parseUnifiedDiff', () => {
  const parsed = parseUnifiedDiff(MULTI_HUNK_DIFF);

  it('tracks right-side lines across multiple hunks', () => {
    // Hunk 1: new lines 1-5 (context + added)
    expect(isAnchorable(parsed, 'src/app.ts', 2)).toBe(true); // the added import
    expect(isAnchorable(parsed, 'src/app.ts', 5)).toBe(true); // trailing context
    // Between hunks — not in diff
    expect(isAnchorable(parsed, 'src/app.ts', 10)).toBe(false);
    // Hunk 2: new lines 21-24
    expect(isAnchorable(parsed, 'src/app.ts', 22)).toBe(true); // "// alive"
    expect(isAnchorable(parsed, 'src/app.ts', 23)).toBe(true); // "// extra"
  });

  it('uses the new path for renamed files', () => {
    expect(parsed.has('src/renamed-new.ts')).toBe(true);
    expect(parsed.has('src/renamed-old.ts')).toBe(false);
    expect(isAnchorable(parsed, 'src/renamed-new.ts', 6)).toBe(true); // added()
  });

  it('ignores deleted files (nothing on the RIGHT side)', () => {
    expect(parsed.has('docs/old.md')).toBe(false);
  });

  it('is not anchorable for unknown files or missing lines', () => {
    expect(isAnchorable(parsed, 'nope.ts', 1)).toBe(false);
    expect(isAnchorable(parsed, 'src/app.ts', undefined)).toBe(false);
  });
});

describe('extractHunkForLine', () => {
  const parsed = parseUnifiedDiff(MULTI_HUNK_DIFF);

  it('returns the containing hunk with header', () => {
    const ctx = extractHunkForLine(parsed, 'src/app.ts', 2);
    expect(ctx).toContain('@@ -1,4 +1,5 @@');
    expect(ctx).toContain("+import b from 'b';");
    expect(ctx).not.toContain('// alive'); // other hunk excluded
  });

  it('returns undefined outside any hunk', () => {
    expect(extractHunkForLine(parsed, 'src/app.ts', 10)).toBeUndefined();
    expect(extractHunkForLine(parsed, 'src/app.ts', undefined)).toBeUndefined();
  });

  it('clamps giant hunks to a window around the target line', () => {
    const bigLines = Array.from({ length: 100 }, (_, i) => ` line${i + 1}`);
    const bigDiff = ['--- a/big.ts', '+++ b/big.ts', '@@ -1,100 +1,100 @@', ...bigLines].join('\n');
    const bigParsed = parseUnifiedDiff(bigDiff);
    const ctx = extractHunkForLine(bigParsed, 'big.ts', 50)!;
    const lines = ctx.split('\n');
    expect(lines.length).toBeLessThanOrEqual(27); // header + ellipsis + window
    expect(ctx).toContain('line50');
    expect(ctx).toContain('…');
  });
});

describe('relocateLine', () => {
  const file = parseUnifiedDiff(MULTI_HUNK_DIFF).get('src/app.ts');

  it('keeps the line when its text is unchanged', () => {
    expect(relocateLine(file, 2, "import b from 'b';")).toBe(2);
  });

  it('follows the text to its nearest new position', () => {
    expect(relocateLine(file, 10, '  // alive')).toBe(22);
  });

  it('returns undefined once the text is gone', () => {
    expect(relocateLine(file, 22, '  // dead')).toBeUndefined();
    expect(relocateLine(undefined, 1, 'x')).toBeUndefined();
  });
});

describe('rightLineNumbers', () => {
  it('numbers added and context lines, nulls headers and deletions', () => {
    const lines = MULTI_HUNK_DIFF.split('\n');
    const nums = rightLineNumbers(MULTI_HUNK_DIFF);
    expect(nums).toHaveLength(lines.length);
    expect(nums[lines.indexOf("+import b from 'b';")]).toBe(2);
    expect(nums[lines.indexOf('-  // dead')]).toBeNull();
    expect(nums[lines.indexOf('+  // extra')]).toBe(23);
    expect(nums[lines.indexOf('+added();')]).toBe(6);
    expect(nums[lines.indexOf('+++ b/src/app.ts')]).toBeNull();
  });
});
