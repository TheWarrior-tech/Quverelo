import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY, parsePolicy, type Policy } from '../../src/core/policy';
import { readFileSync } from 'node:fs';
import * as os from 'node:os';
import { GITHUB_FEED, RELEASES_REPO, releaseNotesToText, resolveUpdaterConfig, type UpdatePrefs } from '../../src/main/updates/config';
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

const openExternal = vi.fn(async (_url: string) => undefined);
vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '0.2.0', getName: () => 'Quvrelo', getPath: () => os.tmpdir(), quit: () => undefined, relaunch: () => undefined },
  shell: { openExternal: (u: string) => openExternal(u) },
  session: { fromPartition: () => ({ fetch: (u: string) => fetch(u) }) },
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
  it('updateRepository: "owner/repo" or null', () => {
    expect(parsePolicy({ updateRepository: 'TheWarrior-tech/quvrelo-releases' }).policy.updateRepository).toBe('TheWarrior-tech/quvrelo-releases');
    expect(parsePolicy({ updateRepository: '' }).policy.updateRepository).toBeNull();
    const bad = parsePolicy({ updateRepository: 'https://github.com/a/b' });
    expect(bad.policy.updateRepository).toBeNull();
    expect(bad.warnings).toHaveLength(1);
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
  it('the built-in repository is the one CI publishes to (package.json build.publish)', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    const gh = pkg.build.publish.find((p: { provider: string }) => p.provider === 'github');
    expect({ owner: gh.owner, repo: gh.repo }).toEqual({ ...RELEASES_REPO });
    expect(GITHUB_FEED).toMatchObject(RELEASES_REPO);
  });
  it('policy updateRepository points the GitHub feed elsewhere; updateFeedUrl still wins', () => {
    const c = resolveUpdaterConfig(pol({ updateRepository: 'TheWarrior-tech/quvrelo-releases' }), prefs());
    expect(c.feed).toEqual({ provider: 'github', owner: 'TheWarrior-tech', repo: 'quvrelo-releases', releaseType: 'release' });
    expect(c.downloadPage).toBe('https://github.com/TheWarrior-tech/quvrelo-releases/releases');
    expect(c.feedLabel).toBe('GitHub Releases (TheWarrior-tech/quvrelo-releases)');
    const g = resolveUpdaterConfig(pol({ updateRepository: 'a/b', updateFeedUrl: 'https://intranet.example/q/' }), prefs());
    expect(g.feed.provider).toBe('generic');
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
  it('NSIS and AppImage update themselves through electron-updater with delta downloads', () => {
    for (const f of [facts({ platform: 'win32', nsisUninstallerPresent: true }), facts({ env: { APPIMAGE: '/a' } })]) {
      expect(selectStrategy(f)).toMatchObject({ mode: 'auto', action: 'restart', installer: 'electron-updater', differential: true });
    }
  });
  it('macOS: Squirrel.Mac when Developer ID signed, Quvrelo\'s own bundle swap when ad-hoc signed', () => {
    expect(selectStrategy(facts({ platform: 'darwin', macSigned: true }))).toMatchObject({ mode: 'auto', action: 'restart', installer: 'electron-updater' });
    expect(selectStrategy(facts({ platform: 'darwin', macSigned: false, macBundlePath: '/Applications/Quvrelo.app' }))).toMatchObject({ mode: 'auto', action: 'restart', installer: 'mac-swap' });
    expect(selectStrategy(facts({ platform: 'darwin', macSigned: false, macBundlePath: '/Users/a/Applications/Quvrelo.app' })).installer).toBe('mac-swap');
    expect(selectStrategy(facts({ platform: 'darwin', macSigned: false, macBundlePath: '/Volumes/Drive/Applications/Quvrelo.app' })).installer).toBe('mac-swap');
  });
  it('macOS running from the DMG or App Translocation cannot replace itself', () => {
    for (const p of ['/Volumes/Quvrelo 0.6.1/Quvrelo.app', '/private/var/folders/xy/T/AppTranslocation/1234-5678/d/Quvrelo.app']) {
      expect(selectStrategy(facts({ platform: 'darwin', macSigned: false, macBundlePath: p }))).toMatchObject({ mode: 'notify', action: 'open-download', installer: null });
    }
  });
  it('MSI, deb, rpm and pacman install themselves; Flatpak and Snap stay with their own tools', () => {
    expect(selectStrategy(facts({ platform: 'win32' }))).toMatchObject({ kind: 'msi', mode: 'auto', action: 'restart', installer: 'msi' });
    expect(selectStrategy(facts({ packageType: 'deb' }))).toMatchObject({ mode: 'auto', action: 'restart', installer: 'linux-package' });
    expect(selectStrategy(facts({ packageType: 'rpm' }))).toMatchObject({ mode: 'auto', action: 'restart', installer: 'linux-package' });
    expect(selectStrategy(facts({ packageType: 'pacman' }))).toMatchObject({ mode: 'auto', installer: 'linux-package' });
    expect(selectStrategy(facts({ env: { FLATPAK_ID: 'com.quvrelo.app' } }))).toMatchObject({ kind: 'flatpak', mode: 'notify', action: 'package-manager', installer: null });
    expect(selectStrategy(facts({ env: { SNAP: '/snap/quvrelo/1' } }))).toMatchObject({ kind: 'snap', mode: 'notify' });
    expect(selectStrategy(facts())).toMatchObject({ kind: 'linux-other', mode: 'notify', action: 'open-download' });
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

  it('Flatpak: notify-only, never downloads, shows the flatpak command', async () => {
    const { svc, u } = await service({ updateFeedUrl: 'https://intranet.example/q/' }, { updateChannel: 'beta' }, { env: { FLATPAK_ID: 'com.quvrelo.app' } });
    expect(u.kind).toBe('appimage');
    expect(u.feed).toEqual({ provider: 'generic', url: 'https://intranet.example/q/', channel: 'beta' });
    expect(u.autoDownload).toBe(false);
    expect(u.autoInstallOnAppQuit).toBe(false);
    expect(u.forceDevUpdateConfig).toBe(true);
    const st = await svc.check(true);
    expect(st.status).toBe('available');
    expect(st.command).toBe('flatpak update com.quvrelo.app');
    svc.restart();
    expect(svc.wantsInstall).toBe(false);
  });

  it('deb: electron-updater only checks; Quvrelo downloads and installs it (no copy-paste command)', async () => {
    const { svc, u } = await service({ autoDownload: false }, {}, { packageType: 'deb' });
    expect(u.kind).toBe('deb');
    expect(u.autoDownload).toBe(false);
    expect(u.autoInstallOnAppQuit).toBe(false);
    const st = await svc.check(true);
    expect(st).toMatchObject({ status: 'available', mode: 'auto', action: 'restart', command: null, adminPrompt: true });
    expect(u.downloadUpdate).not.toHaveBeenCalled();
  });

  it('linux tarball (no package type) falls back to the download link', async () => {
    const { svc } = await service({ updateFeedUrl: 'https://intranet.example/q/' }, {}, {});
    const st = await svc.check(true);
    expect(st).toMatchObject({ status: 'available', mode: 'notify', action: 'open-download' });
    await svc.openDownload();
    expect(openExternal).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/intranet\.example\/q\//));
  });

  it('dev builds forced to check point "Download update" at the GitHub release tag', async () => {
    const { svc } = await service({}, {}, { isPackaged: false, forceCheck: true });
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
