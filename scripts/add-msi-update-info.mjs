#!/usr/bin/env node
/**
 * Release step: list the MSI packages in the Windows update metadata.
 *
 * electron-builder writes latest.yml (beta.yml, ...) for the NSIS installer only; MSI
 * targets get no update info. Quvrelo's MSI installs update themselves
 * (src/main/updates/msiInstall.ts) and look for their .msi, with its sha512, in the same
 * file. This adds `- url / sha512 / size` entries for every Quvrelo-<version>-<arch>.msi
 * next to a Windows channel file. electron-updater's NSIS updater only picks `.exe`
 * entries, so the extra lines change nothing for NSIS installs. Idempotent.
 * (Without this step the app falls back to the release's SHA256SUMS.txt.)
 *
 * No dependencies (the release job runs it before npm ci).
 *
 *   node scripts/add-msi-update-info.mjs <dir>
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Insert file entries at the end of the `files:` list of a channel file (text in, text out). */
export function addFileEntries(yml, entries) {
  const lines = yml.replace(/\r\n/g, '\n').split('\n');
  const listed = new Set([...yml.matchAll(/^\s*-\s*url:\s*(.+)$/gm)].map((m) => m[1].trim().replace(/^['"]|['"]$/g, '')));
  const add = entries.filter((e) => !listed.has(e.url));
  if (!add.length) return yml;
  const block = add.flatMap((e) => [`  - url: ${e.url}`, `    sha512: ${e.sha512}`, `    size: ${e.size}`]);
  const start = lines.findIndex((l) => /^files:\s*$/.test(l));
  if (start < 0) {
    // no list yet: add one after "version:"
    const v = lines.findIndex((l) => /^version:/.test(l));
    lines.splice(v + 1, 0, 'files:', ...block);
    return lines.join('\n');
  }
  let end = start + 1;
  while (end < lines.length && (/^\s+\S/.test(lines[end]) || lines[end] === '')) {
    if (lines[end] === '' && (end + 1 >= lines.length || /^\S/.test(lines[end + 1]))) break;
    end++;
  }
  lines.splice(end, 0, ...block);
  return lines.join('\n');
}

export function msiEntries(dir, version, names = readdirSync(dir)) {
  const re = new RegExp(`^Quvrelo-${version.replace(/[.+]/g, '\\$&')}-[^/]+\\.msi$`);
  return names
    .filter((n) => re.test(n))
    .sort()
    .map((n) => {
      const file = path.join(dir, n);
      return { url: n, sha512: createHash('sha512').update(readFileSync(file)).digest('base64'), size: statSync(file).size };
    });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dir = process.argv[2] ?? 'release';
  let changed = 0;
  for (const name of readdirSync(dir).filter((n) => /^(latest|beta|alpha)\.yml$/.test(n))) {
    const p = path.join(dir, name);
    const text = readFileSync(p, 'utf8');
    const version = /^version:\s*['"]?([^'"\s]+)/m.exec(text)?.[1];
    if (!version) continue;
    const entries = msiEntries(dir, version);
    const next = addFileEntries(text, entries);
    if (next !== text) {
      writeFileSync(p, next);
      changed++;
      console.log(`${name}: added ${entries.map((e) => e.url).join(', ')}`);
    } else console.log(`${name}: ${entries.length ? 'MSI already listed' : 'no MSI for this version'}`);
  }
  console.log(changed ? `updated ${changed} channel file(s)` : 'nothing to change');
}
