import { allMenuCommands } from '../../shared/menu';

/**
 * Accessible name + tooltip props for icon-only buttons (DESIGN.md §9):
 * aria-label is the plain name, the tooltip (title) is the name plus its
 * shortcut, and aria-keyshortcuts exposes the shortcut to assistive tech.
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

/**
 * Props for an icon-only button. `shortcut` is either a command id from the app
 * menu (its accelerator is looked up) or a literal key such as 'V' or 'PageUp'.
 */
export function tip(label: string, shortcut?: string): { 'aria-label': string; title: string; 'aria-keyshortcuts'?: string } {
  let display: string | undefined;
  let aria: string | undefined;
  if (shortcut && accels.has(shortcut)) {
    display = formatAccel(accels.get(shortcut)!);
    aria = ariaKeys(accels.get(shortcut)!);
  } else if (shortcut && !shortcut.includes('.')) {
    display = shortcut;
    aria = shortcut;
  }
  return { 'aria-label': label, title: display ? `${label} (${display})` : label, ...(aria ? { 'aria-keyshortcuts': aria } : {}) };
}
