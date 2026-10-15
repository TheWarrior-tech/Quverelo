import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../Icons';
import { Popover } from './Panel';
import { addRecentFont, fontSections, loadLocalFonts, primaryFamily } from '../fonts';
import { useEditor } from '../hooks';

const ROW = 28;
const VISIBLE = 10;

type Row = { kind: 'head'; title: string } | { kind: 'font'; family: string; index: number };

/**
 * Font picker (UX P1-9): a trigger that shows the family in its own face,
 * opening a popover with search, then Recent · Bundled · System · Installed.
 * Every row is set in its own face. Arrow keys live-preview, Enter commits,
 * Esc reverts to the font you started with. The list is windowed so a machine
 * with thousands of installed families stays fast.
 */
export function FontPicker({ value, onPreview, onCommit, compact = false }: { value: string; onPreview: (family: string) => void; onCommit: (family: string) => void; compact?: boolean }) {
  useEditor(); // re-render when local fonts load
  const family = primaryFamily(value || 'Inter');
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        className={`font-trigger${compact ? ' compact' : ''}${anchor ? ' open' : ''}`}
        aria-label={`Font: ${family}`}
        aria-haspopup="listbox"
        aria-expanded={!!anchor}
        title={`Font: ${family}`}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <span className="font-trigger-name" style={{ fontFamily: `"${family}"` }}>{family}</span>
        <Icon name="chevron-down" size={16} />
      </button>
      {anchor && <FontList anchor={anchor} initial={family} onPreview={onPreview} onCommit={onCommit} onClose={() => setAnchor(null)} />}
    </>
  );
}

function FontList({ anchor, initial: initialProp, onPreview, onCommit, onClose }: { anchor: HTMLElement; initial: string; onPreview: (f: string) => void; onCommit: (f: string) => void; onClose: () => void }) {
  const ed = useEditor();
  // the font when the list opened: live previews change the trigger's value, Esc returns here
  const [initial] = useState(initialProp);
  const [query, setQuery] = useState('');
  const [scroll, setScroll] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void loadLocalFonts();
  }, []);
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let i = 0;
    for (const s of fontSections(query)) {
      out.push({ kind: 'head', title: s.title });
      for (const f of s.fonts) out.push({ kind: 'font', family: f, index: i++ });
    }
    return out;
    // version: local fonts arriving re-render
  }, [query, ed.version]);
  const fonts = rows.filter((r): r is Extract<Row, { kind: 'font' }> => r.kind === 'font');
  const [active, setActive] = useState(() => Math.max(0, fonts.findIndex((f) => f.family === initial)));
  useEffect(() => setActive((a) => (query ? 0 : a)), [query]);
  const activeFont = fonts[Math.min(active, fonts.length - 1)];
  const rowOf = (fontIndex: number) => rows.findIndex((r) => r.kind === 'font' && r.index === fontIndex);

  // keep the active row in view
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !activeFont) return;
    const top = rowOf(activeFont.index) * ROW;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight;
  }, [active, rows]);

  const close = (commit: string | null) => {
    if (commit) {
      addRecentFont(commit);
      onCommit(commit);
    } else onPreview(initial);
    onClose();
  };

  const move = (d: number) => {
    if (!fonts.length) return;
    const n = Math.max(0, Math.min(fonts.length - 1, active + d));
    setActive(n);
    onPreview(fonts[n].family);
  };
  const first = Math.max(0, Math.floor(scroll / ROW) - 4);
  const last = Math.min(rows.length, first + VISIBLE + 10);
  const listId = 'font-list';
  return (
    <Popover anchor={anchor} label="Fonts" onClose={() => close(null)} className="font-popover">
      <div className="font-search">
        <Icon name="zoom" size={16} />
        <input
          type="text"
          role="combobox"
          aria-label="Search fonts"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeFont ? `font-opt-${activeFont.index}` : undefined}
          placeholder="Search fonts"
          data-autofocus
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            else if (e.key === 'PageDown') { e.preventDefault(); move(VISIBLE); }
            else if (e.key === 'PageUp') { e.preventDefault(); move(-VISIBLE); }
            else if (e.key === 'Enter') { e.preventDefault(); if (activeFont) close(activeFont.family); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); anchor.focus(); }
          }}
        />
      </div>
      <div ref={listRef} className="font-list" id={listId} role="listbox" aria-label="Fonts" onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
        <div className="font-list-inner" style={{ height: rows.length * ROW }}>
          {rows.slice(first, last).map((r, k) => {
            const top = (first + k) * ROW;
            if (r.kind === 'head') return <div key={`h-${r.title}`} className="font-head" role="presentation" style={{ top }}>{r.title}</div>;
            const on = activeFont?.index === r.index;
            return (
              <div
                key={r.family}
                id={`font-opt-${r.index}`}
                role="option"
                aria-selected={on}
                className={`font-row${on ? ' active' : ''}${r.family === initial ? ' current' : ''}`}
                style={{ top, fontFamily: `"${r.family}"` }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => close(r.family)}
                onMouseEnter={() => setActive(r.index)}
              >
                <span className="font-row-name">{r.family}</span>
                {r.family === initial && <Icon name="check" size={16} />}
              </div>
            );
          })}
        </div>
        {!fonts.length && <p className="font-empty">No fonts match “{query}”.</p>}
      </div>
    </Popover>
  );
}
