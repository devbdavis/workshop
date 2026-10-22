import { useEffect, useState } from 'react';
import type { Agent, DefaultAiCli, SessionProvider, Todo, Track } from '@foundation/types';
import { useAvailableClis } from '../hooks/useAvailableClis';
import { ImportFromLinearModal } from '../kanban/ImportFromLinearModal';

export interface NewSessionOptions {
  provider: SessionProvider;
  worktreeMode: boolean;
  agentId?: string;
  todoId?: string;
  initialPrompt?: string;
  /** Start a plain shell instead of an AI CLI — a terminal inside the container. */
  shell?: boolean;
  /** Shell sessions only: pin the working directory instead of using the track's first repo. */
  cwd?: string;
  name?: string;
}

/** `shell` isn't a SessionProvider — it's the absence of one. */
type ProviderChoice = SessionProvider | 'shell';

const PROVIDER_META: Record<ProviderChoice, { label: string; color: string }> = {
  claude: { label: 'Claude', color: 'bg-orange-400' },
  cursor: { label: 'Cursor CLI', color: 'bg-violet-400' },
  codex: { label: 'Codex', color: 'bg-emerald-400' },
  gemini: { label: 'Gemini', color: 'bg-blue-400' },
  shell: { label: 'Shell', color: 'bg-gray-400' },
};

interface Props {
  track: Track;
  todos: Todo[];
  defaultProvider: DefaultAiCli;
  onClose: () => void;
  onCreate: (opts: NewSessionOptions) => Promise<unknown>;
  /** Refresh the parent's todo list (after a Linear/Jira import). */
  onTodosChanged: () => void;
}

export function NewSessionModal({ track, todos, defaultProvider, onClose, onCreate, onTodosChanged }: Props) {
  const [provider, setProvider] = useState<ProviderChoice>(defaultProvider);
  const [worktree, setWorktree] = useState(true);
  const [agentId, setAgentId] = useState<string>(track.defaultAgentId ?? '');
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { clis } = useAvailableClis();

  // Offer only enabled agent CLIs (gated via Settings → Available CLIs), plus a
  // plain shell — always available, since it launches nothing.
  const providerOptions: ProviderChoice[] = [
    ...clis.filter((c) => c.kind === 'agent' && c.enabled).map((c) => c.provider as SessionProvider),
    'shell',
  ];

  // Open tasks that aren't already being worked on by a session.
  const openTodos = todos.filter((t) => t.status !== 'done' && !t.sessionId);

  useEffect(() => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then((data: Agent[]) => setAgents(data))
      .catch(() => { /* agent select stays default-only */ });
  }, []);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape' && !showImport) onClose();
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, showImport]);

  const isShell = provider === 'shell';
  const trimmedPrompt = prompt.trim();
  // Cursor's agent CLI must be launched with a prompt — require a task or free text.
  const cursorNeedsPrompt = provider === 'cursor' && !selectedTodoId && !trimmedPrompt;
  const canStart = !starting && !cursorNeedsPrompt;

  async function handleStart() {
    if (!canStart) return;
    setStarting(true);
    setError(null);
    try {
      if (isShell) {
        const created = await onCreate({ provider: 'claude', shell: true, worktreeMode: worktree });
        if (!created) {
          setError('Failed to start session.');
          setStarting(false);
          return;
        }
        onClose();
        return;
      }

      let todoId = selectedTodoId ?? undefined;

      // Ad-hoc prompt → always create a todo so the work is tracked.
      if (!todoId && trimmedPrompt) {
        const res = await fetch(`/api/tracks/${track.id}/todos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: trimmedPrompt.split('\n')[0].slice(0, 120),
            description: trimmedPrompt,
            status: 'ready',
          }),
        });
        if (res.ok) {
          todoId = ((await res.json()) as Todo).id;
        }
      }

      const created = await onCreate({
        provider,
        worktreeMode: worktree,
        agentId: agentId || undefined,
        todoId,
        initialPrompt: trimmedPrompt || undefined,
      });
      if (!created) {
        setError('Failed to start session.');
        setStarting(false);
        return;
      }
      onClose();
    } catch {
      setError('Failed to start session.');
      setStarting(false);
    }
  }

  const sortedAgents = [...agents].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-gray-200">New Session</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          {/* A shell session takes no task, prompt, or agent — it just opens a terminal. */}
          {isShell && (
            <p className="text-xs text-gray-500 border border-gray-800 rounded-lg px-3 py-2">
              Opens an interactive shell in the session's working directory — inside the
              Workshop container, with nix, direnv, and git available. No AI CLI is started.
            </p>
          )}

          {!isShell && (
          <>
          {/* Task selection */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-gray-400">What are we working on?</label>
              <button
                onClick={() => setShowImport(true)}
                className="text-[11px] text-blue-400 hover:text-blue-300"
              >
                Import from Linear/Jira…
              </button>
            </div>
            {openTodos.length > 0 ? (
              <div className="border border-gray-700 rounded-lg divide-y divide-gray-800 max-h-44 overflow-y-auto">
                {openTodos.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTodoId(selectedTodoId === t.id ? null : t.id)}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors ${
                      selectedTodoId === t.id ? 'bg-blue-900/40 text-blue-200' : 'text-gray-300 hover:bg-gray-800'
                    }`}
                  >
                    <span
                      className={`w-3 h-3 rounded-full border shrink-0 ${
                        selectedTodoId === t.id ? 'bg-blue-400 border-blue-400' : 'border-gray-600'
                      }`}
                    />
                    <span className="flex-1 min-w-0 truncate">{t.title}</span>
                    {t.issueKey && (
                      <span className="text-[10px] font-mono text-blue-400 shrink-0">{t.issueKey}</span>
                    )}
                    <span className="text-[10px] text-gray-500 shrink-0">{t.status}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-600 italic border border-gray-800 rounded-lg px-3 py-2">
                No open tasks on this track. Describe the work below, or import an issue.
              </p>
            )}
          </div>

          {/* Initial prompt */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Initial prompt
              {provider === 'cursor' && !selectedTodoId && <span className="text-red-400 ml-1">(required for Cursor)</span>}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder={
                selectedTodoId
                  ? 'Optional — defaults to the selected task'
                  : 'What should this session do right off the rip?'
              }
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-blue-500 resize-y"
            />
            {!selectedTodoId && trimmedPrompt && (
              <p className="mt-1.5 text-xs text-gray-500">A todo will be created so this work is tracked.</p>
            )}
          </div>

          {/* Agent */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Agent</label>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 outline-none focus:border-blue-500"
            >
              <option value="">No agent (plain session)</option>
              {sortedAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.id === track.defaultAgentId ? ' (track default)' : ''}
                </option>
              ))}
            </select>
          </div>
          </>
          )}

          {/* CLI tool */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">CLI tool</label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {providerOptions.map((p) => {
                const meta = PROVIDER_META[p];
                return (
                  <button
                    key={p}
                    onClick={() => setProvider(p)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
                      provider === p ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${meta.color}`} />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Worktree */}
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={worktree}
              onChange={(e) => setWorktree(e.target.checked)}
              className="rounded border-gray-600 bg-gray-800"
            />
            Isolated git worktree
          </label>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="px-5 py-3 border-t border-gray-800 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={!canStart}
            title={cursorNeedsPrompt ? 'Cursor requires a task or an initial prompt' : undefined}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {starting ? 'Starting…' : 'Start Session'}
          </button>
        </div>
      </div>

    </div>

    {showImport && (
      <ImportFromLinearModal
        tracks={[track]}
        onClose={() => setShowImport(false)}
        onImported={onTodosChanged}
      />
    )}
    </>
  );
}
