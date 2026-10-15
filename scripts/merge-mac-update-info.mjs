#!/usr/bin/env node
/**
 * CI builds macOS x64 and arm64 in two electron-builder runs (so the two .pkg builds
 * don't collide). Each run writes release/latest-mac.yml listing only its own arch,
 * and the second overwrites the first. This merges them so one latest-mac.yml lists
 * the x64 and arm64 .zip/.dmg files; electron-updater's MacUpdater picks by arch.
 *
 *   node scripts/merge-mac-update-info.mjs <first.yml> <second.yml> <out.yml>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml'); // dependency of electron-updater / electron-builder

const [a, b, out] = process.argv.slice(2);
if (!a || !b || !out) {
  console.error('usage: merge-mac-update-info.mjs <first.yml> <second.yml> <out.yml>');
  process.exit(2);
}
const opts = { schema: yaml.CORE_SCHEMA }; // keep releaseDate a string
const A = yaml.load(readFileSync(a, 'utf8'), opts);
const B = yaml.load(readFileSync(b, 'utf8'), opts);
if (A.version !== B.version) {
  console.error(`version mismatch: ${a} has ${A.version}, ${b} has ${B.version}`);
  process.exit(1);
}
const seen = new Set();
const files = [...(A.files ?? []), ...(B.files ?? [])].filter((f) => (seen.has(f.url) ? false : (seen.add(f.url), true)));
const merged = {
  ...B,
  ...A, // legacy top-level path/sha512 stay on the first (x64) build
  files,
  releaseDate: [A.releaseDate, B.releaseDate].filter(Boolean).sort().pop(),
};
writeFileSync(out, yaml.dump(merged, { lineWidth: 8000 }));
console.log(`merged ${files.length} files into ${out}:`);
for (const f of files) console.log(`  ${f.url}`);
