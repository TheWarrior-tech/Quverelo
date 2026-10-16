#!/usr/bin/env node
/**
 * Put the QuvSelect v1 ONNX models (too big for the main history; the repo does not use git LFS) into ml/models/ at
 * build time. Vite then bundles them like any local asset: the app never downloads anything at runtime.
 *
 *   node scripts/fetch-ml-models.mjs            # CI runs this after `npm ci`, before typecheck/test/build/package
 *
 * The weights live on the orphan branch `ml-models` (see its README). Sources, in order, for each model in
 * ml/models/manifest.json:
 *   1. ml/models/<file> already present
 *   2. a checkout of the branch in ./ml-models/ (CI: actions/checkout with ref: ml-models, path: ml-models),
 *      or the directory in QUVRELO_ML_MODELS_DIR
 *   3. the git object origin/ml-models:<file> (a dev clone; `git fetch origin ml-models` is attempted first)
 * Every file is checked against the manifest's byte size and sha256 before it is written; a mismatch is always an
 * error. Without QUVRELO_REQUIRE_ML_MODELS=1 a model that cannot be found is a loud warning and the app falls back to
 * the committed QuvSelect v0 (src/core/ml/models.ts). CI sets QUVRELO_REQUIRE_ML_MODELS=1 so a release can never
 * ship without v1.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'ml', 'models');
const strict = process.env.QUVRELO_REQUIRE_ML_MODELS === '1';
const srcDir = resolve(root, process.env.QUVRELO_ML_MODELS_DIR || 'ml-models');
const BRANCH = 'ml-models';

if (!existsSync(join(dir, 'manifest.json'))) {
  console.warn('ml: WARNING ml/models/manifest.json is missing; the build will use the committed QuvSelect v0 model.');
  process.exit(strict ? 1 : 0);
}
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const ok = (buf, m) => buf.length === m.bytes && sha(buf) === m.sha256;

let fetchedBranch = false;
function fromGit(file) {
  const git = (...a) => execFileSync('git', a, { cwd: root, maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] });
  const ref = `refs/remotes/origin/${BRANCH}`;
  if (!fetchedBranch) {
    fetchedBranch = true;
    try {
      git('fetch', '--quiet', '--depth=1', 'origin', `+refs/heads/${BRANCH}:${ref}`);
    } catch {
      /* offline or no remote: use whatever ref is already there */
    }
  }
  try {
    return git('show', `${ref}:${file}`);
  } catch {
    return null;
  }
}

let missing = 0;
let bad = 0;
for (const m of manifest.models) {
  const p = join(dir, m.file);
  if (existsSync(p) && ok(readFileSync(p), m)) {
    console.log(`ml: ${m.file} present (sha256 ok)`);
    continue;
  }
  const candidates = [];
  if (existsSync(join(srcDir, m.file))) candidates.push([`${srcDir}/${m.file}`, () => readFileSync(join(srcDir, m.file))]);
  candidates.push([`git ${BRANCH}:${m.file}`, () => fromGit(m.file)]);
  let done = false;
  for (const [label, get] of candidates) {
    const buf = get();
    if (!buf) continue;
    if (!ok(buf, m)) {
      bad++;
      console.error(`ml: ERROR ${label}: ${buf.length} bytes, sha256 ${sha(buf)}; manifest pins ${m.bytes} bytes, ${m.sha256}`);
      continue;
    }
    writeFileSync(p + '.part', buf);
    renameSync(p + '.part', p);
    console.log(`ml: ${m.file} from ${label} (${buf.length} bytes, sha256 ok)`);
    done = true;
    break;
  }
  if (!done) {
    missing++;
    console.warn(`ml: WARNING ${m.file} not found (looked in ${srcDir} and git ${BRANCH}). The build will use QuvSelect v0.`);
  }
}
if (bad) {
  console.error('ml: a model did not match the sha256 pinned in ml/models/manifest.json');
  process.exit(1);
}
if (missing && strict) {
  console.error('ml: QUVRELO_REQUIRE_ML_MODELS=1 and models are missing');
  process.exit(1);
}
