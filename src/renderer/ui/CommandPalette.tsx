/**
 * Command palette (UX audit P0-1). Ctrl/⌘+K (or Ctrl/⌘+/) opens a
 * search-and-run list of every menu command, tool, template and recent file.
 *
 * Accessibility: the input is an ARIA 1.2 combobox that owns a listbox; the
 * active option is tracked with aria-activedescendant so focus never leaves
 * the input. ↑/↓ (wrapping), Page Up/Down, Enter runs, Esc clears the query
 * and then closes, Tab stays put. Focus returns to where it was before the
 * command runs, so commands behave exactly as they would from the menu.
 */
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { editor } from '../state/editor';
import { buildEntries, closePalette, onPalette, paletteOpen, recentKeys, rememberRun, type PaletteEntry } from '../state/palette';
import type { RecentFile } from '../../shared/api';
import { rank, type Match } from './fuzzy';
import { Icon, hasIcon } from './Icons';
import { Keys } from './dialogs/controls';

const MAX_RESULTS = 60;
const PAGE = 8;

interface Row {
  entry: PaletteEntry;
  match?: Match;
}
interface Section {
  title?: string;
  rows: Row[];
}

/** Label with matched ranges emphasised. */
function Highlight({ text, ranges }: { text: string; ranges?: [number, number][] }) {
  if (!ranges?.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([s, e], i) => {
    if (s > at) out.push(text.slice(at, s));
    out.push(<mark key={i}>{text.slice(s, e)}</mark>);
    at = e;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

/** Sections shown for the current query: browse mode (grouped, recents first) or ranked results. */
export function paletteSections(query: string, entries: PaletteEntry[], recent: string[]): Section[] {
  if (query.trim()) {
    const ranked = rank(query, entries).slice(0, MAX_RESULTS);
    return ranked.length ? [{ rows: ranked.map((r) => ({ entry: r.item, match: r.match })) }] : [];
  }
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const recentRows = recent.map((k) => byKey.get(k)).filter((e): e is PaletteEntry => !!e).map((entry) => ({ entry }));
  const pick = (p: string) => entries.filter((e) => e.key.startsWith(p)).map((entry) => ({ entry }));
  return [
    { title: 'Recent', rows: recentRows },
    { title: 'Commands', rows: pick('cmd:') },
    { title: 'Tools', rows: pick('tool:') },
    { title: 'Templates', rows: pick('template:') },
    { title: 'Recent files', rows: pick('file:') },
  ].filter((s) => s.rows.length);
}

function Palette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [active, setActive] = useState(0);
  const [note, setNote] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const base = useId().replace(/:/g, '');
  const listId = `${base}-list`;

  useEffect(() => {
    inputRef.current?.focus();
    if (!editor.feature('recent-files')) return;
    let live = true;
    window.quvrelo
      ?.getRecent()
      .then((r) => live && setRecentFiles(r.slice(0, 8)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const entries = useMemo(() => buildEntries(recentFiles), [recentFiles]);
  const recent = useMemo(() => recentKeys(), []);
  const sections = useMemo(() => paletteSections(query, entries, recent), [query, entries, recent]);
  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const optId = (i: number) => `${base}-opt-${i}`;

  useEffect(() => {
    setActive(0);
    setNote('');
  }, [query]);

  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`#${optId(active)}`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, rows]);

  const runRow = (i: number) => {
    const row = rows[i];
    if (!row) return;
    if (row.entry.disabled) {
      setNote(`${row.entry.label}: ${row.entry.disabled}`);
      return;
    }
    rememberRun(row.entry.key);
    onClose();
    // let focus return and the palette unmount before the command opens anything
    window.requestAnimationFrame(() => void row.entry.run());
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const n = rows.length;
    const move = (to: number) => {
      e.preventDefault();
      if (n) setActive(((to % n) + n) % n);
    };
    switch (e.key) {
      case 'ArrowDown':
        return move(active + 1);
      case 'ArrowUp':
        return move(active - 1);
      case 'PageDown':
        e.preventDefault();
        return n && setActive(Math.min(n - 1, active + PAGE));
      case 'PageUp':
        e.preventDefault();
        return n && setActive(Math.max(0, active - PAGE));
      case 'Enter':
        if (e.nativeEvent.isComposing) return;
        e.preventDefault();
        return runRow(active);
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        if (query) setQuery('');
        else onClose();
        return;
      case 'Tab':
        e.preventDefault();
        return;
    }
  };

  let index = -1;
  const count = rows.length;
  return (
    <div className="cmdk-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="cmdk-search">
          <Icon name="zoom" size={16} />
          <input
            ref={inputRef}
            className="cmdk-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={count ? optId(active) : undefined}
            aria-label="Search commands, tools, templates and files"
            placeholder="Search commands, tools, templates…"
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <div className="cmdk-list" id={listId} role="listbox" aria-label="Commands" ref={listRef}>
          {sections.map((s, si) => {
            const headId = `${base}-g-${si}`;
            const body = s.rows.map((r) => {
              index++;
              const i = index;
              const e = r.entry;
              return (
                <div
                  key={e.key + i}
                  id={optId(i)}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={e.disabled ? true : undefined}
                  className={`cmdk-row${i === active ? ' active' : ''}${e.disabled ? ' disabled' : ''}`}
                  data-key={e.key}
                  onMouseMove={() => i !== active && setActive(i)}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => runRow(i)}
                >
                  <span className="cmdk-icon" aria-hidden="true">{e.icon && hasIcon(e.icon) ? <Icon name={e.icon} size={16} /> : null}</span>
                  <span className="cmdk-label"><Highlight text={e.label} ranges={r.match?.ranges} /></span>
                  <span className="cmdk-meta">{e.disabled ?? e.group}</span>
                  {e.keys && <span className="cmdk-keys"><Keys combo={e.keys} /></span>}
                </div>
              );
            });
            return s.title ? (
              <div key={s.title} role="group" aria-labelledby={headId} className="cmdk-group">
                <div className="cmdk-head" id={headId} role="presentation">{s.title}</div>
                {body}
              </div>
            ) : (
              <Fragment key={`r${si}`}>{body}</Fragment>
            );
          })}
          {!count && <div className="cmdk-empty">No commands match “{query.trim()}”</div>}
        </div>
        <div className="cmdk-foot" aria-hidden="true">
          <span><Keys combo="↑ / ↓" /> Move</span>
          <span><Keys combo="Enter" /> Run</span>
          <span><Keys combo="Esc" /> {query ? 'Clear' : 'Close'}</span>
        </div>
        <div className="sr-only" role="status" aria-live="polite">
          {note || (query.trim() ? `${count} result${count === 1 ? '' : 's'}` : '')}
        </div>
      </div>
    </div>
  );
}

function inputBlur() {
  const a = document.activeElement as HTMLElement | null;
  if (a?.classList.contains('cmdk-input')) a.blur();
}

/** Mounted once in App; renders the palette while it is open and returns focus when it closes. */
export function CommandPalette() {
  const [open, setOpen] = useState(paletteOpen());
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(
    () =>
      onPalette((o) => {
        if (o) returnTo.current = document.activeElement as HTMLElement | null;
        setOpen(o);
      }),
    [],
  );
  const close = () => {
    closePalette();
    const el = returnTo.current;
    returnTo.current = null;
    // restore now, before the command runs, so it sees the same focus as from the menu
    if (el && el.isConnected && el !== document.body) el.focus({ preventScroll: true });
    else inputBlur();
  };
  if (!open) return null;
  return <Palette onClose={close} />;
}
