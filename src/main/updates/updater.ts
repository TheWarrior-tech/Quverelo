/**
 * Over-the-air updates (electron-updater, MIT). Main process only.
 *
 * - Checks 30 s after launch and every 4 h, downloads in the background, verifies
 *   the sha512 from latest*.yml (and, on Windows/macOS, the code signature), then
 *   offers "Restart to update"; otherwise installs when the app quits.
 * - Feed: GitHub Releases (TheWarrior-tech/Quverelo) or the policy's updateFeedUrl
 *   (generic provider). No token is ever embedded: a private repository cannot be
 *   read by clients.
 * - Platform behaviour: see strategy.ts.
 */
import { app, shell } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  AppImageUpdater, DebUpdater, MacUpdater, NsisUpdater, RpmUpdater, PacmanUpdater,
  type AppUpdater, type ProgressInfo, type UpdateInfo,
} from 'electron-updater';
import type { Policy } from '../../core/policy';
import type { UpdateState } from '../../shared/api';
import { releaseNotesToText, resolveUpdaterConfig, type UpdatePrefs, type UpdaterConfig } from './config';
import { packageCommand, packageExtension, isDeveloperIdSigned, selectStrategy, type PlatformFacts, type UpdateStrategy } from './strategy';

export const FIRST_CHECK_DELAY_MS = 30_000;
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export interface UpdaterHost {
  policy: Policy;
  getPrefs(): Promise<UpdatePrefs>;
  /** Push state to the renderer. */
  broadcast(state: UpdateState): void;
  /** Close the window through the normal path (unsaved-changes prompt), then call back to install. */
  requestQuitForUpdate(): void;
  e2e: boolean;
}

function runCodesign(appBundle: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('codesign', ['-dv', '--verbose=2', appBundle], { timeout: 10_000 }, (_err, stdout, stderr) => resolve(`${stdout}\n${stderr}`));
  });
}

