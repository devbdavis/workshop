import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import type { DiffComment } from './useDiffComments';

/** Colors one codeContext line by its leading diff marker (mirrors FindingCard). */
function contextLineClassName(line: string): string | undefined {
  if (line.startsWith('+')) return 'text-emerald-300 bg-emerald-900/20';
  if (line.startsWith('-')) return 'text-red-300 bg-red-900/20';
  if (line.startsWith('@@')) return 'text-blue-400';
  return undefined;
}

function CodeContext({ codeContext }: { codeContext: string }) {
  return (
    <pre className="text-[11px] leading-4 font-mono bg-gray-950 border border-gray-800 rounded p-2 overflow-x-auto text-gray-400 mb-1 whitespace-pre">
      {codeContext.split('\n').map((line, i) => (
        <div key={i} className={contextLineClassName(line)}>{line || ' '}</div>
      ))}
    </pre>
  );
}

interface ComposerProps {
  initialValue?: string;
  onSave: (body: string) => Promise<void>;
  onCancel: () => void;
}

export function CommentComposer({ initialValue = '', onSave, onCancel }: ComposerProps) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  async function save(): Promise<void> {
    if (!value.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void save(); }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  }

  return (
    <div className="whitespace-normal border border-gray-700 rounded my-1 p-2 bg-gray-900">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        placeholder="Leave a comment (markdown)… ⌘/Ctrl+Enter to save, Esc to cancel"
        className="w-full px-2 py-1 text-xs bg-gray-950 border border-gray-800 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600 resize-y whitespace-pre-wrap"
      />
      {error && <div className="text-[10px] text-red-300 mt-1">{error}</div>}
      <div className="flex gap-2 mt-1">
        <button
          onClick={save}
          disabled={saving || !value.trim()}
          className="text-[10px] px-2 py-0.5 rounded bg-blue-900/50 text-blue-200 hover:bg-blue-800/60 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700">
          Cancel
        </button>
      </div>
    </div>
  );
}

interface CommentItemProps {
  comment: DiffComment;
  onUpdate: (patch: { body?: string; status?: 'open' | 'resolved' }) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function CommentItem({ comment, onUpdate, onDelete }: CommentItemProps) {
  const [editing, setEditing] = useState(false);
  const resolved = comment.status === 'resolved';

  if (editing) {
    return (
      <CommentComposer
        initialValue={comment.body}
        onSave={async (body) => { await onUpdate({ body }); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className={`whitespace-normal border border-gray-800 rounded my-1 ${resolved ? 'opacity-60 px-2 py-1' : 'bg-gray-900/40 px-2 py-1.5'}`}>
      <div className="flex items-center gap-1.5 text-[10px] text-gray-500 mb-1">
        {resolved && <span className="text-emerald-400">resolved</span>}
        {comment.sentAt && <span className="px-1 rounded bg-blue-900/40 text-blue-300">sent</span>}
        <span className="ml-auto flex gap-2">
          <button onClick={() => void onUpdate({ status: resolved ? 'open' : 'resolved' })} className="hover:text-gray-200">
            {resolved ? 'Reopen' : 'Resolve'}
          </button>
          <button onClick={() => setEditing(true)} className="hover:text-gray-200">Edit</button>
          <button onClick={() => void onDelete()} className="hover:text-red-300">Delete</button>
        </span>
      </div>
      <div className="text-xs text-gray-200 markdown-body">
        <Markdown>{comment.body}</Markdown>
      </div>
    </div>
  );
}

interface OutdatedProps {
  comments: DiffComment[];
  onUpdate: (id: string, patch: { body?: string; status?: 'open' | 'resolved' }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function OutdatedComments({ comments, onUpdate, onDelete }: OutdatedProps) {
  if (comments.length === 0) return null;
  return (
    <div className="whitespace-normal m-2 border border-amber-900/50 rounded bg-amber-950/10">
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-amber-400 border-b border-amber-900/40">
        Outdated ({comments.length})
      </div>
      <div className="px-2 py-1.5 space-y-1">
        {comments.map((c) => (
          <div key={c.id}>
            {c.codeContext && <CodeContext codeContext={c.codeContext} />}
            <CommentItem comment={c} onUpdate={(patch) => onUpdate(c.id, patch)} onDelete={() => onDelete(c.id)} />
          </div>
        ))}
      </div>
    </div>
  );
}
