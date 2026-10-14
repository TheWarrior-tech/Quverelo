import { useEffect, useRef, useSyncExternalStore } from 'react';
import { editor } from '../state/editor';

/** Re-render whenever the editor changes. */
export function useEditor() {
  useSyncExternalStore(editor.subscribe, editor.getVersion);
  return editor;
}

/** Run fn at most once per animation frame for rapidly changing values. */
export function useRafThrottle<T extends unknown[]>(fn: (...args: T) => void) {
  const ref = useRef<{ args: T | null; raf: number }>({ args: null, raf: 0 });
  useEffect(() => () => cancelAnimationFrame(ref.current.raf), []);
  return (...args: T) => {
    ref.current.args = args;
    if (ref.current.raf) return;
    ref.current.raf = requestAnimationFrame(() => {
      ref.current.raf = 0;
      if (ref.current.args) fn(...ref.current.args);
    });
  };
}
