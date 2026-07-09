import { useState, useEffect } from 'react';
import type { Todo, TodoStatus, TodoPriority, Track, Agent, PullRequest } from '@foundation/types';
import { DispatchDropdown, type DispatchOptions } from '../track-view/DispatchDropdown';
import { LinearTicketModal } from './LinearTicketModal';

interface Props {
  todo: Todo | null;
  tracks: Track[];
  onClose: () => void;
  onSave: (todoId: string, data: Partial<Todo>) => void;
  onDelete: (todoId: string) => void;
  onDispatch: (todoId: string, opts: DispatchOptions, formData?: Partial<Todo>) => void;
}

const STATUSES: { value: TodoStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'ready', label: 'Ready' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
];

const PRIORITIES: { value: TodoPriority; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export function TodoDetailModal({ todo, tracks, onClose, onSave, onDelete, onDispatch }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [resolution, setResolution] = useState('');
  const [issueKey, setTicketKey] = useState('');
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [prDraft, setPrDraft] = useState<{ url: string; title: string } | null>(null);
  const [editingPrIndex, setEditingPrIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<TodoStatus>('backlog');
  const [priority, setPriority] = useState<TodoPriority>('medium');
  const [refined, setRefined] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showDispatch, setShowDispatch] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);

  useEffect(() => {
    if (todo) {
      setTitle(todo.title);
      setDescription(todo.description || '');
      setResolution(todo.resolution || '');
      setTicketKey(todo.issueKey || '');
      setPullRequests(todo.pullRequests ?? []);
      setPrDraft(null);
      setEditingPrIndex(null);
      setStatus(todo.status);
      setPriority(todo.priority);
      setRefined(todo.refined);
      setShowDispatch(false);
      setConfirmDelete(false);
      setCreatingTicket(false);
      setTicketError(null);
    }
  }, [todo]);

  // Load agents when dispatch might be needed
  useEffect(() => {
    if (!todo) return;
    fetch('/api/agents')
      .then((res) => res.json())
      .then(setAgents)
      .catch(() => {});
  }, [todo]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  if (!todo) return null;

  const trackName = tracks.find((t) => t.id === todo.trackId)?.name || 'Unknown';
  const canDispatch = refined && (status === 'ready' || status === 'backlog');

  function handleSave() {
    onSave(todo!.id, {
      title,
      description: description || undefined,
      resolution: resolution || undefined,
      issueKey: issueKey || undefined,
      pullRequests: pullRequests.length > 0 ? pullRequests : undefined,
      status,
      priority,
      refined,
    });
  }

  async function handleCreateLinearTicket() {
    setTicketError(null);
    // Persist current edits first so the drafting agent sees the latest content.
    await fetch(`/api/todos/${todo!.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description: description || undefined, status, priority, refined }),
    });
    const res = await fetch(`/api/todos/${todo!.id}/create-linear-ticket`, { method: 'POST' }).catch(() => null);
    if (!res || !res.ok) {
      setTicketError('Could not start ticket creation. Try again.');
      return;
    }
    setCreatingTicket(true);
  }

  function commitPrDraft() {
    if (!prDraft || !prDraft.url.trim()) return;
    const entry: PullRequest = { url: prDraft.url.trim(), title: prDraft.title.trim() || undefined };
    if (editingPrIndex !== null) {
      setPullRequests((prev) => prev.map((pr, i) => (i === editingPrIndex ? entry : pr)));
      setEditingPrIndex(null);
    } else {
      setPullRequests((prev) => [...prev, entry]);
    }
    setPrDraft(null);
  }

  function startEditPr(index: number) {
    const pr = pullRequests[index];
    setEditingPrIndex(index);
    setPrDraft({ url: pr.url, title: pr.title ?? '' });
  }

  function removePr(index: number) {
    setPullRequests((prev) => prev.filter((_, i) => i !== index));
    if (editingPrIndex === index) {
      setEditingPrIndex(null);
      setPrDraft(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-[80vw] h-[80vh] mx-4 overflow-hidden resize flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 shrink-0">
          <h2 className="text-sm font-semibold text-gray-200">Edit Todo</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">&times;</button>
        </div>

        <div className="p-5 space-y-4 flex-1 overflow-y-auto">
          <div className="text-xs text-gray-500">
            Track: <span className="text-gray-300">{trackName}</span>
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1">Description / Task Prompt</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 font-mono"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-xs text-gray-400 block mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TodoStatus)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm"
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-400 block mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TodoPriority)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="refined"
              checked={refined}
              onChange={(e) => setRefined(e.target.checked)}
              className="rounded border-gray-600 bg-gray-800"
            />
            <label htmlFor="refined" className="text-sm text-gray-300">
              Refined (ready for agent dispatch)
            </label>
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1">Issue</label>
            <input
              value={issueKey}
              onChange={(e) => {
              const raw = e.target.value;
              const linearMatch = raw.match(/\/issue\/([A-Z0-9]+-\d+)/i);
              setTicketKey(linearMatch ? linearMatch[1].toUpperCase() : raw.toUpperCase());
            }}
              placeholder="e.g. ASY-1402"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 font-mono placeholder:text-gray-600"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1">Pull Requests</label>
            <div className="space-y-1.5">
              {pullRequests.map((pr, i) => (
                <div key={i} className="flex items-center gap-2 group">
                  {editingPrIndex === i ? null : (
                    <>
                      <a
                        href={pr.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 truncate text-xs text-blue-400 hover:text-blue-300 hover:underline font-mono"
                        title={pr.url}
                      >
                        {pr.title || pr.url}
                      </a>
                      <button
                        onClick={() => onDispatch(todo!.id, { agentId: 'global:pr-review' }, {
                          title, description: description || undefined, status, priority, refined,
                          pullRequests: pullRequests.length > 0 ? pullRequests : undefined,
                        })}
                        className="opacity-0 group-hover:opacity-100 text-emerald-500 hover:text-emerald-300 text-xs px-1 transition-opacity"
                        title="Dispatch a PR review session (pr-review agent)"
                      >
                        Review
                      </button>
                      <button
                        onClick={() => startEditPr(i)}
                        className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-gray-300 text-xs px-1 transition-opacity"
                        title="Edit"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => removePr(i)}
                        className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 text-xs px-1 transition-opacity"
                        title="Remove"
                      >
                        ×
                      </button>
                    </>
                  )}
                </div>
              ))}

              {prDraft !== null ? (
                <div className="space-y-1.5 pt-1">
                  <input
                    autoFocus
                    value={prDraft.url}
                    onChange={(e) => setPrDraft((d) => d && { ...d, url: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitPrDraft(); if (e.key === 'Escape') { setPrDraft(null); setEditingPrIndex(null); } }}
                    placeholder="PR URL"
                    className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-200 font-mono placeholder:text-gray-600"
                  />
                  <input
                    value={prDraft.title}
                    onChange={(e) => setPrDraft((d) => d && { ...d, title: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitPrDraft(); if (e.key === 'Escape') { setPrDraft(null); setEditingPrIndex(null); } }}
                    placeholder="Label (optional)"
                    className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-xs text-gray-200 placeholder:text-gray-600"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={commitPrDraft}
                      className="px-2 py-1 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded transition-colors"
                    >
                      {editingPrIndex !== null ? 'Update' : 'Add'}
                    </button>
                    <button
                      onClick={() => { setPrDraft(null); setEditingPrIndex(null); }}
                      className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setPrDraft({ url: '', title: '' })}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  + Add PR
                </button>
              )}
            </div>
          </div>

          {(status === 'review' || status === 'done') && (
            <div>
              <label className="text-xs text-gray-400 block mb-1">Resolution</label>
              <textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                rows={4}
                placeholder="What happened, what was decided, or why this was completed…"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 font-mono placeholder:text-gray-600"
              />
            </div>
          )}

          {todo.sessionId && (
            <div className="text-xs text-emerald-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Agent session active
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800 shrink-0">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">Delete?</span>
              <button
                onClick={() => onDelete(todo.id)}
                className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors"
                autoFocus
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Delete
            </button>
          )}
          <div className="flex gap-2">
            {canDispatch && (
              <div className="relative">
                <button
                  onClick={() => setShowDispatch(!showDispatch)}
                  className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded-lg transition-colors"
                >
                  Dispatch to Agent
                </button>
                {showDispatch && (
                  <DispatchDropdown
                    agents={agents}
                    defaultAgent={(() => {
                      const track = tracks.find((t) => t.id === todo.trackId);
                      return track?.defaultAgentId ? agents.find((a) => a.id === track.defaultAgentId) : undefined;
                    })()}
                    popUp
                    onSelect={(opts) => {
                      setShowDispatch(false);
                      onDispatch(todo.id, opts, { title, description: description || undefined, status, priority, refined });
                    }}
                    onClose={() => setShowDispatch(false)}
                  />
                )}
              </div>
            )}
            {!issueKey && (
              <>
                {ticketError && <span className="text-xs text-red-400 self-center">{ticketError}</span>}
                <button
                  onClick={handleCreateLinearTicket}
                  className="px-3 py-1.5 text-xs bg-indigo-700 hover:bg-indigo-600 text-white rounded-lg transition-colors"
                  title="Dispatch an agent to draft and file a Linear ticket from this todo"
                >
                  Create Linear Ticket
                </button>
              </>
            )}
            {status !== 'ready' && status !== 'done' && status !== 'in-progress' && (
              <button
                onClick={() => onSave(todo.id, { title, description: description || undefined, status: 'ready', priority, refined: true })}
                className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded-lg transition-colors"
              >
                Mark Ready
              </button>
            )}
            {status !== 'done' && (
              <button
                onClick={() => onSave(todo.id, { title, description: description || undefined, status: 'done', priority, refined })}
                className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
              >
                Mark Done
              </button>
            )}
            <button
              onClick={handleSave}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </div>

      {creatingTicket && (
        <LinearTicketModal todoId={todo.id} onClose={() => setCreatingTicket(false)} />
      )}
    </div>
  );
}
