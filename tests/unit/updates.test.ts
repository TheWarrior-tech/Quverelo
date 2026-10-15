import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY, parsePolicy, type Policy } from '../../src/core/policy';
import { GITHUB_FEED, releaseNotesToText, resolveUpdaterConfig, type UpdatePrefs } from '../../src/main/updates/config';
import {
  detectInstallKind, isDeveloperIdSigned, packageCommand, selectStrategy, type PlatformFacts,
} from '../../src/main/updates/strategy';

// ---------------------------------------------------------------------------
// electron + electron-updater mocks (only used by the UpdateService tests)

const created: FakeUpdater[] = [];

class FakeUpdater {
  kind: string;
  handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  feed: unknown = null;
  channel: string | null = null;
  allowPrerelease = false;
  allowDowngrade = false;
  autoDownload = true;
  autoInstallOnAppQuit = true;
  disableDifferentialDownload = false;
  fullChangelog = false;
  forceDevUpdateConfig = false;
  logger: unknown = null;
  checkForUpdates = vi.fn(async () => {
    this.emit('checking-for-update');
    const info = { version: '0.3.0', files: [{ url: 'Quvrelo-0.3.0-amd64.deb', sha512: 'x' }], releaseNotes: '<ul><li>Faster brushes</li></ul>', releaseDate: '2026-10-20' };
    this.emit('update-available', info);
    if (this.autoDownload) this.emit('update-downloaded', info);
    return { updateInfo: info };
  });
  downloadUpdate = vi.fn(async () => []);
  quitAndInstall = vi.fn();
  constructor(kind: string) {
    this.kind = kind;
    created.push(this);
  }
  setFeedURL(f: unknown) {
    this.feed = f;
  }
  on(ev: string, h: (...a: unknown[]) => void) {
    (this.handlers[ev] ??= []).push(h);
    return this;
  }
  emit(ev: string, ...a: unknown[]) {
    for (const h of this.handlers[ev] ?? []) h(...a);
  }
}

vi.mock('electron-updater', () => ({
  NsisUpdater: class extends FakeUpdater { constructor() { super('nsis'); } },
  MacUpdater: class extends FakeUpdater { constructor() { super('mac'); } },
  AppImageUpdater: class extends FakeUpdater { constructor() { super('appimage'); } },
  DebUpdater: class extends FakeUpdater { constructor() { super('deb'); } },
  RpmUpdater: class extends FakeUpdater { constructor() { super('rpm'); } },
  PacmanUpdater: class extends FakeUpdater { constructor() { super('pacman'); } },
}));

const openExternal = vi.fn(async () => undefined);
vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '0.2.0', getName: () => 'Quvrelo' },
  shell: { openExternal: (u: string) => openExternal(u) },
}));

// ---------------------------------------------------------------------------

const prefs = (p: Partial<UpdatePrefs> = {}): UpdatePrefs => ({ autoDownloadUpdates: true, updateChannel: 'stable', ...p });
const pol = (p: Partial<Policy> = {}): Policy => ({ ...DEFAULT_POLICY, ...p });
const facts = (f: Partial<PlatformFacts> = {}): PlatformFacts => ({
  platform: 'linux', isPackaged: true, env: {}, packageType: null, nsisUninstallerPresent: false, mas: false, macSigned: null, forceCheck: false, ...f,
});

describe('policy keys for updates', () => {
  it('defaults leave every update choice to the user', () => {
    const { policy } = parsePolicy({});
    expect(policy.updateFeedUrl).toBeNull();
    expect(policy.autoDownload).toBeNull();
    expect(policy.autoInstall).toBeNull();
    expect(policy.updateChannel).toBeNull();
  });
  it('parses and normalises the update keys', () => {
    const r = parsePolicy({ updateFeedUrl: 'https://updates.school.example/quvrelo', autoDownload: false, autoInstall: false, updateChannel: 'beta' });
    expect(r.warnings).toEqual([]);
    expect(r.policy.updateFeedUrl).toBe('https://updates.school.example/quvrelo/');
    expect(r.policy.autoDownload).toBe(false);
    expect(r.policy.autoInstall).toBe(false);
    expect(r.policy.updateChannel).toBe('beta');
  });
  it('rejects bad values with warnings', () => {
    const r = parsePolicy({ updateFeedUrl: 'file:///etc/passwd', autoDownload: 'no', updateChannel: 'nightly' });
    expect(r.policy.updateFeedUrl).toBeNull();
    expect(r.policy.autoDownload).toBeNull();
    expect(r.policy.updateChannel).toBeNull();
    expect(r.warnings).toHaveLength(3);
  });
});

