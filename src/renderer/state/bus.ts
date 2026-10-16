/** Tiny UI event bus: lets commands open dialogs and show toasts without importing React. */
export type DialogName =
  | 'new' | 'export' | 'document-setup' | 'resize' | 'preferences' | 'shortcuts' | 'guide' | 'about'
  | 'assignment' | 'hand-in' | 'confirm' | 'updates' | 'import-report' | 'script-editor';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
  /** One inline action ("Restart"). Toasts with an action stay up longer. */
  action?: { label: string; run: () => void };
  /** Override the auto-dismiss time (ms). */
  duration?: number;
}

type DialogListener = (name: DialogName | null, props?: Record<string, unknown>) => void;
type ToastListener = (t: Toast) => void;

const dialogListeners = new Set<DialogListener>();
const toastListeners = new Set<ToastListener>();
let toastId = 0;

export function openDialog(name: DialogName, props?: Record<string, unknown>): void {
  for (const l of dialogListeners) l(name, props);
}

export function closeDialog(): void {
  for (const l of dialogListeners) l(null);
}

export function onDialog(l: DialogListener): () => void {
  dialogListeners.add(l);
  return () => dialogListeners.delete(l);
}

export function toast(message: string, kind: Toast['kind'] = 'info', extra: Pick<Toast, 'action' | 'duration'> = {}): void {
  const t: Toast = { id: ++toastId, message, kind, ...extra };
  for (const l of toastListeners) l(t);
}

export function onToast(l: ToastListener): () => void {
  toastListeners.add(l);
  return () => toastListeners.delete(l);
}

// Inspector tab requests (View › Scripts opens the Scripts tab)
type TabListener = (id: string) => void;
const tabListeners = new Set<TabListener>();
export function showInspectorTab(id: string): void {
  for (const l of tabListeners) l(id);
}
export function onInspectorTab(l: TabListener): () => void {
  tabListeners.add(l);
  return () => tabListeners.delete(l);
}
