/**
 * Download + integrity check for the installs Quvrelo updates itself (ad-hoc signed
 * macOS, MSI, deb/rpm/pacman). NSIS and AppImage keep electron-updater's own downloader.
 *
 * No Electron imports: the HTTP client is passed in (a dedicated Electron session in
 * production, so proxies and certificates follow the system; plain fetch in tests).
 *
 * The channel file (latest*.yml) itself is fetched and parsed by electron-updater's
 * provider, so GitHub/generic feeds, channels and prereleases behave exactly as for NSIS.
 *
 * Integrity: the sha512 that electron-builder writes into latest*.yml for each file
 * (macOS .zip, deb, rpm, and the MSI once CI adds it, see scripts/add-msi-update-info.mjs).
 * When the feed's .yml does not list the file, the release's SHA256SUMS.txt is used
 * instead. With neither, the download is refused: nothing unverified is ever installed.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, promises as fsp } from 'node:fs';
import * as path from 'node:path';

export interface FeedFile {
  url: string;
  sha512?: string;
  sha256?: string;
  size?: number;
}

export type ExpectedHash = { algorithm: 'sha512'; base64: string } | { algorithm: 'sha256'; hex: string };

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}>;

export interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export class ChecksumError extends Error {
  constructor(file: string) {
    super(`sha512 checksum mismatch for ${file}`);
    this.name = 'ChecksumError';
  }
}

const ARM = /(^|[^a-z0-9])(arm64|aarch64)([^a-z0-9]|$)/i;
const X64 = /(^|[^a-z0-9])(x64|amd64|x86_64)([^a-z0-9]|$)/i;

/** Whether a file name suits the CPU architecture (names without an arch suit any). */
export function archMatches(url: string, arch: string): boolean {
  const name = url.split('/').pop() ?? url;
  const arm = ARM.test(name);
  const x64 = X64.test(name);
  if (arch === 'arm64') return arm || !x64;
  if (arch === 'x64') return x64 || !arm;
  return !arm && !x64;
}

/**
 * The file to install from a feed's list: right extension, right architecture. An
 * arch-specific name wins over a universal one. null when nothing fits (never a file
 * for another architecture: installing it would break the app).
 */
export function pickUpdateFile(files: FeedFile[], ext: string, arch: string): FeedFile | null {
  const e = `.${ext.toLowerCase()}`;
  const candidates = files.filter((f) => f.url.toLowerCase().split('?')[0].endsWith(e) && archMatches(f.url, arch));
  const specific = candidates.find((f) => (arch === 'arm64' ? ARM : X64).test(f.url.split('/').pop() ?? ''));
  return specific ?? candidates[0] ?? null;
}

/** The file name electron-builder gives a package (package.json build.*.artifactName), for SHA256SUMS lookups. */
export function expectedArtifactName(ext: string, version: string, arch: string): string | null {
  switch (ext) {
    case 'msi':
      return `Quvrelo-${version}-${arch}.msi`;
    case 'deb':
      return `Quvrelo-${version}-${arch === 'arm64' ? 'arm64' : 'amd64'}.deb`;
    case 'rpm':
      return `Quvrelo-${version}-${arch === 'arm64' ? 'aarch64' : 'x86_64'}.rpm`;
    case 'pacman':
      return `Quvrelo-${version}-${arch === 'arm64' ? 'aarch64' : 'x64'}.pacman`;
    case 'zip':
      return `Quvrelo-${version}-mac-${arch}.zip`;
    default:
      return null;
  }
}

/** `sha256sum` output ("<hex>  <name>" or "<hex> *<name>") → name → lowercase hex. */
export function parseSha256Sums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m) out.set(path.basename(m[2].replace(/\\/g, '/')), m[1].toLowerCase());
  }
  return out;
}

/** The checksum a downloaded file must match, or null when the feed gives none. */
export function expectedHashFor(file: FeedFile, sums: Map<string, string> | null): ExpectedHash | null {
  if (file.sha512 && /^[0-9a-fA-F]{128}$/.test(file.sha512)) return { algorithm: 'sha512', base64: Buffer.from(file.sha512, 'hex').toString('base64') };
  if (file.sha512 && /^[A-Za-z0-9+/]{86}==$/.test(file.sha512)) return { algorithm: 'sha512', base64: file.sha512 };
  if (file.sha256 && /^[0-9a-fA-F]{64}$/.test(file.sha256)) return { algorithm: 'sha256', hex: file.sha256.toLowerCase() };
  const name = decodeURIComponent(file.url.split('?')[0].split('/').pop() ?? '');
  const hex = sums?.get(name);
  return hex ? { algorithm: 'sha256', hex } : null;
}

