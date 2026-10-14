import { useEffect, useState } from 'react';
import { editor } from '../state/editor';
import { handleKeydown, runCommand } from '../state/commands';
import { hookTitle, openPath, startAutosave } from '../state/io';
import { onToast, type Toast } from '../state/bus';
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

export function App() {
  const ed = useEditor();
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    hookTitle();
    startAutosave();
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
    const offToast = onToast((t) => {
      setToasts((list) => [...list, t]);
      window.setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), t.kind === 'error' ? 6000 : 3200);
    });
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
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </>
  );
}
