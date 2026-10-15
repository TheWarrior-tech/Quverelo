import { useSyncExternalStore } from 'react';
import { pushRecent } from './colorMath';

const KEY = 'quvrelo.recentColours';
const MAX = 12;
let list: string[] = load();
const listeners = new Set<() => void>();

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Remember a colour the user committed (picker gesture end, swatch click, eyedropper). */
export function addRecentColour(color: string): void {
  const next = pushRecent(list, color, MAX);
  if (next.join() === list.join()) return;
  list = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

export function useRecentColours(): string[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => list,
  );
}
