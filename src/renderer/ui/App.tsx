import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { editor } from '../state/editor';
import { handleKeydown, runCommand } from '../state/commands';
import { hookTitle, openPath, startAutosave } from '../state/io';
import { onToast, type Toast } from '../state/bus';
import { startUpdates } from '../state/updates';
import { useEditor } from './hooks';
import { Welcome } from './Welcome';
import { Workspace } from './Workspace';
import { DialogHost } from './dialogs/DialogHost';

function applyAppearance() {
  const s = editor.settings;
  const root = document.documentElement;
  let theme = editor.policy.forceTheme ?? s.theme;
  if (theme === 'system') theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  root.dataset.theme = theme;
  root.dataset.dyslexia = String(!!s.dyslexiaFriendlyUi);
  root.dataset.reduceMotion = String(!!s.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** How long a toast stays up (ms). Errors get a little longer to be read. */
export const TOAST_MS = 3000;
const TOAST_ERROR_MS = 5000;
/** Toasts that offer an action ("Restart") stay long enough to reach with the pointer. */
const TOAST_ACTION_MS = 10000;

function ToastItem({ t, onDismiss }: { t: Toast; onDismiss: (id: number) => void }) {
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (hover) return; // pause while the pointer is on it
    const ms = t.duration ?? (t.action ? TOAST_ACTION_MS : t.kind === 'error' ? TOAST_ERROR_MS : TOAST_MS);
    const h = window.setTimeout(() => onDismiss(t.id), ms);
    return () => window.clearTimeout(h);
  }, [hover, t.id]);
  return (
    <div className={`toast ${t.kind}${t.action ? ' has-action' : ''}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span className="toast-msg">{t.message}</span>
      {t.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            onDismiss(t.id);
            t.action!.run();
          }}
        >
          {t.action.label}
        </button>
      )}
    </div>
  );
}

/**
 * Toasts sit bottom-centre over the canvas (never over the panels or rail),
 * or bottom-centre of the window when no document is open.
 */
function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number; maxWidth: number } | null>(null);
  useLayoutEffect(() => {
    if (!toasts.length) return;
    const place = () => {
      const area = document.querySelector('.canvas-area')?.getBoundingClientRect();
      const root = document.documentElement.getBoundingClientRect();
      if (area && area.width > 0) setPos({ left: area.left + area.width / 2, bottom: root.height - area.bottom + 16, maxWidth: Math.max(160, area.width - 32) });
      else setPos({ left: root.width / 2, bottom: 40, maxWidth: root.width - 32 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [toasts]);
  return (
    <div className="toasts" role="status" aria-live="polite" ref={ref} style={pos ? { left: pos.left, bottom: pos.bottom, maxWidth: pos.maxWidth } : undefined}>
      {toasts.map((t) => <ToastItem key={t.id} t={t} onDismiss={onDismiss} />)}
    </div>
  );
}

export function App() {
  const ed = useEditor();
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    hookTitle();
    startAutosave();
    const offUpdates = startUpdates();
    const offMenu = window.quvrelo.onMenuCommand((id) => void runCommand(id));
    const offOpen = window.quvrelo.onOpenPath((p) => void openPath(p));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && editor.session && !(e.target as HTMLElement)?.closest('input,textarea,select,button,[role="tab"],.panels,.dialog')) {
        e.preventDefault();
        document.querySelector('.workspace')?.classList.toggle('hide-panels');
        return;
      }
      if (editor.session && handleKeydown(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    const offToast = onToast((t) => setToasts((list) => [...list.slice(-2), t]));
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      const io = await import('../state/io');
      const loaded = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
      if (!editor.session || /\.(quvrelo|easel)$/i.test(loaded[0].name)) await io.openFileData(loaded[0].data, loaded[0].name, null);
      else await io.placeImages(loaded);
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onDragOver);
    // test hook: lets end-to-end tests drive commands and inspect state
    (window as unknown as { __quvrelo: unknown }).__quvrelo = { editor, runCommand };
    return () => {
      offMenu();
      offOpen();
      offToast();
      offUpdates();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onDragOver);
    };
  }, []);

  useEffect(applyAppearance);

  return (
    <>
      {ed.session ? <Workspace /> : <Welcome />}
      <DialogHost />
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((list) => list.filter((x) => x.id !== id))} />
    </>
  );
}
