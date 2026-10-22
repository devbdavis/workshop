// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { DesignPreview, type Pick } from '../../src/ui/workspace/DesignPreview';

// Mirrors the raw react-dom render pattern used in todo-detail-modal-issue.test.tsx
// (no @testing-library in this repo). Exercises the postMessage origin/source guard,
// which is the one piece of non-obvious logic in the picker wiring.

const pick: Pick = {
  selector: '.foo',
  url: 'http://localhost:5173/',
  tag: 'button',
  text: 'Click me',
  outerHTML: '<button class="foo">Click me</button>',
  parentHTML: '<div><button class="foo">Click me</button></div>',
  styles: {},
  rect: { x: 0, y: 0, width: 10, height: 10 },
  source: null,
  viewport: { width: 1024, height: 768 },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  global.fetch = vi.fn(async (url: any) => {
    if (String(url).includes('/api/preview/status')) {
      return { ok: true, json: async () => ({ port: 9999, screenshots: false }) } as any;
    }
    return { ok: true, json: async () => ({}) } as any;
  }) as any;
});

afterEach(() => {
  root.unmount();
  container.remove();
  vi.restoreAllMocks();
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('DesignPreview postMessage handling', () => {
  it('ignores a pick from the wrong origin and accepts one from the preview origin', async () => {
    root.render(<DesignPreview sessionId="s1" onClose={() => {}} />);
    for (let i = 0; i < 5; i++) await tick();

    const iframe = container.querySelector('iframe');
    expect(iframe, 'iframe should render once status resolves').toBeTruthy();
    const source = iframe!.contentWindow as Window;

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'workshop:pick', pick }, origin: 'http://evil.example', source }));
    await tick();
    expect(container.textContent).toContain('Turn on Pick');

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'workshop:pick', pick }, origin: 'http://localhost:9999', source }));
    await tick();
    expect(container.textContent).toContain('.foo');
    expect(container.textContent).not.toContain('Turn on Pick');
  });
});
