import type { ReactNode } from 'react';
import { Icon } from '../Icons';

/**
 * Teaching empty state (UX gap list "Empty states", MOBBIN #8): a 20px glyph in
 * text-3, one title line, one line that says what lives here, and the obvious
 * next actions as ghost buttons. No illustration, left-aligned.
 */
export function EmptyState({ icon, title, children, actions, footnote, className }: { icon: string; title: string; children?: ReactNode; actions?: ReactNode; footnote?: ReactNode; className?: string }) {
  return (
    <div className={`empty-state${className ? ' ' + className : ''}`} role="note" aria-label={title}>
      <span className="empty-state-icon" aria-hidden="true"><Icon name={icon} /></span>
      <p className="empty-state-title">{title}</p>
      {children && <p className="empty-state-body">{children}</p>}
      {actions && <div className="empty-state-actions">{actions}</div>}
      {footnote && <p className="empty-state-foot">{footnote}</p>}
    </div>
  );
}
