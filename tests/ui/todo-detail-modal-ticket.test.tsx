// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TodoDetailModal } from '../../src/ui/kanban/TodoDetailModal';
import { LinearTicketModal } from '../../src/ui/kanban/LinearTicketModal';

// Reproduces the click -> "Create Linear Ticket" flow with the SAME parent
// wiring the real views use, to prove the standalone loading modal survives the
// todo modal closing (it must not be a child of the todo modal).

const todo = {
  id: 't1',
  trackId: 'tr1',
  title: 'Add dedup',
  description: 'do the thing',
  status: 'backlog',
  priority: 'medium',
  refined: true,
  sortOrder: 0,
  createdAt: '',
  updatedAt: '',
} as any;

// Mirrors how KanbanBoard/TrackView/TodoPanel own both modals as siblings.
function Parent() {
  const [selected, setSelected] = useState<any>(todo);
  const [ticketTodoId, setTicketTodoId] = useState<string | null>(null);
  return (
    <>
      {selected && (
        <TodoDetailModal
          todo={selected}
          tracks={[{ id: 'tr1', name: 'Track' } as any]}
          onClose={() => setSelected(null)}
          onSave={() => setSelected(null)}
          onDelete={() => setSelected(null)}
          onDispatch={() => setSelected(null)}
          onTicketCreationStarted={setTicketTodoId}
        />
      )}
      {ticketTodoId && <LinearTicketModal todoId={ticketTodoId} onClose={() => setTicketTodoId(null)} />}
    </>
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  global.fetch = vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes('/api/agents')) return { ok: true, json: async () => [] } as any;
    if (u.includes('/linear-ticket-status')) return { ok: true, json: async () => ({ status: 'pending' }) } as any;
    return { ok: true, json: async () => ({}) } as any;
  }) as any;
});

afterEach(() => {
  root.unmount();
  container.remove();
  vi.restoreAllMocks();
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('Create Linear Ticket flow', () => {
  it('closes the todo modal and shows the standalone loading modal in its place', async () => {
    root.render(<Parent />);
    for (let i = 0; i < 5; i++) await tick();

    expect(container.textContent).toContain('Edit Todo'); // todo modal open

    const btn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Create Linear Ticket',
    );
    expect(btn, 'Create Linear Ticket button should render').toBeTruthy();

    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 10; i++) await tick();

    // The todo modal is gone, but the loading modal (a sibling, not a child) lives on.
    expect(container.textContent, 'todo modal should close').not.toContain('Edit Todo');
    expect(container.textContent, 'loading modal should appear').toContain('Creating Linear ticket');
  });
});
