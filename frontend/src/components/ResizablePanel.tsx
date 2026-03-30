import { type ReactNode, useCallback, useRef, useState } from 'react';

interface Props {
  children: ReactNode;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  /** Which side the handle is on: 'left' = handle on left edge (right panel), 'right' = handle on right edge (left panel) */
  handle?: 'left' | 'right';
}

export function ResizablePanel({
  children,
  defaultWidth = 280,
  minWidth = 200,
  maxWidth = 600,
  handle = 'left',
}: Props) {
  const [width, setWidth] = useState(defaultWidth);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startWidth.current = width;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = ev.clientX - startX.current;
        // handle='right': dragging right = wider; handle='left': dragging left = wider
        const adjusted = handle === 'right' ? delta : -delta;
        const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth.current + adjusted));
        setWidth(newWidth);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [width, minWidth, maxWidth, handle],
  );

  const handleStyle: React.CSSProperties = {
    position: 'absolute',
    [handle === 'right' ? 'right' : 'left']: 0,
    top: 0,
    bottom: 0,
    width: 4,
    cursor: 'col-resize',
    zIndex: 10,
    background: 'transparent',
  };

  return (
    <div style={{ width, minWidth: width, position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <hr
        aria-orientation="vertical"
        aria-valuenow={Math.round(((width - minWidth) / (maxWidth - minWidth)) * 100)}
        tabIndex={0}
        onMouseDown={onMouseDown}
        style={handleStyle}
        onMouseEnter={(e) => {
          (e.target as HTMLElement).style.background = 'var(--accent)';
        }}
        onMouseLeave={(e) => {
          if (!dragging.current) (e.target as HTMLElement).style.background = 'transparent';
        }}
      />
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  );
}
