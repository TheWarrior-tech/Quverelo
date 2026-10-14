import { useEffect, useRef } from 'react';
import { useEditor } from '../hooks';

export function HistoryPanel() {
  const ed = useEditor();
  const h = ed.history;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => ref.current?.scrollIntoView({ block: 'nearest' }), [h?.position]);
  if (!h) return null;
  return (
    <ol className="history-list" aria-label="History">
      {h.list.map((e, i) => (
        <li key={i} ref={i === h.position ? ref : undefined} className={i === h.position ? 'current' : i > h.position ? 'future' : ''}>
          <button onClick={() => h.jumpTo(i)} aria-current={i === h.position}>
            {e.label}
          </button>
        </li>
      ))}
    </ol>
  );
}
