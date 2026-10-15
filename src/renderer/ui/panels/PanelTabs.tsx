import { useRef } from 'react';

export type Tab = { id: string; label: string; render: () => JSX.Element; flush?: boolean };

/**
 * Panel tab strip (DESIGN.md §8 v3): text tabs, active = primary text on a
 * press-tone tile, no underline. Arrow keys / Home / End move and select.
 */
export function PanelTabs({ tabs, active, onSelect, label, groupId }: { tabs: Tab[]; active: string; onSelect: (id: string) => void; label: string; groupId: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(0, tabs.findIndex((t) => t.id === active));
  return (
    <div className="panel-tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => (refs.current[i] = el)}
          type="button"
          role="tab"
          id={`${groupId}-tab-${t.id}`}
          aria-selected={t.id === active}
          aria-controls={`${groupId}-body`}
          tabIndex={i === idx ? 0 : -1}
          className={t.id === active ? 'active' : ''}
          onClick={() => onSelect(t.id)}
          onKeyDown={(e) => {
            const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : d ? (i + d + tabs.length) % tabs.length : -1;
            if (n < 0) return;
            e.preventDefault();
            onSelect(tabs[n].id);
            refs.current[n]?.focus();
          }}
          data-panel={t.id}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Remember the active tab per studio for a rail. */
export function loadTab(key: string, studio: string, fallback: string): string {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}');
    return typeof v[studio] === 'string' ? v[studio] : fallback;
  } catch {
    return fallback;
  }
}
export function saveTab(key: string, studio: string, tab: string): void {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(key, JSON.stringify({ ...v, [studio]: tab }));
  } catch {
    /* storage unavailable */
  }
}
