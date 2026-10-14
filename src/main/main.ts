import { app, BrowserWindow, dialog, ipcMain, Menu, shell, session, type MenuItemConstructorOptions } from 'electron';
import { promises as fs, existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DEFAULT_POLICY, featureEnabled, isSavePathAllowed, parsePolicy, type Policy, type PolicyResult } from '../core/policy';
import { APP_MENU } from '../shared/menu';
import {
  DEFAULT_SETTINGS, type AppInfo, type ExternalTemplate, type FileFilter, type OpenedFile, type RecentFile,
  type RecoveryEntry, type UpdateInfo, type UserSettings,
} from '../shared/api';

const E2E = process.env.QUVRELO_E2E === '1';
const REPO = 'TheWarrior-tech/Quverelo';

if (process.env.QUVRELO_USER_DATA) app.setPath('userData', process.env.QUVRELO_USER_DATA);

// ---------------------------------------------------------------------------
// Policy

export function policyPath(): string {
  if (process.env.QUVRELO_POLICY_PATH) return process.env.QUVRELO_POLICY_PATH;
  if (process.platform === 'win32') {
    return path.join(process.env.ProgramData || 'C:\\ProgramData', 'Quvrelo', 'policy.json');
  }
  if (process.platform === 'darwin') return '/Library/Application Support/Quvrelo/policy.json';
  return '/etc/quvrelo/policy.json';
}

function loadPolicy(): PolicyResult {
  const p = policyPath();
  try {
    if (!existsSync(p)) return { policy: { ...DEFAULT_POLICY }, warnings: [], source: null };
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    return parsePolicy(raw, p);
  } catch (e) {
    return { policy: { ...DEFAULT_POLICY }, warnings: [`Could not read ${p}: ${(e as Error).message}`], source: p };
  }
}

const policyResult = loadPolicy();
const policy: Policy = policyResult.policy;

function expandPath(p: string): string {
  let s = p;
  const docs = app.getPath('documents');
  s = s.replace(/%DOCUMENTS%/gi, docs).replace(/%USERPROFILE%/gi, os.homedir()).replace(/%USERNAME%/gi, os.userInfo().username);
  s = s.replace(/%([A-Z0-9_]+)%/gi, (m, v) => process.env[v] ?? m);
  if (s.startsWith('~')) s = path.join(os.homedir(), s.slice(1));
  s = s.replace(/\$\{?USER\}?/g, os.userInfo().username);
  return path.resolve(s);
}

function defaultDir(): string {
  if (policy.defaultSaveDirectory) {
    const d = expandPath(policy.defaultSaveDirectory);
    return d;
  }
  return app.getPath('documents');
}

const caseInsensitiveFs = process.platform === 'win32' || process.platform === 'darwin';

// ---------------------------------------------------------------------------
// Persistent JSON helpers

const userFile = (name: string) => path.join(app.getPath('userData'), name);

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(userFile(name), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(name: string, value: unknown): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  const target = userFile(name);
  const tmp = target + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, target);
}

async function getSettings(): Promise<UserSettings> {
  const s = { ...DEFAULT_SETTINGS, ...(await readJson<Partial<UserSettings>>('settings.json', {})) };
  if (policy.forceTheme) s.theme = policy.forceTheme;
  if (policy.lockUiScale) s.uiScale = policy.uiScale;
  return s;
}

// ---------------------------------------------------------------------------
// Window

let win: BrowserWindow | null = null;
let dirty = false;
let quitting = false;
const pendingOpen: string[] = [];

function fileArgs(argv: string[]): string[] {
  return argv.slice(1).filter((a) => /\.(quvrelo|easel|png|jpe?g|webp|svg)$/i.test(a) && existsSync(a));
}

