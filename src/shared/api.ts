/** Contract between the renderer and the main process (exposed by preload as window.quvrelo). */
import type { Policy } from '../core/policy';

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenedFile {
  path: string;
  name: string;
  data: Uint8Array;
}

export interface RecentFile {
  path: string;
  name: string;
  openedAt: string;
}

export interface RecoveryEntry {
  id: string;
  title: string;
  savedAt: string;
  originalPath: string | null;
}

export interface UserSettings {
  theme: 'dark' | 'light' | 'high-contrast' | 'system';
  uiScale: number;
  units: 'px' | 'mm' | 'cm' | 'in' | 'pt';
  showRulers: boolean;
  snapping: boolean;
  reduceMotion: boolean;
  dyslexiaFriendlyUi: boolean;
  lastStudio: 'photo' | 'vector' | 'layout';
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  uiScale: 1,
  units: 'px',
  showRulers: true,
  snapping: true,
  reduceMotion: false,
  dyslexiaFriendlyUi: false,
  lastStudio: 'vector',
};

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  electron: string;
  policySource: string | null;
  policyWarnings: string[];
  userDataPath: string;
  e2e: boolean;
}

export interface ExternalTemplate {
  name: string;
  path: string;
  folder: string;
}

export interface UpdateInfo {
  current: string;
  latest: string | null;
  url: string | null;
  newer: boolean;
  error?: string;
}

export interface QuvreloApi {
  getPolicy(): Promise<Policy>;
  getAppInfo(): Promise<AppInfo>;
  getSettings(): Promise<UserSettings>;
  setSettings(s: Partial<UserSettings>): Promise<UserSettings>;

  openFileDialog(opts: { filters: FileFilter[]; multi?: boolean; title?: string }): Promise<OpenedFile[]>;
  readFile(path: string): Promise<OpenedFile>;
  /** Writes data. Shows a save dialog when path is null. Returns the path written or null if cancelled. */
  saveFile(opts: { path: string | null; data: Uint8Array; defaultName: string; filters: FileFilter[]; title?: string }): Promise<string | null>;

  getRecent(): Promise<RecentFile[]>;
  addRecent(path: string): Promise<void>;
  clearRecent(): Promise<void>;

  writeRecovery(entry: RecoveryEntry, data: Uint8Array): Promise<void>;
  listRecovery(): Promise<RecoveryEntry[]>;
  readRecovery(id: string): Promise<Uint8Array | null>;
  deleteRecovery(id: string): Promise<void>;

  listExternalTemplates(): Promise<ExternalTemplate[]>;
  handIn(opts: { data: Uint8Array; fileName: string; className: string; studentName: string }): Promise<string>;

  checkForUpdates(): Promise<UpdateInfo>;
  openExternal(url: string): Promise<void>;
  showItemInFolder(path: string): Promise<void>;

  nativeEdit(action: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'): void;
  setDirty(dirty: boolean): void;
  setTitle(title: string): void;
  quitNow(): void;

  onMenuCommand(cb: (id: string) => void): () => void;
  onOpenPath(cb: (path: string) => void): () => void;
}

declare global {
  interface Window {
    quvrelo: QuvreloApi;
  }
}
