/**
 * deb / rpm / pacman installs update themselves: the package is downloaded and checked in
 * the background (files.ts); "Restart to update" installs it with the system package
 * manager through pkexec (the desktop's normal administrator prompt), then Quvrelo
 * relaunches into the new version. Installing while the app runs is safe on Linux (the
 * running process keeps the old files open), so a cancelled or failed install leaves
 * Quvrelo open and the user can try again.
 *
 * The package's own maintainer scripts (build/linux/after-install.sh) run as usual.
 * Local packages are not GPG-signed; their sha512 from latest-linux.yml was checked first.
 */
import { execFile } from 'node:child_process';
import { accessSync, constants as fsc } from 'node:fs';
import * as path from 'node:path';

export type PackageKind = 'deb' | 'rpm' | 'pacman';

/** Find an executable on PATH (plus the usual sbin folders pkexec users may lack). */
export function which(cmd: string, envPath = process.env.PATH ?? ''): string | null {
  const dirs = [...envPath.split(':').filter(Boolean), '/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin'];
  for (const d of dirs) {
    const p = path.join(d, cmd);
    try {
      accessSync(p, fsc.X_OK);
      return p;
    } catch {
      /* next */
    }
  }
  return null;
}

/**
 * The root command that installs `file`, preferring a package manager that resolves
 * dependencies. `find` maps a command name to its absolute path (or null).
 */
export function installCommand(kind: PackageKind, file: string, find: (cmd: string) => string | null): string[] | null {
  const first = (cands: [string, (bin: string) => string[]][]) => {
    for (const [name, args] of cands) {
      const bin = find(name);
      if (bin) return args(bin);
    }
    return null;
  };
  switch (kind) {
    case 'deb':
      return first([
        ['apt-get', (b) => [b, 'install', '-y', '--allow-downgrades', file]],
        ['apt', (b) => [b, 'install', '-y', '--allow-downgrades', file]],
        ['dpkg', (b) => [b, '-i', file]],
      ]);
    case 'rpm':
      return first([
        ['dnf', (b) => [b, 'install', '-y', '--nogpgcheck', file]],
        ['zypper', (b) => [b, '--non-interactive', '--no-refresh', 'install', '--allow-unsigned-rpm', file]],
        ['yum', (b) => [b, 'install', '-y', '--nogpgcheck', file]],
        ['rpm', (b) => [b, '-U', '--replacepkgs', file]],
      ]);
    case 'pacman':
      return first([['pacman', (b) => [b, '-U', '--noconfirm', file]]]);
    default:
      return null;
  }
}

/** pkexec ... (already root → the command itself). */
export function elevate(cmd: string[], pkexec: string | null, isRoot: boolean): string[] | null {
  if (isRoot) return cmd;
  if (!pkexec) return null;
  return [pkexec, '--disable-internal-agent', ...cmd];
}

/** Human text for pkexec / package manager exit codes. */
export function describeInstallFailure(code: number, stderr: string): string {
  if (code === 126) return 'Installation was cancelled (administrator permission was not given).';
  if (code === 127) return 'Administrator permission could not be requested (no polkit agent is running).';
  const line = stderr.split('\n').map((l) => l.trim()).filter(Boolean).pop();
  return `The package manager could not install the update${line ? `: ${line.slice(0, 160)}` : '.'}`;
}

export function runInstall(argv: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(argv[0], argv.slice(1), { timeout: 15 * 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
      resolve({ code, stderr: String(stderr ?? '') || (err ? err.message : '') });
    });
  });
}
