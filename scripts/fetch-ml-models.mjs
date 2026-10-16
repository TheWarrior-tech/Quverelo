#!/usr/bin/env node
/**
 * Fetch the QuvSelect v1 ONNX models (too big to commit; the repo does not use git LFS) into ml/models/ at
 * build time. They are then bundled into the app by Vite like any local asset: the app never downloads anything.
 *
 *   node scripts/fetch-ml-models.mjs            # CI runs this after `npm ci`
 *
 * Source: the GitHub Release asset named in ml/models/manifest.json (private repo: uses GH_TOKEN / GITHUB_TOKEN).
 * Every file is checked against its sha256. If a model cannot be fetched the build still succeeds: the app falls
 * back to the committed QuvSelect v0 (src/core/ml/models.ts), and this script says so loudly.
 * Set QUVRELO_REQUIRE_ML_MODELS=1 to make a missing model an error (release builds).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'ml', 'models');
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const strict = process.env.QUVRELO_REQUIRE_ML_MODELS === '1';
if (!existsSync(join(dir, 'manifest.json'))) {
  console.warn('ml: WARNING ml/models/manifest.json is missing; the build will use the committed QuvSelect v0 model.');
  process.exit(strict ? 1 : 0);
}
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

async function download(m) {
  const headers = { 'User-Agent': 'quvrelo-build' };
  if (token) headers.Authorization = `Bearer ${token}`;
  // Resolve the asset through the API so private-repo assets work with a token.
  const rel = await fetch(`https://api.github.com/repos/${manifest.repo}/releases/tags/${manifest.releaseTag}`, { headers });
  if (!rel.ok) throw new Error(`release ${manifest.releaseTag}: HTTP ${rel.status}`);
  const asset = (await rel.json()).assets?.find((a) => a.name === m.file);
  if (!asset) throw new Error(`asset ${m.file} not in release ${manifest.releaseTag}`);
  const res = await fetch(asset.url, { headers: { ...headers, Accept: 'application/octet-stream' } });
  if (!res.ok) throw new Error(`${m.file}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

let missing = 0;
for (const m of manifest.models) {
  const p = join(dir, m.file);
  if (existsSync(p) && sha(readFileSync(p)) === m.sha256) {
    console.log(`ml: ${m.file} present (sha256 ok)`);
    continue;
  }
  try {
    const buf = await download(m);
    const got = sha(buf);
    if (got !== m.sha256) throw new Error(`${m.file}: sha256 ${got} != ${m.sha256}`);
    writeFileSync(p + '.part', buf);
    renameSync(p + '.part', p);
    console.log(`ml: fetched ${m.file} (${buf.length} bytes, sha256 ok)`);
  } catch (e) {
    missing++;
    console.warn(`ml: WARNING could not fetch ${m.file}: ${e.message}. The build will use the committed QuvSelect v0 model.`);
  }
}
if (missing && strict) {
  console.error('ml: QUVRELO_REQUIRE_ML_MODELS=1 and models are missing');
  process.exit(1);
}
