import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshButton } from '../shared/RefreshButton';
import { TranscriptModal } from './TranscriptModal';

interface SessionHistoryItem {
  sessionId: string;
  cwd: string | null;
  gitBranch: string | null;
  model: string | null;
  title: string | null;
  preview: string | null;
  firstAt: string | null;
  lastAt: string | null;
  messageCount: number;
  cwdExists: boolean;
  trackId: string | null;
  trackName: string | null;
}

interface TrackOption {
  id: string;
  name: string;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    document.body.removeChild(ta);
    resolve();
  });
}

function resumeCommand(item: SessionHistoryItem): string {
  const base = `claude --resume ${item.sessionId}`;
  return item.cwd ? `cd '${item.cwd.replaceAll("'", "'\\''")}' && ${base}` : base;
}

function groupKey(item: SessionHistoryItem): string {
  return item.trackName ?? item.cwd ?? 'Unknown';
}

function CopyButton({ item }: { item: SessionHistoryItem }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => copyToClipboard(resumeCommand(item)).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })}
      className="px-2 py-1 text-[10px] font-medium rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
    >
      {copied ? 'Copied' : 'Copy command'}
    </button>
  );
}

function ResumeAction({ item, tracks }: { item: SessionHistoryItem; tracks: TrackOption[] }) {
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);
  const [chosenTrackId, setChosenTrackId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = !item.cwdExists;

  async function resumeInto(trackId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/session-history/${item.sessionId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      navigate(`/tracks/${trackId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume');
    } finally {
      setBusy(false);
    }
  }

  if (disabled) {
    return (
      <span title="Original directory no longer exists" className="px-2 py-1 text-[10px] font-medium rounded bg-gray-800 text-gray-600 cursor-not-allowed">
        Resume
      </span>
    );
  }

  const resumeBtn = (onClick: () => void, label: string, extraDisabled = false) => (
    <button onClick={onClick} disabled={busy || extraDisabled} className="px-2 py-1 text-[10px] font-medium rounded bg-emerald-900/50 text-emerald-300 hover:bg-emerald-900/80 disabled:opacity-50">
      {label}
    </button>
  );

  if (item.trackId) {
    return (
      <div className="flex flex-col items-start gap-0.5">
        {resumeBtn(() => resumeInto(item.trackId!), busy ? 'Resuming…' : 'Resume')}
        {error && <span className="text-[10px] text-red-400">{error}</span>}
      </div>
    );
  }

  if (!picking) return resumeBtn(() => setPicking(true), 'Resume');

  return (
    <div className="flex flex-col items-start gap-0.5">
      <div className="flex items-center gap-1">
        <select
          value={chosenTrackId}
          onChange={(e) => setChosenTrackId(e.target.value)}
          className="px-1 py-1 text-[10px] bg-gray-900 border border-gray-700 rounded text-gray-200"
        >
          <option value="">Select track…</option>
          {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {resumeBtn(() => resumeInto(chosenTrackId), busy ? '…' : 'Go', !chosenTrackId)}
      </div>
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </div>
  );
}

function Row({ item, tracks, onViewTranscript }: {
  item: SessionHistoryItem;
  tracks: TrackOption[];
  onViewTranscript: () => void;
}) {
  const heading = item.title ?? item.preview ?? item.sessionId;
  return (
    <div className="px-4 py-3 border-b border-gray-800/60 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-200 truncate">{heading}</div>
        {item.title && item.preview && (
          <div className="text-xs text-gray-500 truncate mt-0.5">{item.preview}</div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[10px] text-gray-500">
          {item.trackName && (
            <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">{item.trackName}</span>
          )}
          {item.cwd && <span className="truncate max-w-[220px]" title={item.cwd}>{item.cwd}</span>}
          {item.gitBranch && <span>· {item.gitBranch}</span>}
          {item.model && <span>· {item.model}</span>}
          <span>· {relativeTime(item.lastAt)}</span>
          <span>· {item.messageCount} msg{item.messageCount === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-1.5 shrink-0">
        <ResumeAction item={item} tracks={tracks} />
        <CopyButton item={item} />
        <button
          onClick={onViewTranscript}
          className="px-2 py-1 text-[10px] font-medium rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
        >
          Transcript
        </button>
      </div>
    </div>
  );
}

export function SessionHistoryPage() {
  const [items, setItems] = useState<SessionHistoryItem[]>([]);
  const [tracks, setTracks] = useState<TrackOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('All');
  const [transcriptItem, setTranscriptItem] = useState<SessionHistoryItem | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/session-history');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setItems(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    fetch('/api/tracks')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: TrackOption[]) => setTracks(data))
      .catch(() => { /* non-fatal — resume dropdown just stays empty */ });
  }, [load]);

  const groups = useMemo(() => {
    const seen = new Set<string>();
    const trackGroups: string[] = [];
    const cwdGroups: string[] = [];
    for (const item of items) {
      const key = groupKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      (item.trackName ? trackGroups : cwdGroups).push(key);
    }
    return ['All', ...trackGroups, ...cwdGroups];
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (group !== 'All' && groupKey(item) !== group) return false;
      if (!q) return true;
      const haystack = [item.title, item.preview, item.cwd, item.gitBranch, item.model, item.sessionId, item.trackName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, query, group]);

  return (
    <div className="h-full flex flex-col bg-gray-950">
      <div className="px-4 py-3 border-b border-gray-800 flex flex-col sm:flex-row sm:items-center gap-2 shrink-0">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sessions…"
          className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-gray-900 border border-gray-800 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600"
        />
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="min-w-0 max-w-[45vw] sm:max-w-xs px-2 py-1.5 text-xs bg-gray-900 border border-gray-800 rounded text-gray-200"
          >
            {groups.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <span className="text-xs text-gray-500 whitespace-nowrap">{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
          <RefreshButton title="Rescan session history" onRefresh={load} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <div className="px-4 py-6 text-xs text-gray-500">Loading…</div>}
        {!loading && error && <div className="px-4 py-6 text-xs text-red-400">{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="px-4 py-6 text-xs text-gray-600">No sessions found.</div>
        )}
        {!loading && !error && filtered.map((item) => (
          <Row
            key={item.sessionId}
            item={item}
            tracks={tracks}
            onViewTranscript={() => setTranscriptItem(item)}
          />
        ))}
      </div>

      {transcriptItem && (
        <TranscriptModal
          sessionId={transcriptItem.sessionId}
          title={transcriptItem.title ?? transcriptItem.preview ?? transcriptItem.sessionId}
          onClose={() => setTranscriptItem(null)}
        />
      )}
    </div>
  );
}
