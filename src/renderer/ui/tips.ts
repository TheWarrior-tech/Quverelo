import { allMenuCommands } from '../../shared/menu';

/**
 * Accessible name + tooltip props for icon-only buttons (DESIGN.md §9):
 * aria-label is the plain name, the tooltip (data-tip, drawn by ui/Tooltip.tsx)
 * is the name plus its shortcut as keycaps, and aria-keyshortcuts exposes the
 * shortcut to assistive tech.
 */
const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
const accels = new Map(allMenuCommands().filter((c) => c.accel).map((c) => [c.id, c.accel!]));

/** Electron accelerator ('CmdOrCtrl+Shift+Z') to display text ('Ctrl+Shift+Z' / '⇧⌘Z'). */
export function formatAccel(accel: string): string {
  if (!isMac) return accel.replace('CmdOrCtrl', 'Ctrl');
  const parts = accel.split('+');
  const key = parts.pop()!;
  const mods = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', CmdOrCtrl: '⌘', Cmd: '⌘' } as Record<string, string>;
  return parts.map((p) => mods[p] ?? p).join('') + key;
}

/** Electron accelerator to the aria-keyshortcuts syntax ('Control+Shift+Z'). */
function ariaKeys(accel: string): string {
  return accel
    .split('+')
    .map((p) => (p === 'CmdOrCtrl' || p === 'Cmd' ? (isMac ? 'Meta' : 'Control') : p === 'Ctrl' ? 'Control' : p))
    .join('+');
}

export function shortcutFor(commandId: string): string | undefined {
  const a = accels.get(commandId);
  return a ? formatAccel(a) : undefined;
}

export interface TipProps {
  'aria-label': string;
  /** Tooltip text, rendered by ui/Tooltip.tsx (never the native `title`). */
  'data-tip': string;
  /** Shortcut shown as keycaps in the tooltip: an Electron accelerator or a literal key. */
  'data-keys'?: string;
  'aria-keyshortcuts'?: string;
}

/** The accelerator for a menu command id, if it has one. */
export function accelFor(commandId: string): string | undefined {
  return accels.get(commandId);
}

/**
 * Props for an icon-only button. `shortcut` is either a command id from the app
 * menu (its accelerator is looked up) or a literal key such as 'V' or 'PageUp'.
 * The tooltip shows the name plus the shortcut as keycaps (ui/Tooltip.tsx).
 */
export function tip(label: string, shortcut?: string): TipProps {
  let keys: string | undefined;
  let aria: string | undefined;
  if (shortcut && accels.has(shortcut)) {
    keys = accels.get(shortcut)!;
    aria = ariaKeys(keys);
  } else if (shortcut && !shortcut.includes('.')) {
    // literal key ('V', 'PageUp') or accelerator ('Shift+M')
    keys = shortcut;
    aria = ariaKeys(shortcut);
  }
  return { 'aria-label': label, 'data-tip': label, ...(keys ? { 'data-keys': keys } : {}), ...(aria ? { 'aria-keyshortcuts': aria } : {}) };
}

/** Tooltip text with the shortcut in prose ("Undo (Ctrl+Z)"), for places that can only take a string. */
export function tipText(label: string, shortcut?: string): string {
  const t = tip(label, shortcut);
  return t['data-keys'] ? `${label} (${formatAccel(t['data-keys'])})` : label;
}

// ---------------------------------------------------------------------------
// Tooltip placement (pure; used by ui/Tooltip.tsx and unit-tested)

export type TipSide = 'top' | 'bottom' | 'left' | 'right';
const GAP = 6;
const EDGE = 8;

/** Place the tooltip box next to the trigger rect, flipping and clamping to stay on screen. */
export function placeTip(r: { left: number; top: number; right: number; bottom: number; width: number; height: number }, size: { w: number; h: number }, vw: number, vh: number, side: TipSide): { x: number; y: number; side: TipSide } {
  const fits = (s: TipSide) =>
    s === 'bottom' ? r.bottom + GAP + size.h <= vh - EDGE
    : s === 'top' ? r.top - GAP - size.h >= EDGE
    : s === 'right' ? r.right + GAP + size.w <= vw - EDGE
    : r.left - GAP - size.w >= EDGE;
  const opposite: Record<TipSide, TipSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const s = fits(side) || !fits(opposite[side]) ? side : opposite[side];
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  if (s === 'top' || s === 'bottom') {
    const x = clamp(r.left + r.width / 2 - size.w / 2, EDGE, vw - EDGE - size.w);
    return { x, y: s === 'bottom' ? r.bottom + GAP : r.top - GAP - size.h, side: s };
  }
  const y = clamp(r.top + r.height / 2 - size.h / 2, EDGE, vh - EDGE - size.h);
  return { x: s === 'right' ? r.right + GAP : r.left - GAP - size.w, y, side: s };
}

