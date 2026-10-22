import { describe, it, expect } from 'vitest';
import { buildTree, splitDiff } from '../../src/ui/workspace/PrDiffModal';

const diff = [
  'diff --git a/README.md b/README.md',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1 +1 @@',
  '-old',
  '+new',
  'diff --git a/src/ui/a.ts b/src/ui/a.ts',
  '+++ b/src/ui/a.ts',
  '+x',
  'diff --git a/src/b.ts b/src/b.ts',
  '-y',
  '',
].join('\n');

describe('PR diff tree', () => {
  it('splits per file with counts and nests files under their directories', () => {
    const files = splitDiff(diff);
    expect(files.map((f) => [f.path, f.added, f.removed])).toEqual([
      ['README.md', 1, 1],
      ['src/ui/a.ts', 1, 0],
      ['src/b.ts', 0, 1],
    ]);
    const root = buildTree(files);
    expect(root.files.map((f) => f.path)).toEqual(['README.md']);
    const src = root.dirs.get('src')!;
    expect(src.files.map((f) => f.path)).toEqual(['src/b.ts']);
    expect(src.dirs.get('ui')!.files.map((f) => f.path)).toEqual(['src/ui/a.ts']);
  });
});
