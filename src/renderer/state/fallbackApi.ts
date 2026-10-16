/**
 * Browser fallback for window.quvrelo so the renderer can run outside Electron
 * (component development, browser-based tests). Uses file inputs and downloads.
 */
import { DEFAULT_POLICY } from '../../core/policy';
import { DEFAULT_SETTINGS, type QuvreloApi, type OpenedFile, type UpdateState, type UserSettings } from '../../shared/api';

const browserUpdateState: UpdateState = {
  status: 'disabled', current: 'dev', latest: null, releaseName: null, releaseNotes: null, releaseDate: null,
  channel: 'stable', mode: 'disabled', action: 'none', installKind: 'browser', note: 'Updates are not available in the browser.',
  progress: null, error: null, downloadUrl: null, command: null, feedLabel: '', autoDownload: false, autoInstallOnQuit: false,
  locks: { autoDownload: false, autoInstall: false, channel: false }, checkedAt: null,
};

export function browserFallbackApi(): QuvreloApi {
  const settingsKey = 'quvrelo.settings';
  const loadSettings = (): UserSettings => ({ ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(settingsKey) || '{}') });
  const pick = (accept: string, multi: boolean): Promise<OpenedFile[]> =>
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = multi;
      input.onchange = async () => {
        const files = [...(input.files ?? [])];
        resolve(await Promise.all(files.map(async (f) => ({ path: f.name, name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))));
      };
      input.click();
    });
  return {
    getPolicy: async () => DEFAULT_POLICY,
    getAppInfo: async () => ({ version: 'dev', platform: 'browser', arch: '', electron: '', policySource: null, policyWarnings: [], userDataPath: '', homePath: '', e2e: false }),
    getSettings: async () => loadSettings(),
    setSettings: async (s) => {
      const next = { ...loadSettings(), ...s };
      localStorage.setItem(settingsKey, JSON.stringify(next));
      return next;
    },
    openFileDialog: async (o) => pick(o.filters.flatMap((f) => f.extensions.map((e) => '.' + e)).join(','), !!o.multi),
    readFile: async () => {
      throw new Error('Not available in the browser');
    },
    saveFile: async (o) => {
      const blob = new Blob([o.data as BlobPart]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = o.defaultName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return o.defaultName;
    },
    saveFilesToFolder: async (o) => {
      // browser preview: each file downloads on its own
      for (const f of o.files) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([f.data as BlobPart]));
        a.download = f.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
      return 'Downloads';
    },
    getRecent: async () => [],
    addRecent: async () => undefined,
    clearRecent: async () => undefined,
    writeRecovery: async () => undefined,
    listRecovery: async () => [],
    readRecovery: async () => null,
    deleteRecovery: async () => undefined,
    listExternalTemplates: async () => [],
    handIn: async () => {
      throw new Error('Hand-in requires the desktop app');
    },
    checkForUpdates: async () => browserUpdateState,
    getUpdateState: async () => browserUpdateState,
    downloadUpdate: async () => browserUpdateState,
    restartToUpdate: () => undefined,
    openUpdateDownload: async () => undefined,
    onUpdateState: () => () => undefined,
    openExternal: async (u) => void window.open(u, '_blank'),
    showItemInFolder: async () => undefined,
    nativeEdit: (a) => void document.execCommand(a),
    setDirty: () => undefined,
    setTitle: (t) => void (document.title = t),
    quitNow: () => undefined,
    onMenuCommand: () => () => undefined,
    onOpenPath: () => () => undefined,
  };
}
