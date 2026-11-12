// Bare-URL linking for transcripts. shortcut: http(s) only, no GFM (tables etc.); swap for remark-gfm once it's installable here.
const URL_RE = /https?:\/\/[^\s<>"'`]+/g;

export type Piece = { text: string; url?: string };

/** Splits text into plain and URL pieces; trailing sentence punctuation and unmatched ")" stay outside the link. */
export function splitUrls(text: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    while (/[.,;:!?\]]$/.test(url) || (url.endsWith(')') && count(url, '(') < count(url, ')'))) url = url.slice(0, -1);
    const start = m.index;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: url, url });
    last = start + url.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

interface MdNode { type: string; value?: string; url?: string; children?: MdNode[] }

/** remark plugin: bare URLs in text nodes become links (code/inlineCode nodes are untouched). */
export function remarkBareUrls() {
  const walk = (node: MdNode): void => {
    if (!node.children || node.type === 'link') return;
    node.children = node.children.flatMap((child) => {
      if (child.type !== 'text' || !child.value) { walk(child); return [child]; }
      return splitUrls(child.value).map((p): MdNode =>
        p.url ? { type: 'link', url: p.url, children: [{ type: 'text', value: p.text }] } : { type: 'text', value: p.text });
    });
  };
  return walk;
}
