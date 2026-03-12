import { useCallback, useRef } from 'react';

interface Props {
  direction: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
  onResizeEnd: () => void;
}

/**
 * Draggable divider between split panes.
 * For horizontal splits (side-by-side), this is a vertical bar.
 * For vertical splits (stacked), this is a horizontal bar.
 */
export function SplitDivider({ direction, onResize, onResizeEnd }: Props) {
  const draggingRef = useRef(false);
  const lastPosRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = true;
      lastPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!draggingRef.current) return;
        const currentPos = direction === 'horizontal' ? moveEvent.clientX : moveEvent.clientY;
        const delta = currentPos - lastPosRef.current;
        lastPosRef.current = currentPos;
        onResize(delta);
      };

      const handleMouseUp = () => {
        draggingRef.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        onResizeEnd();
      };

      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [direction, onResize, onResizeEnd],
  );

  const isVerticalBar = direction === 'horizontal';

  return (
    <div
      className={`shrink-0 group relative ${
        isVerticalBar
          ? 'w-1 cursor-col-resize hover:bg-blue-500/40'
          : 'h-1 cursor-row-resize hover:bg-blue-500/40'
      } bg-gray-800 transition-colors`}
      onMouseDown={handleMouseDown}
    >
      {/* Wider invisible hit area for easier grabbing */}
      <div
        className={`absolute ${
          isVerticalBar
            ? 'top-0 bottom-0 -left-1 -right-1'
            : 'left-0 right-0 -top-1 -bottom-1'
        }`}
      />
    </div>
  );
}