describe('policy → updater config', () => {
  it('uses the public GitHub feed and stable channel by default', () => {
    const c = resolveUpdaterConfig(pol(), prefs());
    expect(c.enabled).toBe(true);
    expect(c.feed).toEqual(GITHUB_FEED);
    expect(c.updaterChannel).toBe('latest');
    expect(c.allowPrerelease).toBe(false);
    expect(c.allowDowngrade).toBe(false);
    expect(c.autoDownload).toBe(true);
    expect(c.autoInstallOnAppQuit).toBe(true);
    expect(c.locks).toEqual({ autoDownload: false, autoInstall: false, channel: false });
    expect(c.feedLabel).toBe('GitHub Releases');
  });
  it('never carries a token in the feed', () => {
    const c = resolveUpdaterConfig(pol(), prefs());
    expect(JSON.stringify(c)).not.toMatch(/token|authorization/i);
  });
  it('beta channel allows prereleases (GitHub) and reads beta*.yml', () => {
    const c = resolveUpdaterConfig(pol(), prefs({ updateChannel: 'beta' }));
    expect(c.channel).toBe('beta');
    expect(c.updaterChannel).toBe('beta');
    expect(c.allowPrerelease).toBe(true);
  });
  it('updateFeedUrl switches to the generic provider with the channel file name', () => {
    const c = resolveUpdaterConfig(pol({ updateFeedUrl: 'https://intranet.example/quvrelo/' }), prefs({ updateChannel: 'beta' }));
    expect(c.feed).toEqual({ provider: 'generic', url: 'https://intranet.example/quvrelo/', channel: 'beta' });
    expect(c.feedLabel).toBe('intranet.example');
    expect(c.downloadPage).toBe('https://intranet.example/quvrelo/');
    const s = resolveUpdaterConfig(pol({ updateFeedUrl: 'https://intranet.example/quvrelo/' }), prefs());
    expect(s.feed).toMatchObject({ provider: 'generic', channel: 'latest' });
  });
  it('policy locks override the user preferences', () => {
    const c = resolveUpdaterConfig(pol({ autoDownload: false, autoInstall: false, updateChannel: 'stable' }), prefs({ autoDownloadUpdates: true, updateChannel: 'beta' }));
    expect(c.autoDownload).toBe(false);
    expect(c.autoInstallOnAppQuit).toBe(false);
    expect(c.channel).toBe('stable');
    expect(c.allowPrerelease).toBe(false);
    expect(c.locks).toEqual({ autoDownload: true, autoInstall: true, channel: true });
  });
  it('the user can turn automatic download off', () => {
    expect(resolveUpdaterConfig(pol(), prefs({ autoDownloadUpdates: false })).autoDownload).toBe(false);
  });
  it('disableUpdateCheck or the update-check feature turn everything off', () => {
    expect(resolveUpdaterConfig(pol({ disableUpdateCheck: true }), prefs()).enabled).toBe(false);
    const c = resolveUpdaterConfig(pol({ disabledFeatures: ['update-check'] }), prefs());
    expect(c.enabled).toBe(false);
    expect(c.disabledReason).toMatch(/organisation/);
  });
});

