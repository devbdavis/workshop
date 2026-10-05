import type { Pick } from './DesignPreview';

export interface PickItem {
  id: string;
  pick: Pick;
  shotStatus: 'none' | 'loading' | 'done' | 'error';
  shotDataUrl?: string;
  shotFile?: string;
}

interface Props {
  picks: PickItem[];
  onRemove: (id: string) => void;
  note: string;
  onNoteChange: (note: string) => void;
  onSend: () => void;
  sending: boolean;
  sendMessage: string | null;
  sendError: string | null;
  atLimit: boolean;
}

/** Right-side tray: staged picks awaiting a note and send to the agent. */
export function PickTray({ picks, onRemove, note, onNoteChange, onSend, sending, sendMessage, sendError, atLimit }: Props) {
  return (
    <div className="w-80 shrink-0 border-l border-gray-800 flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-gray-800 text-xs text-gray-400 shrink-0">
        Picks ({picks.length}/10){atLimit && <span className="text-yellow-500 ml-2">Remove one to add more</span>}
      </div>
      <div className="flex-1 overflow-y-auto">
        {picks.length === 0 ? (
          <div className="p-3 text-xs text-gray-500">Turn on Pick and click an element in the preview.</div>
        ) : (
          picks.map((item) => <PickCard key={item.id} item={item} onRemove={onRemove} />)
        )}
      </div>
      <div className="p-3 border-t border-gray-800 space-y-2 shrink-0">
        <textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="What should change?"
          rows={3}
          className="w-full bg-gray-950 border border-gray-700 rounded text-xs text-gray-200 p-2 outline-none resize-none placeholder:text-gray-600"
        />
        <button
          onClick={onSend}
          disabled={picks.length === 0 || sending}
          className="w-full text-xs py-1.5 rounded bg-blue-900/50 text-blue-200 hover:bg-blue-800/60 disabled:opacity-40 disabled:hover:bg-blue-900/50"
        >
          {sending ? 'Sending…' : 'Send to agent'}
        </button>
        {sendMessage && <p className="text-xs text-green-400">{sendMessage}</p>}
        {sendError && <p className="text-xs text-red-400">{sendError}</p>}
      </div>
    </div>
  );
}

function PickCard({ item, onRemove }: { item: PickItem; onRemove: (id: string) => void }) {
  const { pick } = item;
  return (
    <div className="flex gap-2 px-3 py-2 border-b border-gray-800/60">
      <div className="w-14 h-14 shrink-0 rounded bg-gray-950 border border-gray-800 flex items-center justify-center overflow-hidden">
        {item.shotStatus === 'loading' && <span className="text-[10px] text-gray-500">shot…</span>}
        {item.shotStatus === 'error' && <span className="text-[10px] text-gray-600 text-center px-1">no screenshot</span>}
        {item.shotStatus === 'done' && item.shotDataUrl && (
          <img src={item.shotDataUrl} alt="" className="w-full h-full object-cover" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] font-mono text-gray-300 truncate" title={pick.selector}>
            &lt;{pick.tag}&gt; {pick.selector}
          </span>
          <button onClick={() => onRemove(item.id)} className="text-gray-500 hover:text-gray-200 shrink-0 leading-none">
            ×
          </button>
        </div>
        {pick.text && <p className="text-[10px] text-gray-500 truncate" title={pick.text}>{pick.text}</p>}
        {pick.source && <p className="text-[10px] text-gray-600 truncate" title={pick.source}>{pick.source}</p>}
      </div>
    </div>
  );
}
