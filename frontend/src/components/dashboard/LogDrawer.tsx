import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLogs, listLogServices } from '../../api';

export function LogDrawer() {
  const [services, setServices] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const preRef = useRef<HTMLPreElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const contentRef = useRef('');

  useEffect(() => {
    listLogServices()
      .then((list) => {
        setServices(list);
        if (list.length > 0) setSelected(list[0]!);
      })
      .catch(() => {});
  }, []);

  const loadLogs = useCallback(async (service: string) => {
    if (!service) return;
    try {
      const { lines } = await fetchLogs(service);
      const joined = lines.join('\n');
      if (joined === contentRef.current) return;
      contentRef.current = joined;
      const pre = preRef.current;
      const atBottom = pre ? pre.scrollHeight - pre.scrollTop <= pre.clientHeight + 40 : true;
      setContent(joined);
      if (atBottom && pre)
        requestAnimationFrame(() => {
          pre.scrollTop = pre.scrollHeight;
        });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (open && selected) {
      loadLogs(selected);
      pollRef.current = setInterval(() => loadLogs(selected), 2000);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [open, selected, loadLogs]);

  const [height, setHeight] = useState(200);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.clientY;
      startH.current = height;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = startY.current - ev.clientY;
        setHeight(Math.min(600, Math.max(80, startH.current + delta)));
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
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [height],
  );

  return (
    <div className="log-drawer">
      {open && (
        <div
          className="log-resize-handle"
          onMouseDown={onResizeMouseDown}
        />
      )}
      <div className="log-drawer-header">
        <div className="log-drawer-title">
          <button type="button" className="log-toggle-btn" onClick={() => setOpen((v) => !v)}>
            {open ? '▲' : '▼'} ログ
          </button>
          <select className="log-service-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
            {services.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn-icon" onClick={() => setContent('')} title="Clear">
          &#x2715;
        </button>
      </div>
      {open && (
        <div className="log-body" style={{ height }}>
          <pre ref={preRef} className="log-pre">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}
