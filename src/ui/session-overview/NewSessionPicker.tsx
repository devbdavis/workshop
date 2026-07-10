import { useEffect, useRef, useState } from 'react';
import type { Track } from '@foundation/types';

interface Props {
  tracks: Track[];
  onPick: (trackId: string) => void;
}

/** Sidebar "+" button that asks which track before opening the New Session modal. */
export function NewSessionPicker({ tracks, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-gray-500 hover:text-blue-400 px-1.5 text-sm leading-none"
        title="New session"
      >
        +
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-48 max-h-64 overflow-y-auto bg-gray-900 border border-gray-700 rounded-lg shadow-xl py-1">
          <p className="px-3 py-1 text-[10px] text-gray-500 uppercase tracking-wide">New session in…</p>
          {tracks.length === 0 ? (
            <p className="px-3 py-1.5 text-xs text-gray-600 italic">No tracks</p>
          ) : (
            tracks.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setOpen(false);
                  onPick(t.id);
                }}
                className="block w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 hover:text-blue-300 truncate"
              >
                {t.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
