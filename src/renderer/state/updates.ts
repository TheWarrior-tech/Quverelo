/**
 * Renderer side of over-the-air updates: mirrors the main process UpdateState,
 * raises the "ready — Restart" toast once per version, and exposes a hook.
 */
import { useSyncExternalStore } from 'react';
import type { UpdateState } from '../../shared/api';
import { openDialog, toast } from './bus';

let state: UpdateState | null = null;
const listeners = new Set<() => void>();
let started = false;
let toastedReady: string | null = null;
let toastedAvailable: string | null = null;
/** True while the Updates dialog is open (it shows the state itself; no toast needed). */
let dialogOpen = false;

function emit() {
  for (const l of listeners) l();
}

function apply(next: UpdateState) {
  const prev = state;
  state = next;
  emit();
  if (dialogOpen) return;
  if (next.status === 'ready' && next.latest && toastedReady !== next.latest && prev?.status !== 'ready') {
    toastedReady = next.latest;
    toast(`Quvrelo ${next.latest} is ready`, 'info', { action: { label: 'Restart', run: () => restartToUpdate() } });
  } else if (next.status === 'available' && next.latest && toastedAvailable !== next.latest && next.mode === 'notify') {
    toastedAvailable = next.latest;
    toast(`Quvrelo ${next.latest} is available`, 'info', { action: { label: 'Details', run: () => openDialog('updates') } });
  }
}

export function startUpdates(): () => void {
  if (started) return () => undefined;
  started = true;
  const off = window.quvrelo.onUpdateState(apply);
  window.quvrelo
    .getUpdateState()
    .then((s) => {
      if (!state) {
        state = s;
        emit();
      }
    })
    .catch(() => undefined);
  return () => {
    off();
    started = false;
  };
}

export function getUpdateState(): UpdateState | null {
  return state;
}

export function useUpdateState(): UpdateState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function setUpdatesDialogOpen(open: boolean): void {
  dialogOpen = open;
  // a version first seen while the dialog was open shouldn't toast after it closes
  if (open && state?.latest) {
    if (state.status === 'ready') toastedReady = state.latest;
    if (state.status === 'available') toastedAvailable = state.latest;
  }
}

export async function checkForUpdates(): Promise<void> {
  try {
    apply(await window.quvrelo.checkForUpdates());
  } catch (e) {
    toast(`Update check failed: ${(e as Error).message}`, 'error');
  }
}

export async function downloadUpdate(): Promise<void> {
  apply(await window.quvrelo.downloadUpdate());
}

/** Goes through the normal close path in the main process, so unsaved work prompts first. */
export function restartToUpdate(): void {
  window.quvrelo.restartToUpdate();
}

export function openUpdateDownload(): Promise<void> {
  return window.quvrelo.openUpdateDownload();
}

/** One-line status for the status bar; null when there is nothing worth showing. */
export function statusLine(s: UpdateState | null): string | null {
  if (!s) return null;
  switch (s.status) {
    case 'downloading':
      return s.progress && s.progress.total > 0 ? `Downloading update ${Math.floor(s.progress.percent)}%` : 'Downloading update';
    case 'ready':
      return 'Restart to update';
    case 'installing':
      return 'Installing update';
    case 'available':
      return `Update available`;
    default:
      return null;
  }
}
