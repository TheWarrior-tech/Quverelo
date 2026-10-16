/**
 * ml/models/manifest.json is what scripts/fetch-ml-models.mjs downloads (GitHub Release assets) and checks at build
 * time. Its entries must be models the app knows (src/core/ml/models.ts), and a model that is present locally must be
 * byte-identical to the one the manifest pins.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MODEL_PREFERENCE } from '../../src/core/ml/models';

const DIR = resolve(__dirname, '../../ml/models');
const MANIFEST = resolve(DIR, 'manifest.json');

describe.skipIf(!existsSync(MANIFEST))('QuvSelect v1 model manifest', () => {
  const m = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null;

  it('names a release and pins every model by size and sha256', () => {
    expect(m.repo).toMatch(/^[\w.-]+\/[\w.-]+$/);
    expect(m.releaseTag).toBeTruthy();
    expect(m.models.length).toBeGreaterThan(0);
    for (const e of m.models) {
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(e.bytes).toBeGreaterThan(100_000);
    }
  });

  it('lists only models the app will pick up', () => {
    const known = new Set(MODEL_PREFERENCE.map((p) => p.file));
    for (const e of m.models) expect(known.has(e.file), e.file).toBe(true);
  });

  it('local copies (when present) match the pinned sha256', () => {
    for (const e of m.models) {
      const p = resolve(DIR, e.file);
      if (!existsSync(p)) continue;
      const buf = readFileSync(p);
      expect(buf.length, e.file).toBe(e.bytes);
      expect(createHash('sha256').update(buf).digest('hex'), e.file).toBe(e.sha256);
    }
  });
});
