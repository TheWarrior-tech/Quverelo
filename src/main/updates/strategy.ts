/**
 * How Quvrelo was installed decides how it can update itself. Pure (no
 * Electron imports): the facts are gathered in updater.ts and passed in.
 *
 *   NSIS (Windows installer)    auto: background download (blockmap delta), restart / install on quit
 *   AppImage                    auto: background download (blockmap delta), restart / install on quit
 *   macOS DMG/PKG, signed       auto via Squirrel.Mac (needs the .zip in latest-mac.yml)
 *   macOS, unsigned / ad-hoc    notify: "Download update" opens the release page
 *   MSI                         notify: open the download page (MSI is deployed by IT)
 *   deb / rpm / pacman          notify: show the package-manager command (installing needs root)
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
  /** Check-only mode for unpackaged builds (end-to-end tests). */
  forceCheck: boolean;
}

export interface UpdateStrategy {
  kind: InstallKind;
  mode: UpdateMode;
  action: UpdateAction;
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

export function selectStrategy(f: PlatformFacts): UpdateStrategy {
  const kind = detectInstallKind(f);
  switch (kind) {
    case 'nsis':
      return { kind, mode: 'auto', action: 'restart', differential: true, note: null };
    case 'appimage':
      return { kind, mode: 'auto', action: 'restart', differential: true, note: null };
    case 'mac':
      return f.macSigned
        ? { kind, mode: 'auto', action: 'restart', differential: true, note: null }
        : { kind, mode: 'notify', action: 'open-download', differential: false, note: 'This copy of Quvrelo is not signed, so macOS will not let it update itself. Download the new version and replace the app.' };
    case 'msi':
      return { kind, mode: 'notify', action: 'open-download', differential: false, note: 'Installed with the MSI package. Download the new MSI, or ask your IT team to deploy it.' };
    case 'deb':
    case 'rpm':
    case 'pacman':
      return { kind, mode: 'notify', action: 'package-manager', differential: false, note: 'Installed with your package manager. Download the new package and install it with the command below.' };
    case 'flatpak':
      return { kind, mode: 'notify', action: 'package-manager', differential: false, note: 'Installed as a Flatpak. Updates come through Flatpak.' };
    case 'snap':
      return { kind, mode: 'notify', action: 'package-manager', differential: false, note: 'Installed as a Snap. Updates come through snapd.' };
    case 'linux-other':
      return { kind, mode: 'notify', action: 'open-download', differential: false, note: 'This build cannot update itself. Download the new version.' };
    case 'portable':
      return { kind, mode: 'disabled', action: 'none', differential: false, note: 'Portable copies do not update themselves.' };
    case 'mas':
      return { kind, mode: 'disabled', action: 'none', differential: false, note: 'Updates come from the App Store.' };
    case 'dev':
    default:
      return f.forceCheck
        ? { kind: 'dev', mode: 'notify', action: 'open-download', differential: false, note: 'Development build: updates are checked but not installed.' }
        : { kind: 'dev', mode: 'disabled', action: 'none', differential: false, note: 'Updates are off in development builds.' };
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

/** File extension of the package a notify-only install should download from the feed's file list. */
export function packageExtension(kind: InstallKind, platform: string): string | null {
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
