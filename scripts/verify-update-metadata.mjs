#!/usr/bin/env node
/**
 * Release gate: every platform that can auto-update must ship its update metadata,
 * and every file it references (plus the .blockmap for delta downloads) must be in
 * the release. No dependencies (runs before npm ci).
 *
 *   node scripts/verify-update-metadata.mjs <dir>
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

const dir = process.argv[2] ?? 'release';
const names = readdirSync(dir);
const errors = [];

// stable releases ship latest*.yml; beta tags ship beta*.yml
const channelOf = (prefix) => names.find((n) => new RegExp(`^(latest|beta|alpha)${prefix}\\.yml$`).test(n));
const required = [
  { label: 'Windows (NSIS)', file: channelOf(''), deltaExt: ['.exe'] },
  { label: 'macOS (zip for Squirrel.Mac)', file: channelOf('-mac'), deltaExt: ['.zip'], mustContain: '.zip' },
  { label: 'Linux (AppImage)', file: channelOf('-linux'), deltaExt: ['.AppImage'], mustContain: '.AppImage' },
];

for (const r of required) {
  if (!r.file) {
    errors.push(`${r.label}: no update metadata (latest*.yml) in ${dir}`);
    continue;
  }
  const text = readFileSync(path.join(dir, r.file), 'utf8');
  const version = /^version:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const urls = [...text.matchAll(/^\s*-\s*url:\s*(.+)$/gm)].map((m) => m[1].trim().replace(/^['"]|['"]$/g, ''));
  if (!version) errors.push(`${r.file}: no version`);
  if (!urls.length) errors.push(`${r.file}: lists no files`);
  if (!/sha512:/.test(text)) errors.push(`${r.file}: no sha512`);
  if (r.mustContain && !urls.some((u) => u.endsWith(r.mustContain))) errors.push(`${r.file}: no ${r.mustContain} listed`);
  for (const u of urls) {
    if (!existsSync(path.join(dir, u))) errors.push(`${r.file}: references ${u}, which is not in the release`);
    if (r.deltaExt.some((e) => u.endsWith(e)) && !existsSync(path.join(dir, `${u}.blockmap`)) && !u.endsWith('.AppImage')) {
      // AppImage embeds its blockmap; NSIS and mac zip need the sidecar .blockmap
      errors.push(`${r.file}: ${u}.blockmap missing (delta updates)`);
    }
  }
  console.log(`${r.label}: ${r.file} v${version} -> ${urls.join(', ')}`);
}

if (errors.length) {
  console.error('\nUpdate metadata check failed:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('\nUpdate metadata OK');
