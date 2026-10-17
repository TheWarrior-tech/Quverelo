/**
 * Over-the-air updates. Main process only.
 *
 * - Checks 30 s after launch and every 6 h, downloads in the background, verifies
 *   the sha512 from latest*.yml (and, on macOS, the code signature), then offers
 *   "Restart to update"; otherwise installs when the app quits where that needs no
 *   administrator prompt.
 * - Checking always goes through electron-updater (MIT): its GitHub / generic providers
 *   read the channel file (latest*.yml / beta*.yml) with the same channel, prerelease
 *   and no-downgrade rules everywhere.
 * - Downloading and installing: electron-updater for NSIS, AppImage and Developer ID
 *   signed macOS; Quvrelo's own installers for ad-hoc signed macOS (macInstall.ts),
 *   MSI (msiInstall.ts) and deb/rpm/pacman (linuxPackage.ts), sharing files.ts.
 * - Feed: GitHub Releases of RELEASES_REPO (config.ts), policy "updateRepository", or
 *   the policy's updateFeedUrl (generic provider). No token is ever embedded.
 * - Platform behaviour: see strategy.ts.
 */
import { app, session, shell } from 'electron';
import { execFile, spawn } from 'node:child_process';
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
import {
  archMatches, cleanupPending, downloadVerified, expectedArtifactName, expectedHashFor, parseSha256Sums, pickUpdateFile,
  preparePendingDir, resolveFileUrl, type FeedFile, type FetchLike,
} from './files';
import { backupPathFor, execCmd, launchMacSwap, needsAdmin, stageMacUpdate, type Exec } from './macInstall';
import { launchMsiInstall } from './msiInstall';
import { describeInstallFailure, elevate, installCommand, runInstall, which, type PackageKind } from './linuxPackage';

export const FIRST_CHECK_DELAY_MS = 30_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const BUNDLE_ID = 'com.quvrelo.app';

/** Side effects of Quvrelo's own installers; replaced in unit tests. */
export interface InstallDeps {
  fetch: FetchLike;
  /** Pending downloads live in `<pendingRoot>/<version>/`. */
  pendingRoot: string;
  arch: string;
  pid: number;
  execPath: string;
  /** macOS: the running .app bundle. */
  macBundle: string | null;
  exec: Exec;
  spawn: typeof spawn;
  which: (cmd: string) => string | null;
  runInstall: (argv: string[]) => Promise<{ code: number; stderr: string }>;
  isRoot: boolean;
  needsAdmin: (target: string) => boolean;
  quit(): void;
  relaunch(): void;
}

function defaultDeps(): InstallDeps {
  let ses: Electron.Session | null = null;
  const bundle = process.platform === 'darwin' ? path.resolve(process.execPath, '..', '..', '..') : null;
  return {
    // Its own session: the default session's offline request filter (main.ts) is for the UI only,
    // and Electron's network stack honours the system proxy and certificate store (school networks).
    fetch: (url, init) => {
      ses ??= session.fromPartition('quvrelo-updater', { cache: false });
      return ses.fetch(url, init) as unknown as ReturnType<FetchLike>;
    },
    pendingRoot: path.join(app.getPath('userData'), 'pending-update'),
    arch: process.arch,
    pid: process.pid,
    execPath: process.execPath,
    macBundle: bundle,
    exec: execCmd,
    spawn,
    which: (c) => which(c),
    runInstall,
    isRoot: typeof process.getuid === 'function' && process.getuid() === 0,
    needsAdmin,
    quit: () => app.quit(),
    relaunch: () => app.relaunch(),
  };
}

interface PendingInstall {
  version: string;
  dir: string;
  file: string;
  /** macOS: the verified, unpacked .app */
  staged: string | null;
}

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
    facts.macBundlePath = bundle;
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
  const dl = /^HttpError: (\d{3}) downloading/.exec(m);
  if (dl) return `The update could not be downloaded (the server answered ${dl[1]}). Quvrelo will try again later.`;
  if (/ERR_UPDATER_LATEST_VERSION_NOT_FOUND|ERR_UPDATER_NO_PUBLISHED_VERSIONS|ERR_UPDATER_INVALID_RELEASE_FEED|HttpError: 404|status code 404|\b404\b/i.test(m)) {
    return 'No published update was found on the update server.';
  }
  if (/ERR_UPDATER_CHANNEL_FILE_NOT_FOUND/i.test(m)) return 'The update server has no update information for this platform.';
  if (/sha512 checksum mismatch|sha256 checksum mismatch|ERR_CHECKSUM_MISMATCH/i.test(m)) return 'The downloaded update failed its integrity check and was discarded.';
  if (/failed its code signature check/i.test(m)) return 'The downloaded update failed its code signature check and was discarded.';
  if (/not signed|code signature|signature/i.test(m)) return 'The downloaded update is not signed by the expected publisher and was discarded.';
  if (/ENOSPC/i.test(m)) return 'There is not enough disk space to download the update.';
  return m.split('\n')[0].slice(0, 200);
}

