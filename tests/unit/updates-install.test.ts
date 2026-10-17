/**
 * Quvrelo's own update installers (ad-hoc signed macOS, MSI, deb/rpm): download +
 * checksum, helper script generation, the macOS bundle swap with rollback (executed here
 * with stub ditto/codesign/xattr/open/osascript), and the UpdateService flows.
 * macOS and Windows themselves cannot run in CI; what they would execute is covered here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DEFAULT_POLICY, type Policy } from '../../src/core/policy';
import {
  archMatches, ChecksumError, cleanupPending, compareVersions, downloadVerified, expectedArtifactName, expectedHashFor,
  parseSha256Sums, pickUpdateFile, preparePendingDir, verifyFile, type FeedFile,
} from '../../src/main/updates/files';
import { backupPathFor, macRunnerScript, macSwapScript, shq, stageMacUpdate, type Exec, type MacSwapPlan } from '../../src/main/updates/macInstall';
import { msiHelperScript, psq } from '../../src/main/updates/msiInstall';
import { describeInstallFailure, elevate, installCommand } from '../../src/main/updates/linuxPackage';
import type { PlatformFacts } from '../../src/main/updates/strategy';
import type { InstallDeps } from '../../src/main/updates/updater';

// ---------------------------------------------------------------------------
// electron / electron-updater mocks for the UpdateService tests

const created: FakeUpdater[] = [];
let feedInfo: { version: string; files: FeedFile[]; releaseNotes?: string } = { version: '0.7.0', files: [] };

class FakeUpdater {
  handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  feed: { url?: string } | null = null;
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
    this.emit('update-available', feedInfo);
    return { updateInfo: feedInfo };
  });
  downloadUpdate = vi.fn(async () => []);
  quitAndInstall = vi.fn();
  constructor(public kind: string) {
    created.push(this);
  }
  setFeedURL(f: { url?: string }) {
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
vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '0.6.1', getName: () => 'Quvrelo', getPath: () => os.tmpdir(), quit: vi.fn(), relaunch: vi.fn() },
  shell: { openExternal: vi.fn() },
  session: { fromPartition: () => ({ fetch: (u: string) => fetch(u) }) },
}));

// ---------------------------------------------------------------------------
// local feed server

const served = new Map<string, Buffer>();
const hits: string[] = [];
let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '/').slice(1));
    hits.push(name);
    const body = served.get(name);
    if (!body) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Length': String(body.length) });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const sha512 = (b: Buffer) => createHash('sha512').update(b).digest('base64');
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const tmp = (prefix = 'quvrelo-upd-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// ---------------------------------------------------------------------------

describe('picking the file to install', () => {
  const mac: FeedFile[] = [
    { url: 'Quvrelo-0.7.0-mac-x64.zip', sha512: 'a' },
    { url: 'Quvrelo-0.7.0-mac-arm64.zip', sha512: 'b' },
    { url: 'Quvrelo-0.7.0-mac-x64.dmg', sha512: 'c' },
    { url: 'Quvrelo-0.7.0-mac-arm64.dmg', sha512: 'd' },
  ];
  it('takes the zip for the running architecture, never the other one', () => {
    expect(pickUpdateFile(mac, 'zip', 'arm64')?.url).toBe('Quvrelo-0.7.0-mac-arm64.zip');
    expect(pickUpdateFile(mac, 'zip', 'x64')?.url).toBe('Quvrelo-0.7.0-mac-x64.zip');
    expect(pickUpdateFile([{ url: 'Quvrelo-0.7.0-mac-x64.zip' }], 'zip', 'arm64')).toBeNull();
  });
  it('deb / rpm architecture names', () => {
    const linux: FeedFile[] = [
      { url: 'Quvrelo-0.7.0-x86_64.AppImage' }, { url: 'Quvrelo-0.7.0-amd64.deb' }, { url: 'Quvrelo-0.7.0-arm64.deb' },
      { url: 'Quvrelo-0.7.0-x86_64.rpm' }, { url: 'Quvrelo-0.7.0-aarch64.rpm' },
    ];
    expect(pickUpdateFile(linux, 'deb', 'x64')?.url).toBe('Quvrelo-0.7.0-amd64.deb');
    expect(pickUpdateFile(linux, 'deb', 'arm64')?.url).toBe('Quvrelo-0.7.0-arm64.deb');
    expect(pickUpdateFile(linux, 'rpm', 'arm64')?.url).toBe('Quvrelo-0.7.0-aarch64.rpm');
    expect(pickUpdateFile(linux, 'msi', 'x64')).toBeNull();
  });
  it('a universal (arch-less) file suits any architecture, an arch-specific one wins', () => {
    expect(archMatches('Quvrelo-0.7.0.zip', 'arm64')).toBe(true);
    expect(pickUpdateFile([{ url: 'Quvrelo-0.7.0-mac.zip' }, { url: 'Quvrelo-0.7.0-mac-arm64.zip' }], 'zip', 'arm64')?.url).toBe('Quvrelo-0.7.0-mac-arm64.zip');
    expect(pickUpdateFile([{ url: 'Quvrelo-0.7.0-mac.zip' }], 'zip', 'x64')?.url).toBe('Quvrelo-0.7.0-mac.zip');
  });
  it('artifact names follow package.json (for SHA256SUMS lookups)', () => {
    expect(expectedArtifactName('msi', '0.7.0', 'x64')).toBe('Quvrelo-0.7.0-x64.msi');
    expect(expectedArtifactName('msi', '0.7.0', 'arm64')).toBe('Quvrelo-0.7.0-arm64.msi');
    expect(expectedArtifactName('deb', '0.7.0', 'x64')).toBe('Quvrelo-0.7.0-amd64.deb');
    expect(expectedArtifactName('rpm', '0.7.0', 'x64')).toBe('Quvrelo-0.7.0-x86_64.rpm');
  });
});

describe('checksums', () => {
  it('parses sha256sum output (text and binary mode)', () => {
    const a = 'a'.repeat(64);
    const b = 'B'.repeat(64);
    const m = parseSha256Sums(`${a}  Quvrelo-0.7.0-x64.msi\n${b} *Quvrelo-Setup-0.7.0-x64.exe\r\nnot a line\n`);
    expect(m.get('Quvrelo-0.7.0-x64.msi')).toBe(a);
    expect(m.get('Quvrelo-Setup-0.7.0-x64.exe')).toBe('b'.repeat(64));
    expect(m.size).toBe(2);
  });
  it('prefers the sha512 from latest*.yml, falls back to SHA256SUMS, refuses with neither', () => {
    const s512 = sha512(Buffer.from('x'));
    expect(expectedHashFor({ url: 'a.zip', sha512: s512 }, null)).toEqual({ algorithm: 'sha512', base64: s512 });
    const hex = createHash('sha512').update('x').digest('hex');
    expect(expectedHashFor({ url: 'a.zip', sha512: hex }, null)).toEqual({ algorithm: 'sha512', base64: s512 });
    const sums = new Map([['Quvrelo-0.7.0-x64.msi', 'c'.repeat(64)]]);
    expect(expectedHashFor({ url: 'Quvrelo-0.7.0-x64.msi' }, sums)).toEqual({ algorithm: 'sha256', hex: 'c'.repeat(64) });
    expect(expectedHashFor({ url: 'Quvrelo-0.7.0-x64.msi' }, null)).toBeNull();
    expect(expectedHashFor({ url: 'other.msi' }, sums)).toBeNull();
  });
  it('verifyFile checks sha512 and sha256', async () => {
    const d = tmp();
    const f = path.join(d, 'pkg.deb');
    const body = Buffer.from('package bytes');
    fs.writeFileSync(f, body);
    expect(await verifyFile(f, { algorithm: 'sha512', base64: sha512(body) })).toBe(true);
    expect(await verifyFile(f, { algorithm: 'sha256', hex: sha256(body) })).toBe(true);
    expect(await verifyFile(f, { algorithm: 'sha512', base64: sha512(Buffer.from('other')) })).toBe(false);
    expect(await verifyFile(path.join(d, 'missing'), { algorithm: 'sha256', hex: sha256(body) })).toBe(false);
  });
  it('compares versions (pre-releases before their release)', () => {
    expect(compareVersions('0.7.0', '0.6.1')).toBe(1);
    expect(compareVersions('0.6.1', '0.6.1')).toBe(0);
    expect(compareVersions('0.7.0-beta.1', '0.7.0')).toBe(-1);
    expect(compareVersions('1.0.0', '0.10.0')).toBe(1);
  });
});

describe('downloadVerified', () => {
  const body = Buffer.alloc(300_000, 7);
  beforeEach(() => {
    served.set('Quvrelo-0.7.0-amd64.deb', body);
    hits.length = 0;
  });

  it('streams to disk with progress and keeps the file only when the hash matches', async () => {
    const d = tmp();
    const dest = path.join(d, 'Quvrelo-0.7.0-amd64.deb');
    const progress: number[] = [];
    const r = await downloadVerified({
      url: `${base}Quvrelo-0.7.0-amd64.deb`, dest, expected: { algorithm: 'sha512', base64: sha512(body) }, fetch,
      onProgress: (p) => progress.push(p.percent),
    });
    expect(r.reused).toBe(false);
    expect(fs.readFileSync(dest).equals(body)).toBe(true);
    expect(progress[progress.length - 1]).toBe(100);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  it('a checksum mismatch deletes the download and throws', async () => {
    const d = tmp();
    const dest = path.join(d, 'Quvrelo-0.7.0-amd64.deb');
    await expect(downloadVerified({ url: `${base}Quvrelo-0.7.0-amd64.deb`, dest, expected: { algorithm: 'sha512', base64: sha512(Buffer.from('nope')) }, fetch }))
      .rejects.toBeInstanceOf(ChecksumError);
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  it('reuses an already verified download without fetching', async () => {
    const d = tmp();
    const dest = path.join(d, 'Quvrelo-0.7.0-amd64.deb');
    fs.writeFileSync(dest, body);
    const r = await downloadVerified({ url: `${base}Quvrelo-0.7.0-amd64.deb`, dest, expected: { algorithm: 'sha256', hex: sha256(body) }, fetch });
    expect(r.reused).toBe(true);
    expect(hits).toHaveLength(0);
  });

  it('HTTP errors are reported', async () => {
    const d = tmp();
    await expect(downloadVerified({ url: `${base}missing.deb`, dest: path.join(d, 'x.deb'), expected: { algorithm: 'sha256', hex: 'a'.repeat(64) }, fetch }))
      .rejects.toThrow(/404/);
  });

  it('pending folders: one version at a time, cleaned once installed', async () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, '0.6.5'));
    const dir = await preparePendingDir(root, '0.7.0');
    expect(fs.readdirSync(root)).toEqual(['0.7.0']);
    expect(dir).toBe(path.join(root, '0.7.0'));
    await cleanupPending(root, '0.6.1');
    expect(fs.existsSync(dir)).toBe(true); // newer than the running app: still pending
    await cleanupPending(root, '0.7.0');
    expect(fs.existsSync(dir)).toBe(false); // the app now runs 0.7.0: installed
  });
});

// ---------------------------------------------------------------------------
// macOS helper

/** Stub macOS tools on PATH; their behaviour is steered with env vars. */
function stubBin(): string {
  const bin = tmp('quvrelo-bin-');
  const w = (name: string, body: string) => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  w('ditto', `echo "ditto $*" >> "$STUB_LOG"
if [ "$DITTO_FAIL" = "1" ]; then mkdir -p "$2"; echo partial > "$2/partial"; exit 1; fi
cp -R "$1" "$2"`);
  w('codesign', `echo "codesign $*" >> "$STUB_LOG"; exit \${CODESIGN_RC:-0}`);
  w('xattr', `echo "xattr $*" >> "$STUB_LOG"`);
  w('open', `echo "open $*" >> "$STUB_LOG"`);
  w('osascript', `echo "osascript $*" >> "$STUB_LOG"
if [ "$OSA_CANCEL" = "1" ]; then exit 1; fi
/bin/bash "\${@: -1}"`);
  return bin;
}