export function digestMatches(expected: ExpectedHash, digest: Buffer): boolean {
  return expected.algorithm === 'sha512' ? digest.toString('base64') === expected.base64 : digest.toString('hex') === expected.hex;
}

export async function hashFile(file: string, algorithm: 'sha512' | 'sha256'): Promise<Buffer> {
  const h = createHash(algorithm);
  await new Promise<void>((resolve, reject) => {
    createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve()).on('error', reject);
  });
  return h.digest();
}

export async function verifyFile(file: string, expected: ExpectedHash): Promise<boolean> {
  try {
    return digestMatches(expected, await hashFile(file, expected.algorithm));
  } catch {
    return false;
  }
}

/** Absolute download URL of a feed file. */
export function resolveFileUrl(fileUrl: string, base: string): string {
  return new URL(fileUrl, base).toString();
}

/**
 * Download `url` to `dest`, hashing as it streams. The file appears at `dest` only after
 * the hash matched (written to `dest.part` first); a mismatch deletes it and throws
 * ChecksumError. A file already at `dest` with the right hash is reused (no download).
 */
export async function downloadVerified(opts: {
  url: string;
  dest: string;
  expected: ExpectedHash;
  fetch: FetchLike;
  size?: number;
  onProgress?: (p: DownloadProgress) => void;
  signal?: AbortSignal;
  now?: () => number;
}): Promise<{ reused: boolean }> {
  const { url, dest, expected, fetch } = opts;
  const now = opts.now ?? Date.now;
  if (existsSync(dest) && (await verifyFile(dest, expected))) return { reused: true };
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { signal: opts.signal });
  if (!res.ok || !res.body) throw new Error(`HttpError: ${res.status} downloading ${url}`);
  const total = Number(res.headers.get('content-length')) || opts.size || 0;
  const part = `${dest}.part`;
  const out = createWriteStream(part);
  const hash = createHash(expected.algorithm);
  const started = now();
  let transferred = 0;
  let lastReport = 0;
  const report = (force: boolean) => {
    const t = now();
    if (!opts.onProgress || (!force && t - lastReport < 200)) return;
    lastReport = t;
    const secs = Math.max(0.001, (t - started) / 1000);
    opts.onProgress({ percent: total > 0 ? Math.min(100, (transferred / total) * 100) : 0, transferred, total, bytesPerSecond: Math.round(transferred / secs) });
  };
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      hash.update(value);
      transferred += value.byteLength;
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
      report(false);
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
  } catch (e) {
    out.destroy();
    await fsp.rm(part, { force: true });
    throw e;
  }
  report(true);
  if (!digestMatches(expected, hash.digest())) {
    await fsp.rm(part, { force: true });
    throw new ChecksumError(path.basename(dest));
  }
  await fsp.rm(dest, { force: true, recursive: true });
  await fsp.rename(part, dest);
  return { reused: false };
}

/** Folder for one pending version (`<root>/<version>`); other versions' folders are removed. */
export async function preparePendingDir(root: string, version: string): Promise<string> {
  await fsp.mkdir(root, { recursive: true });
  for (const name of await fsp.readdir(root)) {
    if (name !== version) await fsp.rm(path.join(root, name), { recursive: true, force: true });
  }
  const dir = path.join(root, version);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/** At launch: drop pending downloads that are not newer than the running version (installed, or stale). */
export async function cleanupPending(root: string, currentVersion: string): Promise<void> {
  if (!existsSync(root)) return;
  for (const name of await fsp.readdir(root)) {
    if (compareVersions(name, currentVersion) <= 0) await fsp.rm(path.join(root, name), { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Semver-ish compare (pre-release sorts before its release). */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [core, pre = ''] = v.replace(/^v/, '').split('-', 2);
    return { nums: core.split('.').map((n) => parseInt(n, 10) || 0), pre };
  };
  const A = split(a);
  const B = split(b);
  for (let i = 0; i < Math.max(A.nums.length, B.nums.length); i++) {
    const d = (A.nums[i] ?? 0) - (B.nums[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  return A.pre < B.pre ? -1 : 1;
}