export class UpdateService {
  private updater: AppUpdater | null = null;
  private strategy: UpdateStrategy | null = null;
  private cfg: UpdaterConfig | null = null;
  private timer: NodeJS.Timeout | null = null;
  private firstTimer: NodeJS.Timeout | null = null;
  private installRequested = false;
  private deps: InstallDeps | null = null;
  private lastInfo: UpdateInfo | null = null;
  private pending: PendingInstall | null = null;
  private customDownloading = false;
  /** deb/rpm: the package is installed; quitting relaunches into it. */
  private packageInstalled = false;
  /** The helper for this session's update has been started (never twice). */
  private helperLaunched = false;
  state: UpdateState;

  constructor(private host: UpdaterHost, private depsOverride: Partial<InstallDeps> = {}) {
    this.state = {
      status: 'idle', current: app.getVersion(), latest: null, releaseName: null, releaseNotes: null, releaseDate: null,
      channel: 'stable', mode: 'disabled', action: 'none', installKind: 'dev', note: null, progress: null, error: null,
      downloadUrl: null, command: null, feedLabel: 'GitHub Releases', autoDownload: true, autoInstallOnQuit: true, adminPrompt: false,
      locks: { autoDownload: false, autoInstall: false, channel: false }, checkedAt: null,
    };
  }

  private get d(): InstallDeps {
    this.deps ??= { ...defaultDeps(), ...this.depsOverride };
    return this.deps;
  }

