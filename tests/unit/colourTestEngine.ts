/** Loads the real colour engine (lcms2 wasm + the bundled profiles) in Node for tests. */
import { readFileSync } from 'node:fs';
import { ColourEngine } from '../../src/core/colour/cms';
import { PROFILES, type ProfileId } from '../../src/core/colour/profiles';
import { instantiate } from '../../src/vendor/lcms/lcms.js';

let engine: Promise<ColourEngine> | null = null;

export function profileFile(id: ProfileId): Uint8Array {
  return new Uint8Array(readFileSync(`src/core/colour/icc/${PROFILES[id].file}`));
}

export function testEngine(): Promise<ColourEngine> {
  engine ??= ColourEngine.create({
    wasmBinary: new Uint8Array(readFileSync('src/vendor/lcms/lcms.wasm')),
    profile: profileFile,
    instantiate,
  });
  return engine;
}
