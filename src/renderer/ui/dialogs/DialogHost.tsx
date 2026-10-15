import { tip } from '../tips';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../Icons';
import { closeDialog, onDialog, type DialogName } from '../../state/bus';
import { NewDocumentDialog } from './NewDocumentDialog';
import { ExportDialog } from './ExportDialog';
import { DocumentSetupDialog, ResizeDialog } from './DocumentDialogs';
import { AboutDialog, GuideDialog, PreferencesDialog, ShortcutsDialog } from './AppDialogs';
import { AssignmentDialog, HandInDialog } from './AssignmentDialogs';
import { UpdatesDialog } from './UpdatesDialog';
import { watchScrollRegions } from '../controls/Panel';
import './dialogs.css';

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (x) => !x.hasAttribute('disabled') && x.tabIndex !== -1 && x.getClientRects().length > 0,
  );
}

export interface DialogProps {
  title: string;
  children: ReactNode;
  /** Buttons, right-aligned; put the primary action last. */
  footer?: ReactNode;
  /** Content pinned to the left of the footer (status, estimates, a destructive action). */
  footerStart?: ReactNode;
  size?: DialogSize;
  /** @deprecated use size="xl" */
  wide?: boolean;
  /** Body without padding, laid out as columns (sidebar + content). */
  split?: boolean;
  /** Called on Enter when focus is in a text field (not a textarea, button or select). */
  onSubmit?: () => void;
  onClose?: () => void;
  /** Alert style: no header bar, title in the body, role="alertdialog". */
  alert?: ReactNode;
  className?: string;
}

/**
 * Modal shell shared by every dialog: dimmed backdrop, 48px header, hairline
 * footer with right-aligned actions. Esc closes, Enter submits, Tab is trapped
 * and focus returns to where it was.
 */
/** Scrolling regions that get the §6 scroll-edge shade. */
const SCROLL_REGIONS = '.dialog-body:not(.split), .dlg-side, .dlg-main, .dlg-aside';

export function Dialog({ title, children, footer, footerStart, size, wide, split, onSubmit, onClose, alert, className }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = onClose ?? closeDialog;
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const root = ref.current;
    const prev = document.activeElement as HTMLElement | null;
    if (root) {
      const pick =
        root.querySelector<HTMLElement>('[data-autofocus]') ??
        root.querySelector<HTMLElement>('.dialog-body input:not([type="checkbox"]):not([type="range"]):not([disabled]), .dialog-body textarea') ??
        root.querySelector<HTMLElement>('.dialog-footer .btn.primary:not([disabled])') ??
        focusables(root).find((x) => !x.closest('.dialog-header')) ??
        root;
      pick.focus();
      if (pick instanceof HTMLInputElement && pick.type === 'text') pick.select();
    }
    const onKey = (e: KeyboardEvent) => {
      const r = ref.current;
      if (!r) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key === 'Enter' && submitRef.current && !e.isComposing) {
        const t = e.target as HTMLElement;
        const field = t instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'color', 'button'].includes(t.type);
        if (field || t === r) {
          e.preventDefault();
          e.stopPropagation();
          if (t.getAttribute('role') === 'spinbutton') {
            // a number field commits on blur: let it, then submit with the committed value
            t.blur();
            window.setTimeout(() => submitRef.current?.(), 0);
            return;
          }
          submitRef.current();
          return;
        }
      }
      if (e.key === 'Tab') {
        const items = focusables(r);
        if (!items.length) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          items[items.length - 1].focus();
        } else if (!e.shiftKey && (i === items.length - 1 || i === -1)) {
          e.preventDefault();
          items[0].focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    const offEdges = root ? watchScrollRegions(root, SCROLL_REGIONS) : null;
    return () => {
      offEdges?.();
      window.removeEventListener('keydown', onKey, true);
      if (prev && document.contains(prev)) prev.focus?.();
    };
  }, []);

  const sz = size ?? (wide ? 'xl' : 'md');
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className={`dialog${className ? ` ${className}` : ''}`}
        data-size={sz}
        data-alert={alert ? '' : undefined}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={alert ? `${id}-d` : undefined}
        tabIndex={-1}
        ref={ref}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {alert ? (
          <div className="dialog-body alert-body">
            <h2 id={`${id}-t`}>{title}</h2>
            <div id={`${id}-d`}>{alert}</div>
            {children}
          </div>
        ) : (
          <>
            <header className="dialog-header">
              <h2 id={`${id}-t`}>{title}</h2>
              <button className="icon-btn" {...tip('Close', 'Escape')} onClick={close}>
                <Icon name="close" size={16} />
              </button>
            </header>
            <div className={`dialog-body${split ? ' split' : ''}`}>{children}</div>
          </>
        )}
        {(footer || footerStart) && (
          <footer className="dialog-footer">
            {footerStart && <div className="footer-start">{footerStart}</div>}
            <div className="footer-actions">{footer}</div>
          </footer>
        )}
      </div>
    </div>
  );
}

