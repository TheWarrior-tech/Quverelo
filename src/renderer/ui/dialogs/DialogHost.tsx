import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../Icons';
import { closeDialog, onDialog, type DialogName } from '../../state/bus';
import { NewDocumentDialog } from './NewDocumentDialog';
import { ExportDialog } from './ExportDialog';
import { DocumentSetupDialog, ResizeDialog } from './DocumentDialogs';
import { AboutDialog, GuideDialog, PreferencesDialog, ShortcutsDialog } from './AppDialogs';
import { AssignmentDialog, HandInDialog } from './AssignmentDialogs';

export function Dialog({ title, children, footer, wide, onClose }: { title: string; children: ReactNode; footer?: ReactNode; wide?: boolean; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = onClose ?? closeDialog;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button.primary, button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
      if (e.key === 'Tab' && ref.current) {
        // trap focus inside the dialog
        const items = [...ref.current.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
        if (!items.length) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          items[items.length - 1].focus();
        } else if (!e.shiftKey && i === items.length - 1) {
          e.preventDefault();
          items[0].focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} onKeyDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn sm" aria-label="Close" onClick={close}><Icon name="close" /></button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

interface ConfirmAction {
  label: string;
  primary?: boolean;
  run: () => void | Promise<void>;
}

function ConfirmDialog({ title, message, actions }: { title: string; message: string; actions: ConfirmAction[] }) {
  return (
    <Dialog
      title={title}
      footer={actions.map((a) => (
        <button key={a.label} className={`btn ${a.primary ? 'primary' : ''}`} onClick={async () => { closeDialog(); await a.run(); }}>
          {a.label}
        </button>
      ))}
    >
      <p>{message}</p>
    </Dialog>
  );
}

export function DialogHost() {
  const [state, setState] = useState<{ name: DialogName; props?: Record<string, unknown> } | null>(null);
  useEffect(() => onDialog((name, props) => setState(name ? { name, props } : null)), []);
  if (!state) return null;
  const p = state.props ?? {};
  switch (state.name) {
    case 'new': return <NewDocumentDialog />;
    case 'export': return <ExportDialog format={(p.format as 'png') ?? 'png'} />;
    case 'document-setup': return <DocumentSetupDialog />;
    case 'resize': return <ResizeDialog />;
    case 'preferences': return <PreferencesDialog />;
    case 'shortcuts': return <ShortcutsDialog />;
    case 'guide': return <GuideDialog />;
    case 'about': return <AboutDialog />;
    case 'assignment': return <AssignmentDialog />;
    case 'hand-in': return <HandInDialog />;
    case 'confirm': return <ConfirmDialog title={String(p.title)} message={String(p.message)} actions={p.actions as ConfirmAction[]} />;
    default: return null;
  }
}
