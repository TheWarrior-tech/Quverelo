import type { ReactNode } from 'react';

/**
 * Context-bar hint (DESIGN.md §8, UX P1-5): one quiet line in text-3 that never
 * competes with controls. Truncates with an ellipsis, hides below 1280px wide;
 * the full text stays available as the tooltip.
 */
export function CtxHint({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="ctx-hint" data-tip={title ?? (typeof children === 'string' ? children : undefined)}>
      {children}
    </span>
  );
}
