/**
 * How Quvrelo was installed decides how it can update itself. Pure (no
 * Electron imports): the facts are gathered in updater.ts and passed in.
 *
 *   NSIS (Windows installer)    auto (electron-updater): blockmap delta download, restart / install on quit
 *   AppImage                    auto (electron-updater): blockmap delta download, restart / install on quit
 *   macOS, Developer ID signed  auto (electron-updater / Squirrel.Mac, needs the .zip in latest-mac.yml)
 *   macOS, ad-hoc / unsigned    auto (Quvrelo's own installer, macInstall.ts): zip download, sha512,
 *                               codesign --verify, bundle swap by a detached helper, relaunch
 *   macOS, run from the DMG or  notify: the app cannot replace itself where it is ("move to Applications")
 *     App Translocation
 *   MSI                         auto (msiInstall.ts): .msi download + checksum, msiexec /i elevated on restart
 *   deb / rpm / pacman          auto (linuxPackage.ts): package download + checksum, pkexec install, relaunch
 *   Flatpak                     notify: "flatpak update" (the sandbox owns the files)
 *   Snap                        notify: "snap refresh"
 *   Windows portable, MAS       disabled
 *   development (unpackaged)    disabled (QUVRELO_UPDATER_FORCE=1 enables check-only for tests)
 */

export type InstallKind =
  | 'nsis' | 'msi' | 'portable'
  | 'mac' | 'mas'
  | 'appimage' | 'deb' | 'rpm' | 'pacman' | 'flatpak' | 'snap' | 'linux-other'
  | 'dev';

export type UpdateMode = 'auto' | 'notify' | 'disabled';

/**
 * Who downloads and installs an 'auto' update.
 *  electron-updater  NSIS, AppImage, Developer ID signed macOS
 *  mac-swap          ad-hoc signed macOS: Quvrelo swaps the .app bundle itself
 *  msi               Windows MSI: msiexec /i with elevation
 *  linux-package     deb / rpm / pacman: pkexec + the system package manager
 */
export type Installer = 'electron-updater' | 'mac-swap' | 'msi' | 'linux-package' | null;

/** What the primary button does once an update is found. */
export type UpdateAction = 'restart' | 'open-download' | 'package-manager' | 'none';

export interface PlatformFacts {
  platform: string;
  isPackaged: boolean;
  env: Record<string, string | undefined>;
  /** Contents of resources/package-type (written by electron-builder for deb/rpm/pacman). */
  packageType: string | null;
  /** Windows: "Uninstall Quvrelo.exe" sits next to the executable (NSIS installs only). */
  nsisUninstallerPresent: boolean;
  /** macOS: running from the Mac App Store build. */
  mas: boolean;
  /** macOS: signed with a Developer ID (Squirrel.Mac refuses unsigned / ad-hoc apps). null = unknown/not mac. */
  macSigned: boolean | null;
  /** macOS: path of the running .app bundle (to spot a DMG mount or App Translocation). */
  macBundlePath?: string | null;
  /** Check-only mode for unpackaged builds (end-to-end tests). */
  forceCheck: boolean;
}

export interface UpdateStrategy {
  kind: InstallKind;
  mode: UpdateMode;
  action: UpdateAction;
  /** Who downloads and installs (null unless mode is 'auto'). */
  installer: Installer;
  /** Whether electron-updater can use blockmap delta downloads for this kind. */
  differential: boolean;
  /** Short explanation shown in the Updates dialog when the app cannot install by itself. */
  note: string | null;
}

export function detectInstallKind(f: PlatformFacts): InstallKind {
  if (!f.isPackaged) return 'dev';
  if (f.platform === 'win32') {
    if (f.env.PORTABLE_EXECUTABLE_DIR || f.env.PORTABLE_EXECUTABLE_FILE) return 'portable';
    return f.nsisUninstallerPresent ? 'nsis' : 'msi';
  }
  if (f.platform === 'darwin') return f.mas ? 'mas' : 'mac';
  if (f.platform === 'linux') {
    if (f.env.FLATPAK_ID) return 'flatpak';
    if (f.env.SNAP) return 'snap';
    if (f.env.APPIMAGE) return 'appimage';
    const t = (f.packageType ?? '').trim();
    if (t === 'deb' || t === 'rpm' || t === 'pacman') return t;
    return 'linux-other';
  }
  return 'linux-other';
}

/**
 * macOS cannot replace an app that runs from a read-only disk image or from the
 * randomised App Translocation path Gatekeeper uses for quarantined downloads.
 */