describe('platform strategy', () => {
  it('detects the install kind', () => {
    expect(detectInstallKind(facts({ isPackaged: false }))).toBe('dev');
    expect(detectInstallKind(facts({ platform: 'win32', nsisUninstallerPresent: true }))).toBe('nsis');
    expect(detectInstallKind(facts({ platform: 'win32' }))).toBe('msi');
    expect(detectInstallKind(facts({ platform: 'win32', nsisUninstallerPresent: true, env: { PORTABLE_EXECUTABLE_DIR: 'C:\\x' } }))).toBe('portable');
    expect(detectInstallKind(facts({ platform: 'darwin' }))).toBe('mac');
    expect(detectInstallKind(facts({ platform: 'darwin', mas: true }))).toBe('mas');
    expect(detectInstallKind(facts({ env: { APPIMAGE: '/home/a/Quvrelo.AppImage' } }))).toBe('appimage');
    expect(detectInstallKind(facts({ packageType: 'deb' }))).toBe('deb');
    expect(detectInstallKind(facts({ packageType: 'rpm\n' }))).toBe('rpm');
    expect(detectInstallKind(facts({ env: { FLATPAK_ID: 'com.quvrelo.app', APPIMAGE: '/x' } }))).toBe('flatpak');
    expect(detectInstallKind(facts())).toBe('linux-other');
  });
  it('NSIS and AppImage update themselves with delta downloads', () => {
    for (const f of [facts({ platform: 'win32', nsisUninstallerPresent: true }), facts({ env: { APPIMAGE: '/a' } })]) {
      expect(selectStrategy(f)).toMatchObject({ mode: 'auto', action: 'restart', differential: true });
    }
  });
  it('macOS updates itself only when Developer ID signed', () => {
    expect(selectStrategy(facts({ platform: 'darwin', macSigned: true }))).toMatchObject({ mode: 'auto', action: 'restart' });
    expect(selectStrategy(facts({ platform: 'darwin', macSigned: false }))).toMatchObject({ mode: 'notify', action: 'open-download' });
  });
  it('MSI, deb, rpm and Flatpak notify only', () => {
    expect(selectStrategy(facts({ platform: 'win32' }))).toMatchObject({ kind: 'msi', mode: 'notify', action: 'open-download' });
    expect(selectStrategy(facts({ packageType: 'deb' }))).toMatchObject({ mode: 'notify', action: 'package-manager' });
    expect(selectStrategy(facts({ packageType: 'rpm' }))).toMatchObject({ mode: 'notify', action: 'package-manager' });
    expect(selectStrategy(facts({ env: { FLATPAK_ID: 'com.quvrelo.app' } }))).toMatchObject({ kind: 'flatpak', mode: 'notify' });
  });
  it('portable and development builds are disabled (dev can be forced to check-only)', () => {
    expect(selectStrategy(facts({ platform: 'win32', env: { PORTABLE_EXECUTABLE_FILE: 'x' } })).mode).toBe('disabled');
    expect(selectStrategy(facts({ isPackaged: false })).mode).toBe('disabled');
    expect(selectStrategy(facts({ isPackaged: false, forceCheck: true })).mode).toBe('notify');
  });
  it('package-manager commands', () => {
    expect(packageCommand('deb', 'Quvrelo-0.3.0-amd64.deb')).toBe('sudo apt install ./Quvrelo-0.3.0-amd64.deb');
    expect(packageCommand('rpm', 'Quvrelo-0.3.0-x86_64.rpm')).toBe('sudo dnf install ./Quvrelo-0.3.0-x86_64.rpm');
    expect(packageCommand('flatpak', null, 'com.quvrelo.app')).toBe('flatpak update com.quvrelo.app');
    expect(packageCommand('nsis', 'x.exe')).toBeNull();
  });
  it('recognises a Developer ID signature in codesign output', () => {
    expect(isDeveloperIdSigned('Executable=/Applications/Quvrelo.app\nAuthority=Developer ID Application: School Ltd (ABCDE12345)\nTeamIdentifier=ABCDE12345')).toBe(true);
    expect(isDeveloperIdSigned('Executable=/x\nSignature=adhoc\nTeamIdentifier=not set')).toBe(false);
    expect(isDeveloperIdSigned('/Applications/Quvrelo.app: code object is not signed at all')).toBe(false);
  });
});

describe('release notes', () => {
  it('reduces HTML to text lines', () => {
    expect(releaseNotesToText('<h2>New</h2><ul><li>Faster &amp; smoother brushes</li><li>Fix <b>crash</b></li></ul><script>alert(1)</script>'))
      .toBe('New\n\n• Faster & smoother brushes\n• Fix crash');
    expect(releaseNotesToText('## 0.3.0\n- One\n- Two')).toBe('0.3.0\n• One\n• Two');
    expect(releaseNotesToText([{ version: '0.3.0', note: 'Hello' }])).toBe('Hello');
    expect(releaseNotesToText(null)).toBe('');
  });
});

