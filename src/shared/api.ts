/** Contract between the renderer and the main process (exposed by preload as window.quvrelo). */
import type { Policy, UpdateChannel } from '../core/policy';
import type { OnboardingState } from '../core/onboarding';

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
  /**
   * @deprecated No longer read: lengths show in each document's own unit
   * (settings.unit, set by its preset, Document setup or the status bar). Kept so
   * older settings files still parse.
   */
  units: 'px' | 'mm' | 'cm' | 'in' | 'pt';
  showRulers: boolean;
  snapping: boolean;
  reduceMotion: boolean;
  dyslexiaFriendlyUi: boolean;
  lastStudio: 'photo' | 'vector' | 'layout';
  /** Download updates in the background (Preferences ▸ General). Policy "autoDownload" overrides. */
  autoDownloadUpdates: boolean;
  /** Update channel. Policy "updateChannel" overrides. */
  updateChannel: UpdateChannel;
  /** Floating actions next to the canvas selection (Preferences ▸ Canvas). */
  showSelectionToolbar: boolean;
  /** First-run checklist progress (Welcome ▸ Get started). Policy "disableOnboarding" hides it. */
  onboarding?: OnboardingState;
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
  autoDownloadUpdates: true,
  updateChannel: 'stable',
  showSelectionToolbar: true,
};

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  electron: string;
  policySource: string | null;
  policyWarnings: string[];
  userDataPath: string;
  /** The user's home folder, so paths can be shown as "~/…". */
  homePath: string;
  e2e: boolean;
}

export interface ExternalTemplate {
  name: string;
  path: string;
  folder: string;
}

export type UpdateStatus =
  | 'idle' // nothing checked yet
  | 'disabled' // policy, portable, dev build...
  | 'checking'
  | 'available' // found; not downloading (notify-only installs, or automatic download off)
  | 'downloading'
  | 'ready' // downloaded and verified (sha512); restart to install
  | 'up-to-date'
  | 'error';

export interface UpdateState {
  status: UpdateStatus;
  current: string;
  latest: string | null;
  releaseName: string | null;
  /** Plain text (HTML from the feed is reduced to text in the main process). */
  releaseNotes: string | null;
  releaseDate: string | null;
  channel: UpdateChannel;
  /** 'auto' = installs itself; 'notify' = tells you and links to the download; 'disabled'. */
  mode: 'auto' | 'notify' | 'disabled';
  /** What the primary button does once an update is found. */
  action: 'restart' | 'open-download' | 'package-manager' | 'none';
  /** How Quvrelo was installed (nsis, msi, mac, appimage, deb, rpm, flatpak, ...). */
  installKind: string;
  /** Why updates are off, or why this install cannot update itself. */
  note: string | null;
  progress: { percent: number; transferred: number; total: number; bytesPerSecond: number } | null;
  error: string | null;
  /** Download page / package URL for notify-only installs. */
  downloadUrl: string | null;
  /** Package-manager command (deb/rpm/flatpak). */
  command: string | null;
  feedLabel: string;
  autoDownload: boolean;
  autoInstallOnQuit: boolean;
  locks: { autoDownload: boolean; autoInstall: boolean; channel: boolean };
  checkedAt: string | null;
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
  /** Write several files into one folder the user picks (export slices). Resolves with the folder, or null when cancelled. */
  saveFilesToFolder(opts: { files: { name: string; data: Uint8Array }[]; title?: string; folder?: string | null }): Promise<string | null>;

  getRecent(): Promise<RecentFile[]>;
  addRecent(path: string): Promise<void>;
  clearRecent(): Promise<void>;

  writeRecovery(entry: RecoveryEntry, data: Uint8Array): Promise<void>;
  listRecovery(): Promise<RecoveryEntry[]>;
  readRecovery(id: string): Promise<Uint8Array | null>;
  deleteRecovery(id: string): Promise<void>;

  listExternalTemplates(): Promise<ExternalTemplate[]>;
  handIn(opts: { data: Uint8Array; fileName: string; className: string; studentName: string }): Promise<string>;

  /** Manual check (Help ▸ Check for Updates). Resolves with the state after the check. */
  checkForUpdates(): Promise<UpdateState>;
  getUpdateState(): Promise<UpdateState>;
  /** Start the download when automatic download is off. */
  downloadUpdate(): Promise<UpdateState>;
  /** Restart and install. Goes through the normal close path, so unsaved work prompts first. */
  restartToUpdate(): void;
  /** Open the release page / package for installs that cannot update themselves. */
  openUpdateDownload(): Promise<void>;
  onUpdateState(cb: (s: UpdateState) => void): () => void;
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