  private get custom(): boolean {
    const i = this.strategy?.installer;
    return i === 'mac-swap' || i === 'msi' || i === 'linux-package';
  }

  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    this.host.broadcast(this.state);
  }

  /** `facts` is for tests; normally gathered from the running app. */
  async init(facts?: PlatformFacts): Promise<void> {
    this.strategy = selectStrategy(facts ?? (await gatherFacts()));
    await this.configure();
    if (this.custom && this.state.mode === 'auto') {
      await cleanupPending(this.d.pendingRoot, this.state.current).catch((e) => console.warn('[updater] cleanup', e));
    }
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
      // Quvrelo's own installers use electron-updater to check only, never to download or install.
      const eu = mode === 'auto' && s.installer === 'electron-updater';
      u.autoDownload = eu && cfg.autoDownload;
      u.autoInstallOnAppQuit = eu && cfg.autoInstallOnAppQuit;
      u.disableDifferentialDownload = !s.differential;
      u.fullChangelog = false;
      // check-only use never downloads through electron-updater, so let the check run
      // even where the updater class would refuse (Flatpak, tarballs, dev builds).
      u.forceDevUpdateConfig = !eu;
    }
    const adminPrompt = mode === 'auto' && (s.installer === 'msi' || s.installer === 'linux-package' || (s.installer === 'mac-swap' && this.macNeedsAdmin()));
    // Installing on quit: never with an administrator prompt nobody asked for.
    const autoInstallOnQuit = mode === 'auto' && cfg.autoInstallOnAppQuit && (s.installer === 'electron-updater' || (s.installer === 'mac-swap' && !adminPrompt));
    const resetFound = channelChanged && !['downloading', 'ready'].includes(this.state.status);
    this.set({
      mode,
      action: mode === 'disabled' ? 'none' : s.action,
      installKind: s.kind,
      note,
      channel: cfg.channel,
      feedLabel: cfg.feedLabel,
      autoDownload: mode === 'auto' && cfg.autoDownload,
      autoInstallOnQuit,
      adminPrompt,
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
      this.lastInfo = info;
      const ownDownload = this.custom && this.state.mode === 'auto' && this.state.autoDownload;
      const downloading = this.state.mode === 'auto' && (u.autoDownload || ownDownload);
      this.set({
        status: downloading ? 'downloading' : 'available',
        progress: downloading ? { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 } : null,
        ...this.describe(info),
      });
      if (ownDownload) void this.customDownload(info);
    });
    u.on('update-not-available', (info: UpdateInfo) => {
      this.set({ status: 'up-to-date', latest: info?.version ?? null, releaseNotes: null, releaseName: null, checkedAt: new Date().toISOString() });
    });
    u.on('download-progress', (p: ProgressInfo) => {
      this.set({ status: 'downloading', progress: { percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond } });
    });
    u.on('update-downloaded', (info: UpdateInfo) => {
      this.set({ status: 'ready', progress: null, ...this.describe(info) });
    });
    u.on('error', (e: Error) => {
      // Quvrelo's own download reports its own errors; don't let a stray updater error hide a ready update.
      if (this.custom && (this.customDownloading || this.state.status === 'ready' || this.state.status === 'installing')) return;
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
    const file = candidates.find((f) => archMatches(f.url, process.arch)) ?? candidates[0];
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
      // the copy-paste command is only for installs Quvrelo cannot install itself (Flatpak, Snap)
      command: s.mode === 'auto' ? null : packageCommand(s.kind, fileName, process.env.FLATPAK_ID || 'com.quvrelo.app'),
      checkedAt: new Date().toISOString(),
      error: null,
    };
  }

  /** Manual or scheduled check. Never restarts a download or discards a ready update. */
  async check(manual: boolean): Promise<UpdateState> {
    const u = this.updater;
    if (!u || this.state.mode === 'disabled') return this.state;
    if (['downloading', 'ready', 'installing'].includes(this.state.status) || this.customDownloading) return this.state;
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
    if (this.custom) {
      if (this.lastInfo) void this.customDownload(this.lastInfo);
      return this.state;
    }
    u.downloadUpdate().catch((e) => this.set({ status: 'error', error: friendlyUpdateError(e), progress: null }));
    return this.state;
  }

  /** Absolute URL of a file the feed lists (electron-updater's provider resolves GitHub release paths). */
  private fileUrl(info: UpdateInfo, file: FeedFile): string {
    type Resolved = { url: URL; info: { url: string } };
    const iap = (this.updater as unknown as { updateInfoAndProvider?: { info: UpdateInfo; provider: { resolveFiles(i: UpdateInfo): Resolved[] } } } | null)?.updateInfoAndProvider;
    if (iap?.info?.version === info.version) {
      try {
        const hit = iap.provider.resolveFiles(iap.info).find((r) => r.info.url === file.url);
        if (hit) return hit.url.toString();
        // a file the .yml does not list (MSI checked via SHA256SUMS): same folder as the listed ones
        const any = iap.provider.resolveFiles(iap.info)[0];
        if (any) return resolveFileUrl(encodeURIComponent(file.url), any.url.toString());
      } catch {
        /* fall back to the feed layout below */
      }
    }
    const feed = this.cfg!.feed;
    if (/^https?:\/\//i.test(file.url)) return file.url;
    if (feed.provider === 'generic') return resolveFileUrl(file.url, feed.url);
    return `https://github.com/${feed.owner}/${feed.repo}/releases/download/v${info.version}/${encodeURIComponent(file.url)}`;
  }

  /** Download + verify (+ on macOS unpack and check the signature) for Quvrelo's own installers. */
  private async customDownload(info: UpdateInfo): Promise<void> {
    if (this.customDownloading) return;
    if (this.pending?.version === info.version) {
      this.set({ status: 'ready', progress: null, ...this.describe(info) });
      return;
    }
    this.customDownloading = true;
    const s = this.strategy!;
    const d = this.d;
    try {
      const ext = packageExtension(s.kind, process.platform, s.installer)!;
      const listed = pickUpdateFile((info.files ?? []) as FeedFile[], ext, d.arch);
      const guessed = expectedArtifactName(ext, info.version, d.arch);
      const file: FeedFile | null = listed ?? (guessed ? { url: guessed } : null);
      if (!file) throw new Error(`The update server has no .${ext} package for this computer (${d.arch}).`);
      const url = this.fileUrl(info, file);
      let expected = expectedHashFor(file, null);
      if (!expected) {
        // not in latest*.yml (MSI before CI lists it): the release's SHA256SUMS.txt
        const sumsUrl = resolveFileUrl('SHA256SUMS.txt', url);
        const res = await d.fetch(sumsUrl);
        if (res.ok) expected = expectedHashFor(file, parseSha256Sums(await res.text()));
      }
      if (!expected) throw new Error(`The update server publishes no checksum for ${file.url}, so it was not downloaded.`);
      const dir = await preparePendingDir(d.pendingRoot, info.version);
      const dest = path.join(dir, path.basename(decodeURIComponent(file.url.split('?')[0])));
      await downloadVerified({
        url, dest, expected, fetch: d.fetch, size: file.size,
        onProgress: (p) => this.set({ status: 'downloading', progress: p }),
      });
      let staged: string | null = null;
      if (s.installer === 'mac-swap') {
        staged = await stageMacUpdate({ zip: dest, stageDir: path.join(dir, 'staged'), bundleId: BUNDLE_ID, version: info.version, exec: d.exec });
      }
      this.pending = { version: info.version, dir, file: dest, staged };
      this.set({ status: 'ready', progress: null, adminPrompt: this.computeAdminPrompt(), ...this.describe(info) });
    } catch (e) {
      console.error('[updater] download failed', e);
      this.set({ status: 'error', error: friendlyUpdateError(e), progress: null, checkedAt: new Date().toISOString() });
    } finally {
      this.customDownloading = false;
    }
  }

  private macNeedsAdmin(): boolean {
    const b = this.depsOverride.macBundle !== undefined ? this.depsOverride.macBundle : this.strategy?.installer === 'mac-swap' ? this.d.macBundle : null;
    return !!b && (this.depsOverride.needsAdmin ?? needsAdmin)(b);
  }

  private computeAdminPrompt(): boolean {
    const i = this.strategy?.installer;
    return i === 'msi' || i === 'linux-package' || (i === 'mac-swap' && this.macNeedsAdmin());
  }

  /** Step 1 of "Restart now": close windows through the normal path (unsaved work prompts first). */
  restart(): void {
    if (this.state.status !== 'ready' || this.state.mode !== 'auto') return;
    if (this.strategy?.installer === 'linux-package') {
      void this.installLinuxPackage();
      return;
    }
    this.installRequested = true;
    this.host.requestQuitForUpdate();
  }

  /** deb/rpm/pacman: install now (the app keeps running), then restart into the new version. */
  private async installLinuxPackage(): Promise<void> {
    const p = this.pending;
    const kind = this.strategy!.kind as PackageKind;
    if (!p) return;
    const d = this.d;
    const cmd = installCommand(kind, p.file, d.which);
    const argv = cmd ? elevate(cmd, d.which('pkexec'), d.isRoot) : null;
    if (!argv) {
      this.set({
        error: `Quvrelo could not ask for administrator permission on this system. Install the downloaded package from a terminal: ${packageCommand(kind, p.file) ?? p.file}`,
        command: packageCommand(kind, p.file),
      });
      return;
    }
    this.set({ status: 'installing', error: null });
    const r = await d.runInstall(argv);
    if (r.code !== 0) {
      console.error('[updater] package install failed', r.code, r.stderr);
      this.set({ status: 'ready', error: describeInstallFailure(r.code, r.stderr) });
      return;
    }
    this.packageInstalled = true;
    this.installRequested = true;
    this.host.requestQuitForUpdate();
  }

  /** The close was cancelled (user chose Cancel in the save prompt). */
  cancelRestart(): void {
    this.installRequested = false;
    if (this.packageInstalled) {
      // already installed; it is used the next time Quvrelo starts
      this.set({ status: 'ready', note: 'The update is installed and takes effect the next time Quvrelo starts.' });
    }
  }

  get wantsInstall(): boolean {
    return this.installRequested && (this.state.status === 'ready' || this.packageInstalled);
  }

  /** Step 2: every window is closed and work is saved; hand over to the installer. Synchronous: the app is quitting. */
  installNow(): void {
    const s = this.strategy;
    if (!s) return;
    try {
      switch (s.installer) {
        case 'mac-swap':
          if (!this.launchMacHelper(true)) return;
          this.d.quit();
          return;
        case 'msi':
          if (!this.launchMsiHelper()) return;
          this.d.quit();
          return;
        case 'linux-package':
          if (!this.packageInstalled) return;
          this.d.relaunch();
          this.d.quit();
          return;
        default:
          // isSilent: NSIS updates in place without the wizard; isForceRunAfter: reopen Quvrelo.
          this.updater?.quitAndInstall(true, true);
      }
    } catch (e) {
      console.error('[updater] could not start the installer', e);
      this.d.quit();
    }
  }

  /**
   * The app is quitting without "Restart": install a ready update where that needs no
   * administrator prompt (electron-updater handles its own installs on quit).
   */
  onQuit(): void {
    if (this.helperLaunched || this.installRequested) return;
    if (this.strategy?.installer !== 'mac-swap' || this.state.status !== 'ready' || !this.state.autoInstallOnQuit) return;
    if (this.macNeedsAdmin()) return;
    try {
      this.launchMacHelper(false);
    } catch (e) {
      console.error('[updater] install on quit failed to start', e);
    }
  }

  private launchMacHelper(relaunch: boolean): boolean {
    const p = this.pending;
    const d = this.d;
    if (!p?.staged || !d.macBundle || this.helperLaunched) return false;
    this.helperLaunched = true;
    launchMacSwap(
      {
        pid: d.pid, source: p.staged, target: d.macBundle, backup: backupPathFor(d.macBundle), log: path.join(path.dirname(p.dir), 'update.log'),
        relaunch, admin: d.needsAdmin(d.macBundle), pendingDir: p.dir,
      },
      p.dir,
      d.spawn,
    );
    return true;
  }

  private launchMsiHelper(): boolean {
    const p = this.pending;
    const d = this.d;
    if (!p || this.helperLaunched) return false;
    this.helperLaunched = true;
    launchMsiInstall(
      { pid: d.pid, msi: p.file, exe: d.execPath, log: path.join(path.dirname(p.dir), 'update.log'), msiLog: path.join(path.dirname(p.dir), 'msiexec.log'), relaunch: true, pendingDir: p.dir },
      p.dir,
      d.spawn,
    );
    return true;
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