export function macBundleNotReplaceable(bundle: string | null | undefined): boolean {
  if (!bundle) return false;
  // a mounted disk image has the app at its root: /Volumes/<image name>/Quvrelo.app
  // (an app deeper on an external drive, /Volumes/Drive/Applications/Quvrelo.app, is fine)
  return /^\/Volumes\/[^/]+\/[^/]+\.app\/?$/.test(bundle) || /\/AppTranslocation\//.test(bundle);
}

export function selectStrategy(f: PlatformFacts): UpdateStrategy {
  const kind = detectInstallKind(f);
  const auto = (installer: Installer, differential: boolean): UpdateStrategy => ({ kind, mode: 'auto', action: 'restart', installer, differential, note: null });
  const notify = (action: UpdateAction, note: string): UpdateStrategy => ({ kind, mode: 'notify', action, installer: null, differential: false, note });
  const off = (note: string): UpdateStrategy => ({ kind, mode: 'disabled', action: 'none', installer: null, differential: false, note });
  switch (kind) {
    case 'nsis':
    case 'appimage':
      return auto('electron-updater', true);
    case 'mac':
      if (f.macSigned) return auto('electron-updater', true);
      if (macBundleNotReplaceable(f.macBundlePath)) {
        return notify('open-download', 'Quvrelo is running from the disk image or a temporary location, so it cannot update itself. Drag Quvrelo into the Applications folder, open it from there, and future updates install automatically.');
      }
      return auto('mac-swap', false);
    case 'msi':
      return auto('msi', false);
    case 'deb':
    case 'rpm':
    case 'pacman':
      return auto('linux-package', false);
    case 'flatpak':
      return notify('package-manager', 'Installed as a Flatpak. Updates come through Flatpak.');
    case 'snap':
      return notify('package-manager', 'Installed as a Snap. Updates come through snapd.');
    case 'linux-other':
      return notify('open-download', 'This build cannot update itself. Download the new version.');
    case 'portable':
      return off('Portable copies do not update themselves.');
    case 'mas':
      return off('Updates come from the App Store.');
    case 'dev':
    default:
      return f.forceCheck
        ? { kind: 'dev', mode: 'notify', action: 'open-download', installer: null, differential: false, note: 'Development build: updates are checked but not installed.' }
        : { kind: 'dev', mode: 'disabled', action: 'none', installer: null, differential: false, note: 'Updates are off in development builds.' };
  }
}

/** Terminal command for package-manager installs. `file` is the downloaded package's file name. */
export function packageCommand(kind: InstallKind, file: string | null, flatpakId = 'com.quvrelo.app'): string | null {
  switch (kind) {
    case 'deb':
      return `sudo apt install ./${file ?? 'Quvrelo-<version>-amd64.deb'}`;
    case 'rpm':
      return `sudo dnf install ./${file ?? 'Quvrelo-<version>-x86_64.rpm'}`;
    case 'pacman':
      return `sudo pacman -U ./${file ?? 'Quvrelo-<version>.pacman'}`;
    case 'flatpak':
      return `flatpak update ${flatpakId}`;
    case 'snap':
      return 'sudo snap refresh quvrelo';
    default:
      return null;
  }
}

/**
 * File extension of the package to take from the feed's file list: what Quvrelo's own
 * installers download (`installer` set), or what "Download update" links to (notify).
 */
export function packageExtension(kind: InstallKind, platform: string, installer: Installer = null): string | null {
  if (installer === 'mac-swap') return 'zip';
  switch (kind) {
    case 'deb': return 'deb';
    case 'rpm': return 'rpm';
    case 'pacman': return 'pacman';
    case 'mac': return 'dmg';
    case 'msi': return 'msi';
    case 'linux-other': return 'AppImage';
    case 'dev': return platform === 'win32' ? 'exe' : platform === 'darwin' ? 'dmg' : 'AppImage';
    default: return null;
  }
}

/**
 * Parse `codesign -dv --verbose=2 <Quvrelo.app>` output (it prints to stderr).
 * Squirrel.Mac only installs updates into an app signed with a real identity;
 * ad-hoc signatures (Apple Silicon linker default) and unsigned apps fail.
 */
export function isDeveloperIdSigned(codesignOutput: string): boolean {
  if (/not signed at all|code object is not signed/i.test(codesignOutput)) return false;
  if (/Signature=adhoc/i.test(codesignOutput)) return false;
  if (/TeamIdentifier=not set/i.test(codesignOutput)) return false;
  return /Authority=Developer ID Application:/i.test(codesignOutput);
}
