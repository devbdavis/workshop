import { useState, useCallback, useEffect, useRef } from 'react';
import { TerminalPanel } from '../terminal-panel/TerminalPanel';

interface Props {
  trackId: string;
  sessionId: string;
  title: string;
  onClose: () => void;
}

interface Size {
  width: number;
  height: number;
}

interface Position {
  x: number;
  y: number;
}

type ResizeDirection =
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw';

const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;

const CURSOR_MAP: Record<ResizeDirection, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  sw: 'nesw-resize',
};

export function TerminalModal({ trackId, sessionId, title, onClose }: Props) {
  const [size, setSize] = useState<Size>({ width: 800, height: 500 });
  const [position, setPosition] = useState<Position>(() => ({
    x: Math.max(0, (window.innerWidth - 800) / 2),
    y: Math.max(0, (window.innerHeight - 500) / 2),
  }));
  const [isDragging, setIsDragging] = useState(false);
  const [resizeDir, setResizeDir] = useState<ResizeDirection | null>(null);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });
  const resizeStartRef = useRef({ mouseX: 0, mouseY: 0, width: 0, height: 0, posX: 0, posY: 0 });

  // Dragging (title bar)
  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        posX: position.x,
        posY: position.y,
      };
    },
    [position],
  );

  // Resize start
  const onResizeStart = useCallback(
    (dir: ResizeDirection) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setResizeDir(dir);
      resizeStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        width: size.width,
        height: size.height,
        posX: position.x,
        posY: position.y,
      };
    },
    [size, position],
  );

  useEffect(() => {
    if (!isDragging && !resizeDir) return;

    const onMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const dx = e.clientX - dragStartRef.current.mouseX;
        const dy = e.clientY - dragStartRef.current.mouseY;
        setPosition({
          x: dragStartRef.current.posX + dx,
          y: dragStartRef.current.posY + dy,
        });
      }

      if (resizeDir) {
        const start = resizeStartRef.current;
        const dx = e.clientX - start.mouseX;
        const dy = e.clientY - start.mouseY;

        let newWidth = start.width;
        let newHeight = start.height;
        let newX = start.posX;
        let newY = start.posY;

        if (resizeDir.includes('e')) {
          newWidth = Math.max(MIN_WIDTH, start.width + dx);
        }
        if (resizeDir.includes('w')) {
          const proposedWidth = start.width - dx;
          if (proposedWidth >= MIN_WIDTH) {
            newWidth = proposedWidth;
            newX = start.posX + dx;
          }
        }
        if (resizeDir.includes('s')) {
          newHeight = Math.max(MIN_HEIGHT, start.height + dy);
        }
        if (resizeDir.includes('n')) {
          const proposedHeight = start.height - dy;
          if (proposedHeight >= MIN_HEIGHT) {
            newHeight = proposedHeight;
            newY = start.posY + dy;
          }
        }

        setSize({ width: newWidth, height: newHeight });
        setPosition({ x: newX, y: newY });
      }
    };

    const onMouseUp = () => {
      setIsDragging(false);
      setResizeDir(null);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging, resizeDir]);

  // Set body cursor during drag/resize
  useEffect(() => {
    if (isDragging) {
      document.body.style.cursor = 'move';
      document.body.style.userSelect = 'none';
    } else if (resizeDir) {
      document.body.style.cursor = CURSOR_MAP[resizeDir];
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, resizeDir]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const edgeSize = 6;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal window */}
      <div
        className="absolute bg-gray-900 border border-gray-700 rounded-lg shadow-2xl flex flex-col overflow-hidden"
        style={{
          left: position.x,
          top: position.y,
          width: size.width,
          height: size.height,
        }}
      >
        {/* Title bar */}
        <div
          className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700 shrink-0 cursor-move select-none"
          onMouseDown={onDragStart}
        >
          <div className="flex items-center gap-2 min-w-0">
            <TerminalIcon className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-sm text-gray-200 truncate">{title}</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-lg leading-none px-1"
            onMouseDown={(e) => e.stopPropagation()}
          >
            &times;
          </button>
        </div>

        {/* Terminal content */}
        <div className="flex-1 min-h-0">
          <TerminalPanel trackId={trackId} sessionId={sessionId} />
        </div>

        {/* Resize handles */}
        {/* Edges */}
        <div
          className="absolute top-0 left-0 right-0"
          style={{ height: edgeSize, cursor: 'ns-resize' }}
          onMouseDown={onResizeStart('n')}
        />
        <div
          className="absolute bottom-0 left-0 right-0"
          style={{ height: edgeSize, cursor: 'ns-resize' }}
          onMouseDown={onResizeStart('s')}
        />
        <div
          className="absolute top-0 left-0 bottom-0"
          style={{ width: edgeSize, cursor: 'ew-resize' }}
          onMouseDown={onResizeStart('w')}
        />
        <div
          className="absolute top-0 right-0 bottom-0"
          style={{ width: edgeSize, cursor: 'ew-resize' }}
          onMouseDown={onResizeStart('e')}
        />
        {/* Corners */}
        <div
          className="absolute top-0 left-0"
          style={{ width: edgeSize * 2, height: edgeSize * 2, cursor: 'nwse-resize' }}
          onMouseDown={onResizeStart('nw')}
        />
        <div
          className="absolute top-0 right-0"
          style={{ width: edgeSize * 2, height: edgeSize * 2, cursor: 'nesw-resize' }}
          onMouseDown={onResizeStart('ne')}
        />
        <div
          className="absolute bottom-0 left-0"
          style={{ width: edgeSize * 2, height: edgeSize * 2, cursor: 'nwse-resize' }}
          onMouseDown={onResizeStart('sw')}
        />
        <div
          className="absolute bottom-0 right-0"
          style={{ width: edgeSize * 2, height: edgeSize * 2, cursor: 'nesw-resize' }}
          onMouseDown={onResizeStart('se')}
        />
      </div>
    </div>
  );
}

/** Inline terminal SVG icon (no icon library dependency) */
function TerminalIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M7 9l3 3-3 3" />
      <path d="M13 15h4" />
    </svg>
  );
}
