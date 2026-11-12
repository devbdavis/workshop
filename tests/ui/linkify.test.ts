import { describe, it, expect } from 'vitest';
import { splitUrls, remarkBareUrls } from '../../src/ui/session-history/linkify';

describe('splitUrls', () => {
  it('links URLs and keeps trailing punctuation outside', () => {
    expect(splitUrls('PR: https://github.com/a/b/pull/43. Done')).toEqual([
      { text: 'PR: ' },
      { text: 'https://github.com/a/b/pull/43', url: 'https://github.com/a/b/pull/43' },
      { text: '. Done' },
    ]);
  });

  it('keeps balanced parens but drops an unmatched closing one', () => {
    expect(splitUrls('(see https://x.dev/a)')[1].url).toBe('https://x.dev/a');
    expect(splitUrls('https://en.wikipedia.org/wiki/Foo_(bar)')[0].url).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
  });

  it('leaves text without URLs and non-http schemes alone', () => {
    expect(splitUrls('no links; javascript:alert(1)')).toEqual([{ text: 'no links; javascript:alert(1)' }]);
  });
});

describe('remarkBareUrls', () => {
  it('turns text URLs into link nodes but not inside code or existing links', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'go https://a.dev now' }, { type: 'inlineCode', value: 'https://b.dev' }] },
        { type: 'link', url: 'https://c.dev', children: [{ type: 'text', value: 'https://c.dev' }] },
      ],
    };
    remarkBareUrls()(tree);
    const para = tree.children[0].children as { type: string; url?: string }[];
    expect(para.map((n) => n.type)).toEqual(['text', 'link', 'text', 'inlineCode']);
    expect(para[1].url).toBe('https://a.dev');
    expect(tree.children[1].children).toHaveLength(1);
  });
});