export interface ConfirmAction {
  label: string;
  primary?: boolean;
  /** Destructive choice (e.g. "Don't save"): shown on the left, in danger text. */
  destructive?: boolean;
  run: () => void | Promise<void>;
}

const isCancel = (a: ConfirmAction) => /^(cancel|later|not now)$/i.test(a.label);

export function ConfirmDialog({ title, message, actions }: { title: string; message: string; actions: ConfirmAction[] }) {
  const act = (a: ConfirmAction) => async () => {
    closeDialog();
    await a.run();
  };
  const destructive = actions.filter((a) => a.destructive || /^don.t\b/i.test(a.label));
  const rest = actions.filter((a) => !destructive.includes(a));
  // secondary actions first, primary last (right-most)
  const ordered = [...rest.filter((a) => !a.primary), ...rest.filter((a) => a.primary)];
  const primary = rest.find((a) => a.primary);
  const cancel = actions.find(isCancel);
  return (
    <Dialog
      title={title}
      size="sm"
      alert={<p className="alert-message">{message}</p>}
      onSubmit={primary ? act(primary) : undefined}
      onClose={cancel ? act(cancel) : closeDialog}
      footerStart={destructive.map((a) => (
        <button key={a.label} className="btn danger" onClick={act(a)}>{a.label}</button>
      ))}
      footer={ordered.map((a) => (
        <button key={a.label} className={`btn${a.primary ? ' primary' : ''}`} data-autofocus={a.primary ? '' : undefined} onClick={act(a)}>
          {a.label}
        </button>
      ))}
    >
      {null}
    </Dialog>
  );
}

export function DialogHost() {
  const [state, setState] = useState<{ name: DialogName; props?: Record<string, unknown>; key: number } | null>(null);
  useEffect(() => onDialog((name, props) => setState(name ? { name, props, key: Date.now() } : null)), []);
  if (!state) return null;
  const p = state.props ?? {};
  const k = state.key;
  switch (state.name) {
    case 'new': return <NewDocumentDialog key={k} category={p.category as never} preset={p.preset as string | undefined} />;
    case 'export': return <ExportDialog key={k} format={(p.format as 'png') ?? 'png'} />;
    case 'document-setup': return <DocumentSetupDialog key={k} />;
    case 'resize': return <ResizeDialog key={k} />;
    case 'preferences': return <PreferencesDialog key={k} />;
    case 'shortcuts': return <ShortcutsDialog key={k} />;
    case 'guide': return <GuideDialog key={k} />;
    case 'about': return <AboutDialog key={k} />;
    case 'assignment': return <AssignmentDialog key={k} />;
    case 'hand-in': return <HandInDialog key={k} />;
    case 'updates': return <UpdatesDialog key={k} />;
    case 'confirm': return <ConfirmDialog key={k} title={String(p.title)} message={String(p.message)} actions={p.actions as ConfirmAction[]} />;
    default: return null;
  }
}