async function gatherFacts(): Promise<PlatformFacts> {
  const facts: PlatformFacts = {
    platform: process.platform,
    isPackaged: app.isPackaged,
    env: process.env,
    packageType: null,
    nsisUninstallerPresent: false,
    mas: !!process.mas,
    macSigned: null,
    forceCheck: process.env.QUVRELO_UPDATER_FORCE === '1',
  };
  try {
    const pt = path.join(process.resourcesPath, 'package-type');
    if (existsSync(pt)) facts.packageType = readFileSync(pt, 'utf8').trim();
  } catch {
    /* not a deb/rpm install */
  }
  if (process.platform === 'win32') {
    facts.nsisUninstallerPresent = existsSync(path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`));
  }
  if (process.platform === 'darwin' && app.isPackaged) {
    // .../Quvrelo.app/Contents/MacOS/Quvrelo -> .../Quvrelo.app
    const bundle = path.resolve(process.execPath, '..', '..', '..');
    facts.macSigned = isDeveloperIdSigned(await runCodesign(bundle));
  }
  return facts;
}

function createUpdater(s: UpdateStrategy): AppUpdater {
  switch (s.kind) {
    case 'nsis':
    case 'msi':
    case 'portable':
      return new NsisUpdater();
    case 'mac':
    case 'mas':
      return new MacUpdater();
    case 'deb':
      return new DebUpdater();
    case 'rpm':
      return new RpmUpdater();
    case 'pacman':
      return new PacmanUpdater();
    default:
      if (process.platform === 'win32') return new NsisUpdater();
      if (process.platform === 'darwin') return new MacUpdater();
      return new AppImageUpdater();
  }
}

/** Short, human error text; the raw message goes to the log. */
export function friendlyUpdateError(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ECONNREFUSED|ETIMEDOUT|ERR_CONNECTION/i.test(m)) {
    return 'Could not reach the update server. Quvrelo will try again later.';
  }
  if (/ERR_UPDATER_LATEST_VERSION_NOT_FOUND|ERR_UPDATER_NO_PUBLISHED_VERSIONS|ERR_UPDATER_INVALID_RELEASE_FEED|HttpError: 404|status code 404|\b404\b/i.test(m)) {
    return 'No published update was found on the update server.';
  }
  if (/ERR_UPDATER_CHANNEL_FILE_NOT_FOUND/i.test(m)) return 'The update server has no update information for this platform.';
  if (/sha512 checksum mismatch|ERR_CHECKSUM_MISMATCH/i.test(m)) return 'The downloaded update failed its integrity check and was discarded.';
  if (/not signed|code signature|signature/i.test(m)) return 'The downloaded update is not signed by the expected publisher and was discarded.';
  return m.split('\n')[0].slice(0, 200);
}

export class UpdateService {
  private updater: AppUpdater | null = null;
  private strategy: UpdateStrategy | null = null;
  private cfg: UpdaterConfig | null = null;
  private timer: NodeJS.Timeout | null = null;
  private firstTimer: NodeJS.Timeout | null = null;
  private info: UpdateInfo | null = null;
  private installRequested = false;
  state: UpdateState;

  constructor(private host: UpdaterHost) {
    this.state = {
      status: 'idle', current: app.getVersion(), latest: null, releaseName: null, releaseNotes: null, releaseDate: null,
      channel: 'stable', mode: 'disabled', action: 'none', installKind: 'dev', note: null, progress: null, error: null,
      downloadUrl: null, command: null, feedLabel: 'GitHub Releases', autoDownload: true, autoInstallOnQuit: true,
      locks: { autoDownload: false, autoInstall: false, channel: false }, checkedAt: null,
    };
  }

  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    this.host.broadcast(this.state);
  }

  /** `facts` is for tests; normally gathered from the running app. */
  async init(facts?: PlatformFacts): Promise<void> {
    this.strategy = selectStrategy(facts ?? (await gatherFacts()));
    await this.configure();
    if (this.state.mode === 'disabled' || this.host.e2e) return;
    this.firstTimer = setTimeout(() => void this.check(false), FIRST_CHECK_DELAY_MS);
    this.timer = setInterval(() => void this.check(false), CHECK_INTERVAL_MS);
    this.firstTimer.unref?.();
    this.timer.unref?.();
  }

  /** (Re)apply policy + preferences. Called at start and when Preferences change. */
  async configure(): Promise<void> {
    const s = this.strategy!;
    const cfg = resolveUpdaterConfig(this.host.policy, await this.host.getPrefs());
    const channelChanged = this.cfg !== null && this.cfg.channel !== cfg.channel;
    this.cfg = cfg;
    const mode = cfg.enabled ? s.mode : 'disabled';
    const note = cfg.enabled ? s.note : cfg.disabledReason;

    if (mode !== 'disabled' && !this.updater) this.updater = this.wire(createUpdater(s));
    const u = this.updater;
    if (u) {
      u.setFeedURL(cfg.feed);
      u.channel = cfg.updaterChannel;
      u.allowPrerelease = cfg.allowPrerelease;
      u.allowDowngrade = false; // setting `channel` turns it on; never offer an older build
      u.autoDownload = mode === 'auto' && cfg.autoDownload;
      u.autoInstallOnAppQuit = mode === 'auto' && cfg.autoInstallOnAppQuit;
      u.disableDifferentialDownload = !s.differential;
      u.fullChangelog = false;
      // check-only installs never download through electron-updater, so let the check run
      // even where the updater class would refuse (Flatpak, tarballs, dev builds).
      u.forceDevUpdateConfig = mode === 'notify';
    }
    const resetFound = channelChanged && !['downloading', 'ready'].includes(this.state.status);
    this.set({
      mode,
      action: mode === 'disabled' ? 'none' : s.action,
      installKind: s.kind,
      note,
      channel: cfg.channel,
      feedLabel: cfg.feedLabel,
      autoDownload: mode === 'auto' && cfg.autoDownload,
      autoInstallOnQuit: mode === 'auto' && cfg.autoInstallOnAppQuit,
      locks: cfg.locks,
      ...(mode === 'disabled' ? { status: 'disabled' as const } : this.state.status === 'disabled' ? { status: 'idle' as const } : {}),
      ...(resetFound ? { status: 'idle' as const, latest: null, releaseNotes: null, releaseName: null } : {}),
    });
  }

  private wire(u: AppUpdater): AppUpdater {
    u.logger = {
      info: (m: unknown) => console.log('[updater]', m),
      warn: (m: unknown) => console.warn('[updater]', m),
      error: (m: unknown) => console.error('[updater]', m),
      debug: () => undefined,
    };
    u.on('checking-for-update', () => this.set({ status: 'checking', error: null }));
    u.on('update-available', (info: UpdateInfo) => {
      this.info = info;
      const downloading = this.state.mode === 'auto' && u.autoDownload;
      this.set({
        status: downloading ? 'downloading' : 'available',
        progress: downloading ? { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 } : null,
        ...this.describe(info),
      });
    });
    u.on('update-not-available', (info: UpdateInfo) => {
      this.info = null;
      this.set({ status: 'up-to-date', latest: info?.version ?? null, releaseNotes: null, releaseName: null, checkedAt: new Date().toISOString() });
    });
    u.on('download-progress', (p: ProgressInfo) => {
      this.set({ status: 'downloading', progress: { percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond } });
    });
    u.on('update-downloaded', (info: UpdateInfo) => {
      this.set({ status: 'ready', progress: null, ...this.describe(info) });
    });
    u.on('error', (e: Error) => {
      // A failed background check is quiet (status in the dialog only); a failed download keeps any found version.
      this.set({ status: 'error', error: friendlyUpdateError(e), progress: null, checkedAt: new Date().toISOString() });
    });
    return u;
  }

  private describe(info: UpdateInfo): Partial<UpdateState> {
    const s = this.strategy!;
    const cfg = this.cfg!;
    const ext = packageExtension(s.kind, process.platform);
    const candidates = ext ? (info.files ?? []).filter((f) => f.url.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) : [];
    const file = candidates.find((f) => archMatches(f.url)) ?? candidates[0];
    let downloadUrl = cfg.downloadPage;
    if (cfg.feed.provider === 'github') downloadUrl = `${cfg.downloadPage}/tag/v${info.version}`;
    else if (file) downloadUrl = new URL(file.url, cfg.feed.url).toString();
    const fileName = file ? decodeURIComponent(file.url.split('/').pop()!) : null;
    return {
      latest: info.version,
      releaseName: typeof info.releaseName === 'string' ? info.releaseName : null,
      releaseNotes: releaseNotesToText(info.releaseNotes) || null,
      releaseDate: info.releaseDate ?? null,
      downloadUrl,
      command: packageCommand(s.kind, fileName, process.env.FLATPAK_ID || 'com.quvrelo.app'),
      checkedAt: new Date().toISOString(),
      error: null,
    };
  }

  /** Manual or scheduled check. Never restarts a download or discards a ready update. */
  async check(manual: boolean): Promise<UpdateState> {
    const u = this.updater;
    if (!u || this.state.mode === 'disabled') return this.state;
    if (this.state.status === 'downloading' || this.state.status === 'ready') return this.state;
    if (manual) this.set({ status: 'checking', error: null });
    try {
      const r = await u.checkForUpdates();
      if (!r) this.set({ status: 'up-to-date', checkedAt: new Date().toISOString() });
    } catch (e) {
      this.set({ status: 'error', error: friendlyUpdateError(e), checkedAt: new Date().toISOString() });
    }
    return this.state;
  }

  async download(): Promise<UpdateState> {
    const u = this.updater;
    if (!u || this.state.mode !== 'auto' || this.state.status !== 'available') return this.state;
    this.set({ status: 'downloading', progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 } });
    u.downloadUpdate().catch((e) => this.set({ status: 'error', error: friendlyUpdateError(e), progress: null }));
    return this.state;
  }

  /** Step 1 of "Restart now": close windows through the normal path (unsaved work prompts first). */
  restart(): void {
    if (this.state.status !== 'ready' || this.state.mode !== 'auto') return;
    this.installRequested = true;
    this.host.requestQuitForUpdate();
  }

  /** The close was cancelled (user chose Cancel in the save prompt). */
  cancelRestart(): void {
    this.installRequested = false;
  }

  get wantsInstall(): boolean {
    return this.installRequested && this.state.status === 'ready';
  }

  /** Step 2: every window is closed and work is saved; hand over to the installer. */
  installNow(): void {
    if (!this.updater) return;
    // isSilent: NSIS updates in place without the wizard; isForceRunAfter: reopen Quvrelo.
    this.updater.quitAndInstall(true, true);
  }

  async openDownload(): Promise<void> {
    const url = this.state.downloadUrl ?? this.cfg?.downloadPage;
    if (url && /^https?:\/\//.test(url)) await shell.openExternal(url);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.firstTimer) clearTimeout(this.firstTimer);
  }
}

function archMatches(url: string): boolean {
  const u = url.toLowerCase();
  const arm = /arm64|aarch64/.test(u);
  return process.arch === 'arm64' ? arm || !/x64|amd64|x86_64/.test(u) : !arm;
}