function macFixture(name = 'My Apps') {
  const root = tmp('quvrelo-mac-');
  const apps = path.join(root, name);
  const target = path.join(apps, 'Quvrelo.app');
  fs.mkdirSync(path.join(target, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(target, 'Contents', 'version'), '0.6.1');
  const pending = path.join(root, "pending it's", '0.7.0');
  const source = path.join(pending, 'staged', 'Quvrelo.app');
  fs.mkdirSync(path.join(source, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(source, 'Contents', 'version'), '0.7.0');
  const plan: MacSwapPlan = {
    pid: 999_999, source, target, backup: backupPathFor(target), log: path.join(root, 'update.log'), relaunch: true, admin: false, pendingDir: pending, waitSeconds: 5,
  };
  return { root, target, pending, plan, stubLog: path.join(root, 'stub.log') };
}

function writeHelper(plan: MacSwapPlan): string {
  const dir = path.dirname(plan.log);
  const swap = path.join(dir, 'swap.sh');
  const runner = path.join(dir, 'runner.sh');
  fs.writeFileSync(swap, macSwapScript(plan), { mode: 0o755 });
  fs.writeFileSync(runner, macRunnerScript(plan, swap), { mode: 0o755 });
  return runner;
}
const helperEnv = (stubLog: string, env: Record<string, string>) => ({ ...process.env, PATH: `${stubBin()}:${process.env.PATH}`, STUB_LOG: stubLog, ...env });
const helperResult = (code: number | null, plan: MacSwapPlan, stubLog: string) => ({
  code, stub: fs.existsSync(stubLog) ? fs.readFileSync(stubLog, 'utf8') : '', log: fs.existsSync(plan.log) ? fs.readFileSync(plan.log, 'utf8') : '',
});

function runHelper(plan: MacSwapPlan, env: Record<string, string>, stubLog: string) {
  const r = spawnSync('/bin/bash', [writeHelper(plan)], { env: helperEnv(stubLog, env), encoding: 'utf8', timeout: 20_000 });
  return helperResult(r.status, plan, stubLog);
}

/** Async, so Node keeps reaping children (a waited-on PID must really disappear). */
async function runHelperAsync(plan: MacSwapPlan, env: Record<string, string>, stubLog: string) {
  const child = spawn('/bin/bash', [writeHelper(plan)], { env: helperEnv(stubLog, env), stdio: 'ignore' });
  const code = await new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
  return helperResult(code, plan, stubLog);
}

const versionOf = (app: string) => fs.readFileSync(path.join(app, 'Contents', 'version'), 'utf8');

describe('macOS bundle swap helper', () => {
  it('quotes paths safely and is valid bash', () => {
    expect(shq("it's here")).toBe(`'it'\\''s here'`);
    const { plan } = macFixture();
    for (const script of [macSwapScript(plan), macRunnerScript(plan, '/tmp/swap me.sh'), macRunnerScript({ ...plan, admin: true }, '/tmp/s.sh')]) {
      const f = path.join(tmp(), 's.sh');
      fs.writeFileSync(f, script);
      expect(() => execFileSync('/bin/bash', ['-n', f])).not.toThrow();
    }
    expect(macSwapScript(plan)).toContain(`DST=${shq(plan.target)}`);
    expect(macSwapScript(plan)).toContain('codesign --verify --deep --strict "$DST"');
    expect(macSwapScript(plan)).toContain('xattr -dr com.apple.quarantine "$DST"');
    expect(macRunnerScript(plan, '/x/swap.sh')).toContain('open "$DST"');
    expect(macRunnerScript({ ...plan, relaunch: false }, '/x/swap.sh')).toContain('RELAUNCH=0');
  });

  it('admin mode runs the swap through osascript with administrator privileges; plain mode does not', () => {
    const { plan } = macFixture();
    expect(macRunnerScript({ ...plan, admin: true }, '/x/swap.sh')).toMatch(/osascript .*with administrator privileges.*"\$SWAP"/);
    expect(macRunnerScript(plan, '/x/swap.sh')).not.toContain('osascript');
  });

  it('replaces the app, clears quarantine, relaunches and tidies up', () => {
    const { plan, target, pending, stubLog } = macFixture();
    const r = runHelper(plan, {}, stubLog);
    expect(r.code).toBe(0);
    expect(versionOf(target)).toBe('0.7.0');
    expect(fs.existsSync(plan.backup)).toBe(false);
    expect(fs.existsSync(pending)).toBe(false);
    expect(r.stub).toContain(`xattr -dr com.apple.quarantine ${target}`);
    expect(r.stub).toContain(`open ${target}`);
    expect(r.log).toContain('installed');
  });

  it('rolls back to the old app when the copy fails', () => {
    const { plan, target, pending, stubLog } = macFixture();
    const r = runHelper(plan, { DITTO_FAIL: '1' }, stubLog);
    expect(r.code).toBe(4);
    expect(versionOf(target)).toBe('0.6.1');
    expect(fs.existsSync(path.join(target, 'partial'))).toBe(false);
    expect(fs.existsSync(plan.backup)).toBe(false);
    expect(fs.existsSync(pending)).toBe(true); // kept for another try
    expect(r.stub).toContain(`open ${target}`); // the old version reopens
    expect(r.log).toContain('restoring the previous version');
  });

  it('rolls back when the installed copy fails the signature check', () => {
    const { plan, target, stubLog } = macFixture();
    const r = runHelper(plan, { CODESIGN_RC: '1' }, stubLog);
    expect(r.code).toBe(5);
    expect(versionOf(target)).toBe('0.6.1');
    expect(fs.existsSync(plan.backup)).toBe(false);
  });

  it('changes nothing when the staged update is missing', () => {
    const { plan, target, stubLog } = macFixture();
    fs.rmSync(plan.source, { recursive: true });
    const r = runHelper(plan, {}, stubLog);
    expect(r.code).toBe(2);
    expect(versionOf(target)).toBe('0.6.1');
  });

  it('admin swap through osascript; a cancelled password prompt leaves the old app and reopens it', () => {
    const a = macFixture();
    const ok = runHelper({ ...a.plan, admin: true }, {}, a.stubLog);
    expect(ok.code).toBe(0);
    expect(ok.stub).toContain('osascript');
    expect(versionOf(a.target)).toBe('0.7.0');

    const b = macFixture();
    const cancelled = runHelper({ ...b.plan, admin: true }, { OSA_CANCEL: '1' }, b.stubLog);
    expect(cancelled.code).not.toBe(0);
    expect(versionOf(b.target)).toBe('0.6.1');
    expect(cancelled.stub).toContain(`open ${b.target}`);
  });

  it('waits for the app to exit first; gives up (changing nothing) if it never does', async () => {
    const a = macFixture();
    const sleeper = spawn('sleep', ['1']);
    const t0 = Date.now();
    const r = await runHelperAsync({ ...a.plan, pid: sleeper.pid! }, {}, a.stubLog);
    expect(r.code).toBe(0);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(700);
    expect(versionOf(a.target)).toBe('0.7.0');

    const b = macFixture();
    const forever = spawn('sleep', ['30']);
    const r2 = await runHelperAsync({ ...b.plan, pid: forever.pid!, waitSeconds: 0.5 }, {}, b.stubLog);
    forever.kill();
    expect(r2.code).toBe(1);
    expect(versionOf(b.target)).toBe('0.6.1');
    expect(r2.log).toContain('postponed');
  });

  it('staging: unzips, checks bundle id, version and signature', async () => {
    const stageDir = path.join(tmp(), 'staged');
    const calls: string[] = [];
    const exec = (over: Partial<Record<string, { code: number; stdout: string }>> = {}): Exec => async (cmd, args) => {
      calls.push(`${path.basename(cmd)} ${args.join(' ')}`);
      const tool = path.basename(cmd);
      if (tool === 'ditto') fs.mkdirSync(path.join(args[3], 'Quvrelo.app', 'Contents'), { recursive: true });
      if (tool === 'plutil') {
        const key = args[1];
        const o = over[key] ?? { code: 0, stdout: key === 'CFBundleIdentifier' ? 'com.quvrelo.app\n' : '0.7.0\n' };
        return { ...o, stderr: '' };
      }
      if (tool === 'codesign') return { code: over.codesign?.code ?? 0, stdout: '', stderr: over.codesign ? 'invalid signature' : '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const staged = await stageMacUpdate({ zip: '/x/u.zip', stageDir, bundleId: 'com.quvrelo.app', version: '0.7.0', exec: exec() });
    expect(staged).toBe(path.join(stageDir, 'Quvrelo.app'));
    expect(calls[0]).toBe(`ditto -x -k /x/u.zip ${stageDir}`);
    expect(calls).toContain(`codesign --verify --deep --strict ${staged}`);
    await expect(stageMacUpdate({ zip: '/x/u.zip', stageDir, bundleId: 'com.quvrelo.app', version: '0.7.0', exec: exec({ CFBundleIdentifier: { code: 0, stdout: 'com.evil.app' } }) }))
      .rejects.toThrow(/not Quvrelo/);
    await expect(stageMacUpdate({ zip: '/x/u.zip', stageDir, bundleId: 'com.quvrelo.app', version: '0.7.0', exec: exec({ CFBundleShortVersionString: { code: 0, stdout: '0.6.0' } }) }))
      .rejects.toThrow(/expected 0.7.0/);
    await expect(stageMacUpdate({ zip: '/x/u.zip', stageDir, bundleId: 'com.quvrelo.app', version: '0.7.0', exec: exec({ codesign: { code: 1, stdout: '' } }) }))
      .rejects.toThrow(/code signature/);
  });
});

describe('Windows MSI helper script', () => {
  const plan = {
    pid: 4242, msi: "C:\\Users\\O'Brien\\AppData\\Roaming\\Quvrelo\\pending-update\\0.7.0\\Quvrelo-0.7.0-x64.msi",
    exe: 'C:\\Program Files\\Quvrelo\\Quvrelo.exe', log: 'C:\\t\\update.log', msiLog: 'C:\\t\\msiexec.log', relaunch: true, pendingDir: 'C:\\t\\0.7.0',
  };
  it('escapes PowerShell strings', () => {
    expect(psq("O'Brien")).toBe("'O''Brien'");
  });
  it('waits for the app, runs msiexec elevated with a basic UI, relaunches either way', () => {
    const s = msiHelperScript(plan);
    expect(s).toContain('$appPid = 4242');
    expect(s).toContain("$msi = 'C:\\Users\\O''Brien\\AppData");
    expect(s).toContain('Wait-Process -Id $appPid');
    expect(s).toMatch(/Start-Process -FilePath \(Join-Path \$env:SystemRoot 'System32\\msiexec\.exe'\) -ArgumentList \$msiArgs -Verb RunAs -Wait -PassThru/);
    expect(s).toContain("@('/i', ('\"' + $msi + '\"'), '/qb', '/norestart'");
    expect(s).toContain('@(0, 3010, 1641) -contains $code');
    expect(s).toContain('if ($relaunch -and (Test-Path -LiteralPath $exe)) { Start-Process -FilePath $exe }');
    expect(s).not.toMatch(/\$args\b|\$pid\b/i); // PowerShell automatic variables
    expect(msiHelperScript({ ...plan, relaunch: false })).toContain('$relaunch = $false');
  });
});

describe('Linux package install commands', () => {
  const has = (...cmds: string[]) => (c: string) => (cmds.includes(c) ? `/usr/bin/${c}` : null);
  it('deb: apt-get (resolves dependencies), else dpkg', () => {
    expect(installCommand('deb', '/p/q.deb', has('apt-get', 'dpkg'))).toEqual(['/usr/bin/apt-get', 'install', '-y', '--allow-downgrades', '/p/q.deb']);
    expect(installCommand('deb', '/p/q.deb', has('dpkg'))).toEqual(['/usr/bin/dpkg', '-i', '/p/q.deb']);
    expect(installCommand('deb', '/p/q.deb', has())).toBeNull();
  });
  it('rpm: dnf, zypper, yum, rpm', () => {
    expect(installCommand('rpm', '/p/q.rpm', has('dnf', 'rpm'))?.slice(0, 3)).toEqual(['/usr/bin/dnf', 'install', '-y']);
    expect(installCommand('rpm', '/p/q.rpm', has('zypper', 'rpm'))).toContain('--allow-unsigned-rpm');
    expect(installCommand('rpm', '/p/q.rpm', has('rpm'))?.[0]).toBe('/usr/bin/rpm');
  });
  it('elevates with pkexec (graphical agent), not when already root', () => {
    expect(elevate(['/usr/bin/dpkg', '-i', 'x'], '/usr/bin/pkexec', false)).toEqual(['/usr/bin/pkexec', '--disable-internal-agent', '/usr/bin/dpkg', '-i', 'x']);
    expect(elevate(['/usr/bin/dpkg'], null, true)).toEqual(['/usr/bin/dpkg']);
    expect(elevate(['/usr/bin/dpkg'], null, false)).toBeNull();
  });
  it('explains failures', () => {
    expect(describeInstallFailure(126, '')).toMatch(/cancelled/);
    expect(describeInstallFailure(127, '')).toMatch(/polkit/);
    expect(describeInstallFailure(100, 'E: Unable to locate package\nE: dependency problems\n')).toMatch(/dependency problems/);
  });
});

// ---------------------------------------------------------------------------
// UpdateService with Quvrelo's own installers

describe('UpdateService: own installers', () => {
  const zip = Buffer.from('fake mac zip');
  const deb = Buffer.from('fake deb package');
  const msi = Buffer.from('fake msi package');

  beforeEach(() => {
    created.length = 0;
    served.clear();
    hits.length = 0;
  });

  const pol = (p: Partial<Policy> = {}): Policy => ({ ...DEFAULT_POLICY, updateFeedUrl: base, ...p });
  const facts = (f: Partial<PlatformFacts>): PlatformFacts => ({
    platform: 'linux', isPackaged: true, env: {}, packageType: null, nsisUninstallerPresent: false, mas: false, macSigned: null, forceCheck: false, ...f,
  });

  async function service(f: Partial<PlatformFacts>, deps: Partial<InstallDeps>, policy: Partial<Policy> = {}) {
    const { UpdateService } = await import('../../src/main/updates/updater');
    const statuses: string[] = [];
    const quitForUpdate = vi.fn();
    const quit = vi.fn();
    const relaunch = vi.fn();
    const spawned: { cmd: string; args: string[] }[] = [];
    const fakeSpawn = ((cmd: string, args: string[]) => {
      spawned.push({ cmd, args });
      return { unref() {} };
    }) as unknown as typeof spawn;
    const root = tmp('quvrelo-pending-');
    const svc = new UpdateService(
      { policy: pol(policy), e2e: true, getPrefs: async () => ({ autoDownloadUpdates: true, updateChannel: 'stable' }), broadcast: (s) => statuses.push(s.status), requestQuitForUpdate: quitForUpdate },
      { fetch, pendingRoot: root, arch: 'x64', pid: 4242, execPath: '/opt/Quvrelo/quvrelo', macBundle: null, spawn: fakeSpawn, quit, relaunch, isRoot: false, needsAdmin: () => false, ...deps },
    );
    await svc.init(facts(f));
    const settle = async () => {
      for (let i = 0; i < 200 && !['ready', 'error', 'available'].includes(svc.state.status); i++) await new Promise((r) => setTimeout(r, 10));
    };
    return { svc, statuses, quitForUpdate, quit, relaunch, spawned, root, u: created[created.length - 1], settle };
  }

  it('ad-hoc mac: downloads the arch zip, verifies, stages, then swaps on restart and quits', async () => {
    served.set('Quvrelo-0.7.0-mac-x64.zip', zip);
    feedInfo = { version: '0.7.0', files: [{ url: 'Quvrelo-0.7.0-mac-arm64.zip', sha512: sha512(Buffer.from('arm')) }, { url: 'Quvrelo-0.7.0-mac-x64.zip', sha512: sha512(zip) }] };
    const exec: Exec = async (cmd, args) => {
      if (cmd.endsWith('ditto')) fs.mkdirSync(path.join(args[3], 'Quvrelo.app', 'Contents'), { recursive: true });
      if (cmd.endsWith('plutil')) return { code: 0, stdout: args[1] === 'CFBundleIdentifier' ? 'com.quvrelo.app' : '0.7.0', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const t = await service({ platform: 'darwin', macSigned: false, macBundlePath: '/Applications/Quvrelo.app' }, { exec, macBundle: '/Applications/Quvrelo.app' });
    expect(t.svc.state).toMatchObject({ mode: 'auto', action: 'restart', autoInstallOnQuit: true, adminPrompt: false });
    expect(t.u.autoDownload).toBe(false); // electron-updater only checks
    await t.svc.check(true);
    await t.settle();
    expect(t.svc.state.status).toBe('ready');
    expect(t.statuses).toContain('downloading');
    expect(hits).toEqual(['Quvrelo-0.7.0-mac-x64.zip']);
    expect(fs.existsSync(path.join(t.root, '0.7.0', 'staged', 'Quvrelo.app'))).toBe(true);
    t.svc.restart();
    expect(t.quitForUpdate).toHaveBeenCalledOnce();
    expect(t.svc.wantsInstall).toBe(true);
    t.svc.installNow();
    expect(t.spawned).toHaveLength(1);
    expect(t.spawned[0].cmd).toBe('/bin/bash');
    const runner = fs.readFileSync(t.spawned[0].args[0], 'utf8');
    expect(runner).toContain('PID=4242');
    expect(runner).toContain('RELAUNCH=1');
    expect(fs.readFileSync(path.join(t.root, '0.7.0', 'quvrelo-swap.sh'), 'utf8')).toContain("DST='/Applications/Quvrelo.app'");
    expect(t.quit).toHaveBeenCalledOnce();
    t.svc.onQuit(); // already launched: never twice
    expect(t.spawned).toHaveLength(1);
  });

  it('ad-hoc mac: installs on quit without relaunch; never on quit when it needs a password', async () => {
    served.set('Quvrelo-0.7.0-mac-x64.zip', zip);
    feedInfo = { version: '0.7.0', files: [{ url: 'Quvrelo-0.7.0-mac-x64.zip', sha512: sha512(zip) }] };
    const exec: Exec = async (cmd, args) => {
      if (cmd.endsWith('ditto')) fs.mkdirSync(path.join(args[3], 'Quvrelo.app'), { recursive: true });
      if (cmd.endsWith('plutil')) return { code: 0, stdout: args[1] === 'CFBundleIdentifier' ? 'com.quvrelo.app' : '0.7.0', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const a = await service({ platform: 'darwin', macSigned: false }, { exec, macBundle: '/Applications/Quvrelo.app' });
    await a.svc.check(false);
    await a.settle();
    a.svc.onQuit();
    expect(a.spawned).toHaveLength(1);
    expect(fs.readFileSync(a.spawned[0].args[0], 'utf8')).toContain('RELAUNCH=0');

    const b = await service({ platform: 'darwin', macSigned: false }, { exec, macBundle: '/Applications/Quvrelo.app', needsAdmin: () => true });
    expect(b.svc.state).toMatchObject({ adminPrompt: true, autoInstallOnQuit: false });
    await b.svc.check(false);
    await b.settle();
    b.svc.onQuit();
    expect(b.spawned).toHaveLength(0);
    b.svc.restart();
    b.svc.installNow();
    expect(fs.readFileSync(path.join(b.root, '0.7.0', 'quvrelo-update.sh'), 'utf8')).toContain('with administrator privileges');
  });

  it('mac from the disk image / App Translocation: tells the user to move it to Applications', async () => {
    const t = await service({ platform: 'darwin', macSigned: false, macBundlePath: '/Volumes/Quvrelo 0.6.1/Quvrelo.app' }, {});
    expect(t.svc.state).toMatchObject({ mode: 'notify', action: 'open-download' });
    expect(t.svc.state.note).toMatch(/Applications/);
  });

  it('Developer ID signed mac keeps electron-updater (Squirrel.Mac)', async () => {
    const t = await service({ platform: 'darwin', macSigned: true }, {});
    expect(t.u.autoDownload).toBe(true);
    expect(t.u.autoInstallOnAppQuit).toBe(true);
  });

  it('MSI: not in latest.yml → SHA256SUMS.txt; restart runs the elevated msiexec helper and quits', async () => {
    served.set('Quvrelo-0.7.0-x64.msi', msi);
    served.set('SHA256SUMS.txt', Buffer.from(`${sha256(msi)}  Quvrelo-0.7.0-x64.msi\n${'0'.repeat(64)}  Quvrelo-Setup-0.7.0-x64.exe\n`));
    feedInfo = { version: '0.7.0', files: [{ url: 'Quvrelo-Setup-0.7.0-x64.exe', sha512: 'x'.repeat(88) }] };
    const t = await service({ platform: 'win32' }, { execPath: 'C:\\Program Files\\Quvrelo\\Quvrelo.exe' });
    expect(t.u.kind).toBe('nsis');
    expect(t.svc.state).toMatchObject({ installKind: 'msi', mode: 'auto', adminPrompt: true, autoInstallOnQuit: false });
    await t.svc.check(true);
    await t.settle();
    expect(t.svc.state.status).toBe('ready');
    expect(hits).toEqual(['SHA256SUMS.txt', 'Quvrelo-0.7.0-x64.msi']);
    t.svc.restart();
    t.svc.installNow();
    expect(t.spawned[0].cmd).toBe('powershell.exe');
    expect(t.spawned[0].args).toEqual(expect.arrayContaining(['-ExecutionPolicy', 'Bypass', '-File']));
    const ps = fs.readFileSync(t.spawned[0].args[t.spawned[0].args.length - 1], 'utf8');
    expect(ps).toContain('Quvrelo-0.7.0-x64.msi');
    expect(ps).toContain("$exe = 'C:\\Program Files\\Quvrelo\\Quvrelo.exe'");
    expect(t.quit).toHaveBeenCalledOnce();
  });

  it('MSI: listed in latest.yml with sha512 (CI adds it) → no SHA256SUMS request', async () => {
    served.set('Quvrelo-0.7.0-x64.msi', msi);
    feedInfo = { version: '0.7.0', files: [{ url: 'Quvrelo-Setup-0.7.0-x64.exe', sha512: 'x' }, { url: 'Quvrelo-0.7.0-x64.msi', sha512: sha512(msi) }] };
    const t = await service({ platform: 'win32' }, {});
    await t.svc.check(true);
    await t.settle();
    expect(t.svc.state.status).toBe('ready');
    expect(hits).toEqual(['Quvrelo-0.7.0-x64.msi']);
  });

  it('refuses a package without any published checksum', async () => {
    served.set('Quvrelo-0.7.0-x64.msi', msi);
    feedInfo = { version: '0.7.0', files: [{ url: 'Quvrelo-Setup-0.7.0-x64.exe', sha512: 'x' }] };
    const t = await service({ platform: 'win32' }, {});
    await t.svc.check(true);
    await t.settle();
    expect(t.svc.state.status).toBe('error');
    expect(t.svc.state.error).toMatch(/no checksum/);
    expect(hits).not.toContain('Quvrelo-0.7.0-x64.msi');
  });

  it('deb: downloads, a corrupted download is discarded, Try again succeeds, restart installs with pkexec then relaunches', async () => {
    served.set('Quvrelo-0.7.0-amd64.deb', Buffer.from('corrupted'));
    feedInfo = { version: '0.7.0', files: [{ url: 'Quvrelo-0.7.0-x86_64.AppImage', sha512: 'x' }, { url: 'Quvrelo-0.7.0-amd64.deb', sha512: sha512(deb) }] };
    const runs: string[][] = [];
    let installRc = 126;
    const t = await service({ packageType: 'deb' }, {
      which: (c) => (['apt-get', 'pkexec'].includes(c) ? `/usr/bin/${c}` : null),
      runInstall: async (argv) => {
        runs.push(argv);
        return { code: installRc, stderr: '' };
      },
    });
    expect(t.svc.state).toMatchObject({ installKind: 'deb', mode: 'auto', action: 'restart', command: null, adminPrompt: true });
    await t.svc.check(true);
    await t.settle();
    expect(t.svc.state.status).toBe('error');
    expect(t.svc.state.error).toMatch(/integrity check/);

    served.set('Quvrelo-0.7.0-amd64.deb', deb);
    await t.svc.check(true); // "Try again"
    await t.settle();
    expect(t.svc.state.status).toBe('ready');
    const file = path.join(t.root, '0.7.0', 'Quvrelo-0.7.0-amd64.deb');
    expect(fs.readFileSync(file).equals(deb)).toBe(true);

    t.svc.restart(); // user cancels the polkit prompt
    await vi.waitFor(() => expect(t.svc.state.status).toBe('ready'));
    expect(runs[0]).toEqual(['/usr/bin/pkexec', '--disable-internal-agent', '/usr/bin/apt-get', 'install', '-y', '--allow-downgrades', file]);
    expect(t.svc.state.error).toMatch(/cancelled/);
    expect(t.quitForUpdate).not.toHaveBeenCalled();

    installRc = 0;
    t.svc.restart();
    await vi.waitFor(() => expect(t.quitForUpdate).toHaveBeenCalledOnce());
    expect(t.statuses).toContain('installing');
    expect(t.svc.wantsInstall).toBe(true);
    t.svc.installNow();
    expect(t.relaunch).toHaveBeenCalledOnce();
    expect(t.quit).toHaveBeenCalledOnce();
  });

  it('rpm on arm64 picks the aarch64 package; policy autoDownload:false waits for Download', async () => {
    const rpm = Buffer.from('rpm arm');
    served.set('Quvrelo-0.7.0-aarch64.rpm', rpm);
    feedInfo = { version: '0.7.0', files: [{ url: 'Quvrelo-0.7.0-x86_64.rpm', sha512: 'x' }, { url: 'Quvrelo-0.7.0-aarch64.rpm', sha512: sha512(rpm) }] };
    const t = await service({ packageType: 'rpm' }, { arch: 'arm64' }, { autoDownload: false });
    await t.svc.check(true);
    expect(t.svc.state.status).toBe('available');
    expect(hits).toHaveLength(0);
    await t.svc.download();
    await t.settle();
    expect(t.svc.state.status).toBe('ready');
    expect(hits).toEqual(['Quvrelo-0.7.0-aarch64.rpm']);
  });

  it('friendly errors for download failures', async () => {
    const { friendlyUpdateError } = await import('../../src/main/updates/updater');
    expect(friendlyUpdateError(new Error('HttpError: 404 downloading https://x/Quvrelo-0.7.0-amd64.deb'))).toMatch(/could not be downloaded \(the server answered 404\)/);
    expect(friendlyUpdateError(new ChecksumError('x.deb'))).toMatch(/integrity check/);
    expect(friendlyUpdateError(new Error('The downloaded update failed its code signature check: invalid'))).toMatch(/code signature check/);
    expect(friendlyUpdateError(new Error('ENOSPC: no space left on device'))).toMatch(/disk space/);
  });

  it('disableUpdateCheck still wins', async () => {
    const t = await service({ packageType: 'deb' }, {}, { disableUpdateCheck: true });
    expect(created).toHaveLength(0);
    expect(t.svc.state.status).toBe('disabled');
  });
});

describe('release step: MSI entries in latest.yml (scripts/add-msi-update-info.mjs)', () => {
  const yml = `version: 0.7.0
files:
  - url: Quvrelo-Setup-0.7.0-x64.exe
    sha512: AAA==
    size: 100
  - url: Quvrelo-Setup-0.7.0-arm64.exe
    sha512: BBB==
    size: 101
path: Quvrelo-Setup-0.7.0-x64.exe
sha512: AAA==
releaseDate: '2026-10-20T10:00:00.000Z'
`;
  it('appends the MSI files to the files list, keeps everything else, and is idempotent', async () => {
    const { addFileEntries, msiEntries } = await import('../../scripts/add-msi-update-info.mjs');
    const d = tmp();
    const x64 = Buffer.from('msi x64');
    fs.writeFileSync(path.join(d, 'Quvrelo-0.7.0-x64.msi'), x64);
    fs.writeFileSync(path.join(d, 'Quvrelo-0.7.0-arm64.msi'), Buffer.from('msi arm'));
    fs.writeFileSync(path.join(d, 'Quvrelo-0.6.9-x64.msi'), Buffer.from('old'));
    const entries = msiEntries(d, '0.7.0');
    expect(entries.map((e) => e.url)).toEqual(['Quvrelo-0.7.0-arm64.msi', 'Quvrelo-0.7.0-x64.msi']);
    expect(entries[1]).toEqual({ url: 'Quvrelo-0.7.0-x64.msi', sha512: sha512(x64), size: x64.length });
    const out = addFileEntries(yml, entries);
    expect(out).toContain(`  - url: Quvrelo-0.7.0-x64.msi\n    sha512: ${sha512(x64)}\n    size: ${x64.length}\npath: Quvrelo-Setup-0.7.0-x64.exe`);
    expect(out.indexOf('Quvrelo-Setup-0.7.0-arm64.exe')).toBeLessThan(out.indexOf('.msi'));
    expect(out).toContain("releaseDate: '2026-10-20T10:00:00.000Z'");
    expect(addFileEntries(out, entries)).toBe(out);
    // what the app does with it: the MSI with its sha512, picked by arch
    const urls = [...out.matchAll(/- url: (.+)\n\s+sha512: (.+)/g)].map((m) => ({ url: m[1], sha512: m[2] }));
    expect(pickUpdateFile(urls, 'msi', 'x64')).toEqual({ url: 'Quvrelo-0.7.0-x64.msi', sha512: sha512(x64) });
    expect(expectedHashFor(pickUpdateFile(urls, 'msi', 'x64')!, null)).toEqual({ algorithm: 'sha512', base64: sha512(x64) });
  });
});