describe('UpdateService (mocked electron-updater)', () => {
  beforeEach(() => {
    created.length = 0;
    openExternal.mockClear();
  });

  async function service(policy: Partial<Policy>, p: Partial<UpdatePrefs>, f: Partial<PlatformFacts>) {
    const { UpdateService } = await import('../../src/main/updates/updater');
    const states: string[] = [];
    const quit = vi.fn();
    const svc = new UpdateService({
      policy: pol(policy), e2e: true, getPrefs: async () => prefs(p), broadcast: (s) => states.push(s.status), requestQuitForUpdate: quit,
    });
    await svc.init(facts(f));
    return { svc, states, quit, u: created[created.length - 1] };
  }

  it('NSIS: configures feed + channel, downloads in the background, restart goes through the close path', async () => {
    const { svc, u, quit } = await service({}, {}, { platform: 'win32', nsisUninstallerPresent: true });
    expect(u.kind).toBe('nsis');
    expect(u.feed).toEqual(GITHUB_FEED);
    expect(u.channel).toBe('latest');
    expect(u.allowDowngrade).toBe(false);
    expect(u.autoDownload).toBe(true);
    expect(u.autoInstallOnAppQuit).toBe(true);
    expect(u.disableDifferentialDownload).toBe(false);
    const st = await svc.check(true);
    expect(st.status).toBe('ready');
    expect(st.latest).toBe('0.3.0');
    expect(st.releaseNotes).toBe('• Faster brushes');
    svc.restart();
    expect(quit).toHaveBeenCalledOnce();
    expect(u.quitAndInstall).not.toHaveBeenCalled(); // waits for the window to close (save prompt)
    expect(svc.wantsInstall).toBe(true);
    svc.cancelRestart();
    expect(svc.wantsInstall).toBe(false);
    svc.restart();
    svc.installNow();
    expect(u.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('policy autoDownload:false + autoInstall:false: finds the update and waits for the user', async () => {
    const { svc, u } = await service({ autoDownload: false, autoInstall: false }, {}, { env: { APPIMAGE: '/a' } });
    expect(u.kind).toBe('appimage');
    expect(u.autoDownload).toBe(false);
    expect(u.autoInstallOnAppQuit).toBe(false);
    expect((await svc.check(true)).status).toBe('available');
    expect(svc.state.locks.autoDownload).toBe(true);
    await svc.download();
    expect(u.downloadUpdate).toHaveBeenCalledOnce();
  });

  it('deb: notify-only, never downloads, shows the apt command', async () => {
    const { svc, u } = await service({ updateFeedUrl: 'https://intranet.example/q/' }, { updateChannel: 'beta' }, { packageType: 'deb' });
    expect(u.kind).toBe('deb');
    expect(u.feed).toEqual({ provider: 'generic', url: 'https://intranet.example/q/', channel: 'beta' });
    expect(u.autoDownload).toBe(false);
    expect(u.autoInstallOnAppQuit).toBe(false);
    const st = await svc.check(true);
    expect(st.status).toBe('available');
    expect(st.command).toBe('sudo apt install ./Quvrelo-0.3.0-amd64.deb');
    expect(st.downloadUrl).toBe('https://intranet.example/q/Quvrelo-0.3.0-amd64.deb');
    await svc.openDownload();
    expect(openExternal).toHaveBeenCalledWith('https://intranet.example/q/Quvrelo-0.3.0-amd64.deb');
    svc.restart();
    expect(svc.wantsInstall).toBe(false);
  });

  it('unsigned mac falls back to the release page', async () => {
    const { svc, u } = await service({}, {}, { platform: 'darwin', macSigned: false });
    expect(u.kind).toBe('mac');
    expect(u.autoDownload).toBe(false);
    const st = await svc.check(true);
    expect(st).toMatchObject({ status: 'available', mode: 'notify', action: 'open-download' });
    expect(st.downloadUrl).toBe('https://github.com/TheWarrior-tech/Quverelo/releases/tag/v0.3.0');
  });

  it('disableUpdateCheck creates no updater and never checks', async () => {
    const { svc } = await service({ disableUpdateCheck: true }, {}, { platform: 'win32', nsisUninstallerPresent: true });
    expect(created).toHaveLength(0);
    expect(svc.state.status).toBe('disabled');
    expect((await svc.check(true)).status).toBe('disabled');
  });

  it('portable builds are disabled', async () => {
    const { svc } = await service({}, {}, { platform: 'win32', env: { PORTABLE_EXECUTABLE_DIR: 'D:\\' } });
    expect(created).toHaveLength(0);
    expect(svc.state.mode).toBe('disabled');
  });
});