async function createWindow() {
  const settings = await getSettings();
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: settings.theme === 'light' ? '#eef0f3' : '#1e1f22',
    title: 'Quvrelo',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      zoomFactor: settings.uiScale || policy.uiScale || 1,
    },
  });

  win.once('ready-to-show', () => {
    if (!process.env.QUVRELO_HIDDEN) win?.show();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (featureEnabled(policy, 'external-links') && /^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('close', async (e) => {
    if (quitting || !dirty || E2E) return;
    e.preventDefault();
    const r = await dialog.showMessageBox(win!, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Do you want to save your changes?',
      detail: 'Your changes will be lost if you do not save them. Autosave keeps a recovery copy.',
    });
    if (r.response === 0) win?.webContents.send('menu:command', 'file.save-and-quit');
    else if (r.response === 1) {
      quitting = true;
      win?.close();
    }
  });
  win.on('closed', () => {
    win = null;
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) await win.loadURL(devUrl);
  else await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  for (const f of pendingOpen.splice(0)) win.webContents.send('file:open-path', f);
}

function buildMenu() {
  const send = (id: string) => () => win?.webContents.send('menu:command', id);
  const sections: MenuItemConstructorOptions[] = APP_MENU.map((section) => ({
    label: section.label,
    submenu: section.items
      .filter((i) => i === '-' || !i.feature || featureEnabled(policy, i.feature))
      .filter((i) => !(i !== '-' && i.id === 'help.check-updates' && policy.disableUpdateCheck))
      .map((i): MenuItemConstructorOptions =>
        i === '-'
          ? { type: 'separator' }
          : {
              label: i.label,
              accelerator: i.accel,
              click: i.id === 'view.devtools' ? () => win?.webContents.toggleDevTools() : send(i.id),
            },
      ),
  }));
  if (process.platform === 'darwin') {
    sections.unshift({
      label: 'Quvrelo',
      submenu: [
        { label: 'About Quvrelo', click: send('help.about') },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'Cmd+,', click: send('app.preferences') },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(sections));
}

// ---------------------------------------------------------------------------
// IPC

function registerIpc() {
  ipcMain.handle('policy:get', () => policy);
  ipcMain.handle('app:info', (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    policySource: policyResult.source,
    policyWarnings: policyResult.warnings,
    userDataPath: app.getPath('userData'),
    e2e: E2E,
  }));
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:set', async (_e, patch: Partial<UserSettings>) => {
    const cur = await readJson<Partial<UserSettings>>('settings.json', {});
    const next = { ...cur, ...patch };
    await writeJson('settings.json', next);
    const s = await getSettings();
    if (win && patch.uiScale) win.webContents.setZoomFactor(s.uiScale);
    return s;
  });

  ipcMain.handle('file:open-dialog', async (_e, opts: { filters: FileFilter[]; multi?: boolean; title?: string }): Promise<OpenedFile[]> => {
    if (!win) return [];
    let paths: string[];
    if (E2E && process.env.QUVRELO_E2E_OPEN) paths = process.env.QUVRELO_E2E_OPEN.split(path.delimiter);
    else {
      const r = await dialog.showOpenDialog(win, {
        title: opts.title,
        defaultPath: defaultDir(),
        filters: opts.filters,
        properties: opts.multi ? ['openFile', 'multiSelections'] : ['openFile'],
      });
      if (r.canceled) return [];
      paths = r.filePaths;
    }
    return Promise.all(paths.map(readFileResult));
  });
  ipcMain.handle('file:read', (_e, p: string) => readFileResult(p));
  ipcMain.handle('file:save', async (_e, opts: { path: string | null; data: Uint8Array; defaultName: string; filters: FileFilter[]; title?: string }) => {
    if (!win) return null;
    let target = opts.path;
    if (target && !isSavePathAllowed(policy, target, expandPath, caseInsensitiveFs)) target = null;
    if (!target) {
      if (E2E && process.env.QUVRELO_E2E_SAVE_DIR) target = path.join(process.env.QUVRELO_E2E_SAVE_DIR, opts.defaultName);
      else {
        for (;;) {
          const r = await dialog.showSaveDialog(win, {
            title: opts.title,
            defaultPath: path.join(defaultDir(), opts.defaultName),
            filters: opts.filters,
          });
          if (r.canceled || !r.filePath) return null;
          if (isSavePathAllowed(policy, r.filePath, expandPath, caseInsensitiveFs)) {
            target = r.filePath;
            break;
          }
          await dialog.showMessageBox(win, {
            type: 'info',
            message: 'Save location restricted',
            detail: `Your administrator requires work to be saved in:\n${expandPath(policy.defaultSaveDirectory!)}`,
          });
        }
      }
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = target + '.quvrelo-tmp';
    await fs.writeFile(tmp, Buffer.from(opts.data));
    await fs.rename(tmp, target);
    return target;
  });

  ipcMain.handle('recent:get', async () => {
    if (!featureEnabled(policy, 'recent-files')) return [];
    const list = await readJson<RecentFile[]>('recent.json', []);
    return list.filter((r) => existsSync(r.path));
  });
  ipcMain.handle('recent:add', async (_e, p: string) => {
    if (!featureEnabled(policy, 'recent-files')) return;
    const list = (await readJson<RecentFile[]>('recent.json', [])).filter((r) => r.path !== p);
    list.unshift({ path: p, name: path.basename(p), openedAt: new Date().toISOString() });
    await writeJson('recent.json', list.slice(0, 15));
    if (process.platform !== 'linux') app.addRecentDocument(p);
  });
  ipcMain.handle('recent:clear', () => writeJson('recent.json', []));

  const recoveryDir = () => path.join(app.getPath('userData'), 'recovery');
  const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '');
  ipcMain.handle('recovery:write', async (_e, entry: RecoveryEntry, data: Uint8Array) => {
    await fs.mkdir(recoveryDir(), { recursive: true });
    const id = safeId(entry.id);
    await fs.writeFile(path.join(recoveryDir(), id + '.quvrelo.tmp'), Buffer.from(data));
    await fs.rename(path.join(recoveryDir(), id + '.quvrelo.tmp'), path.join(recoveryDir(), id + '.quvrelo'));
    await fs.writeFile(path.join(recoveryDir(), id + '.json'), JSON.stringify({ ...entry, id }));
  });
  ipcMain.handle('recovery:list', async () => {
    try {
      const files = await fs.readdir(recoveryDir());
      const out: RecoveryEntry[] = [];
      for (const f of files.filter((x) => x.endsWith('.json'))) {
        try {
          const e = JSON.parse(await fs.readFile(path.join(recoveryDir(), f), 'utf8')) as RecoveryEntry;
          if (existsSync(path.join(recoveryDir(), safeId(e.id) + '.quvrelo'))) out.push(e);
        } catch {
          /* ignore damaged entry */
        }
      }
      return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    } catch {
      return [];
    }
  });
  ipcMain.handle('recovery:read', async (_e, id: string) => {
    try {
      return new Uint8Array(await fs.readFile(path.join(recoveryDir(), safeId(id) + '.quvrelo')));
    } catch {
      return null;
    }
  });
  ipcMain.handle('recovery:delete', async (_e, id: string) => {
    await fs.rm(path.join(recoveryDir(), safeId(id) + '.quvrelo'), { force: true });
    await fs.rm(path.join(recoveryDir(), safeId(id) + '.json'), { force: true });
  });

  ipcMain.handle('templates:external', async (): Promise<ExternalTemplate[]> => {
    const out: ExternalTemplate[] = [];
    for (const dir of policy.templateDirectories) {
      const d = expandPath(dir);
      try {
        for (const f of await fs.readdir(d)) {
          if (/\.(quvrelo|easel)$/i.test(f)) out.push({ name: f.replace(/\.(quvrelo|easel)$/i, ''), path: path.join(d, f), folder: path.basename(d) });
        }
      } catch {
        /* folder unavailable (e.g. network offline) */
      }
    }
    return out;
  });

  ipcMain.handle('handin:submit', async (_e, o: { data: Uint8Array; fileName: string; className: string; studentName: string }) => {
    if (!featureEnabled(policy, 'assignments')) throw new Error('Assignments are disabled by your administrator');
    let root: string;
    if (policy.handInDirectory) root = expandPath(policy.handInDirectory);
    else if (E2E && process.env.QUVRELO_E2E_SAVE_DIR) root = path.join(process.env.QUVRELO_E2E_SAVE_DIR, 'handin');
    else {
      const r = await dialog.showOpenDialog(win!, { title: 'Choose the hand-in folder', defaultPath: defaultDir(), properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) throw new Error('Hand-in cancelled');
      root = r.filePaths[0];
    }
    const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Unnamed';
    const dir = path.join(root, clean(o.className));
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const target = path.join(dir, `${clean(o.studentName)} - ${clean(o.fileName)} - ${stamp}.quvrelo`);
    await fs.writeFile(target, Buffer.from(o.data));
    return target;
  });

  ipcMain.handle('update:check', async (): Promise<UpdateInfo> => {
    const current = app.getVersion();
    if (policy.disableUpdateCheck || !featureEnabled(policy, 'update-check')) {
      return { current, latest: null, url: null, newer: false, error: 'Update checks are disabled by your administrator.' };
    }
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { tag_name: string; html_url: string };
      const latest = j.tag_name.replace(/^v/, '');
      return { current, latest, url: j.html_url, newer: compareVersions(latest, current) > 0 };
    } catch (e) {
      return { current, latest: null, url: null, newer: false, error: (e as Error).message };
    }
  });
  ipcMain.handle('shell:open-external', (_e, url: string) => {
    if (featureEnabled(policy, 'external-links') && /^https?:\/\//.test(url)) return shell.openExternal(url);
  });
  ipcMain.handle('shell:show-item', (_e, p: string) => shell.showItemInFolder(p));
  ipcMain.on('edit:native', (_e, action: string) => {
    const wc = win?.webContents;
    if (!wc) return;
    switch (action) {
      case 'undo': wc.undo(); break;
      case 'redo': wc.redo(); break;
      case 'cut': wc.cut(); break;
      case 'copy': wc.copy(); break;
      case 'paste': wc.paste(); break;
      case 'selectAll': wc.selectAll(); break;
    }
  });
  ipcMain.on('doc:dirty', (_e, d: boolean) => {
    dirty = d;
    win?.setDocumentEdited(d);
  });
  ipcMain.on('doc:title', (_e, t: string) => win?.setTitle(t));
  ipcMain.on('app:quit-now', () => {
    quitting = true;
    win?.close();
  });
}

async function readFileResult(p: string): Promise<OpenedFile> {
  const data = await fs.readFile(p);
  return { path: p, name: path.basename(p), data: new Uint8Array(data) };
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Lifecycle

if (!E2E && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    for (const f of fileArgs(argv)) win?.webContents.send('file:open-path', f);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.on('open-file', (e, p) => {
    e.preventDefault();
    if (win) win.webContents.send('file:open-path', p);
    else pendingOpen.push(p);
  });
  pendingOpen.push(...fileArgs(process.argv));

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
      const allowed = ['clipboard-read', 'clipboard-sanitized-write', 'local-fonts', 'fullscreen'];
      const name = String(permission);
      cb(allowed.includes(name) && (name !== 'local-fonts' || featureEnabled(policy, 'local-fonts')));
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
      ['clipboard-read', 'clipboard-sanitized-write', 'local-fonts'].includes(permission as string),
    );
    // Offline by design: block every remote request from the renderer.
    session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
      const u = details.url;
      const local = u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('devtools:') ||
        (process.env.VITE_DEV_SERVER_URL && u.startsWith(process.env.VITE_DEV_SERVER_URL)) || u.startsWith('ws://localhost');
      cb({ cancel: !local });
    });
    registerIpc();
    buildMenu();
    await createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    if (!dirty) quitting = true;
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || E2E) app.quit();
  });
}
