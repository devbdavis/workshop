// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { PermissionPrompt } from '../../src/ui/permissions/PermissionPrompt';

const req = {
  id: 'r1',
  sessionId: 's1',
  trackId: 't1',
  taskName: 'Fix the build',
  harness: 'claude',
  toolName: 'Bash',
  normalizedTool: 'shell',
  summary: 'npm run build --silent',
  toolInput: {},
  reason: 'Auto mode: unsafe',
  suggestedPattern: 'npm run build',
  status: 'pending',
  createdAt: '2026-01-01T00:00:00Z',
};

let container: HTMLDivElement;
let root: Root;
let sockets: any[];
let decideBodies: any[];
const tick = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const act = async (fn: () => void | Promise<void>) => {
  await fn();
  await tick();
};

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  sockets = [];
  decideBodies = [];
  (globalThis as any).WebSocket = class {
    onmessage: any;
    onclose: any;
    constructor() {
      sockets.push(this);
    }
    close() {}
  };
  global.fetch = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    if (u.includes('/decide')) {
      decideBodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({}) } as any;
    }
    if (u.includes('status=pending')) return { ok: true, json: async () => [req] } as any;
    return { ok: true, json: async () => [] } as any;
  }) as any;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <PermissionPrompt />
      </MemoryRouter>,
    );
  });
  await tick();
});

afterEach(() => {
  root.unmount();
  container.remove();
  vi.restoreAllMocks();
});

const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;

describe('PermissionPrompt', () => {
  it('renders the pending request', () => {
    expect(container.textContent).toContain('Fix the build wants permission');
    expect(container.textContent).toContain('npm run build --silent');
    expect(container.textContent).toContain('No previous requests for this tool');
  });

  it('posts the edited pattern on Always approve', async () => {
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('npm run build');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'npm run',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      button('Always approve').click();
    });
    await tick();
    expect(decideBodies).toEqual([{ decision: 'allow', always: true, pattern: 'npm run' }]);
    expect(container.textContent).not.toContain('wants permission');
  });

  it('removes the modal on permission:decided', async () => {
    await act(async () => {
      sockets[0].onmessage({
        data: JSON.stringify({
          type: 'permission:decided',
          request: { ...req, status: 'approved' },
        }),
      });
    });
    expect(container.textContent).not.toContain('wants permission');
  });
});
