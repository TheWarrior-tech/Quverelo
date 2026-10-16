/**
 * The app's colour engine (lcms2 wasm + bundled profiles), loaded on first use,
 * and the viewport's display lookup table: soft proof, gamut warning, and the
 * conversion that shows Adobe RGB / Display P3 documents correctly on screen.
 * Everything is bundled; nothing is fetched from the network.
 */
import { ColourEngine } from '../../core/colour/cms';
import { docColour, PROFILES, type DocColour, type ProfileId } from '../../core/colour/profiles';
import type { Lut3D } from '../../core/colour/lut3d';
import type { QuvreloDocument } from '../../core/types';
import { setCmykConverter } from '../ui/color/colorMath';
import { instantiate } from '../../vendor/lcms/lcms.js';
import wasmUrl from '../../vendor/lcms/lcms.wasm?url';
import srgbUrl from '../../core/colour/icc/sRGB-v2-magic.icc?url';
import adobeUrl from '../../core/colour/icc/AdobeCompat-v2.icc?url';
import p3Url from '../../core/colour/icc/DisplayP3Compat-v2-magic.icc?url';
import fograUrl from '../../core/colour/icc/QuvreloCoatedFOGRA39.icc?url';
import crpcUrl from '../../core/colour/icc/QuvreloPremiumCoatedCRPC6.icc?url';

const URLS: Record<ProfileId, string> = { srgb: srgbUrl, 'adobe-rgb': adobeUrl, 'display-p3': p3Url, fogra39: fograUrl, crpc6: crpcUrl };

async function bytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}

let loading: Promise<ColourEngine> | null = null;
let ready: ColourEngine | null = null;
const waiters = new Set<() => void>();

/** The colour engine, loading it the first time (about 0.8 MB of wasm and profiles, all local). */
export function loadColourEngine(): Promise<ColourEngine> {
  loading ??= ColourEngine.create({
    profile: (id) => bytes(URLS[id]),
    instantiate: async () => instantiate({ wasmBinary: await bytes(wasmUrl) }),
  }).then((e) => {
    ready = e;
    for (const w of waiters) w();
    waiters.clear();
    return e;
  });
  return loading;
}

/** The engine if it has loaded, else null (and start loading it). */
export function colourEngine(): ColourEngine | null {
  if (!ready) void loadColourEngine().catch((e) => console.warn('Colour engine failed to load', e));
  return ready;
}

/** Run `fn` once the engine is ready (immediately if it is). */
export function whenColourReady(fn: () => void): void {
  if (ready) fn();
  else {
    waiters.add(fn);
    colourEngine();
  }
}

export interface ViewColour {
  proof: boolean;
  gamut: boolean;
}

/** Proofing is always on for CMYK documents; RGB documents proof on request. */
export function viewColour(doc: QuvreloDocument | null, ui: { softProof: boolean; gamutWarning: boolean }): ViewColour & { colour: DocColour } {
  const colour = docColour(doc?.settings);
  const proof = colour.mode === 'cmyk' || ui.softProof;
  return { colour, proof, gamut: ui.gamutWarning };
}

const lutCache = new Map<string, Lut3D>();

/**
 * The lookup table the viewport maps the page through, or null when the screen
 * shows the document as is (sRGB, no proof, no gamut warning) or the engine is
 * still loading (`onReady` is called when it has).
 */
export function displayLut(doc: QuvreloDocument | null, ui: { softProof: boolean; gamutWarning: boolean }, onReady?: () => void): Lut3D | null {
  const v = viewColour(doc, ui);
  if (!v.proof && !v.gamut && v.colour.rgbProfile === 'srgb') return null;
  const e = colourEngine();
  if (!e) {
    if (onReady) whenColourReady(onReady);
    return null;
  }
  const key = `${v.colour.rgbProfile}|${v.colour.cmykProfile}|${v.proof}|${v.gamut}|${v.colour.intent}`;
  let lut = lutCache.get(key);
  if (!lut) {
    lut = e.displayLut({ rgbProfile: v.colour.rgbProfile, cmykProfile: v.colour.cmykProfile, proof: v.proof, gamut: v.gamut, intent: v.colour.intent });
    lutCache.set(key, lut);
  }
  return lut;
}

/** "Soft proof · Coated FOGRA39" etc. for tooltips. */
export function proofLabel(doc: QuvreloDocument | null): string {
  return `Soft proof · ${PROFILES[docColour(doc?.settings).cmykProfile].name}`;
}

/**
 * The colour picker's CMYK fields use the document's CMYK profile (ICC, relative
 * colorimetric with black point compensation) once the engine has loaded.
 */
export function installPickerCmyk(getDoc: () => QuvreloDocument | null): void {
  setCmykConverter(() => {
    const e = colourEngine();
    if (!e) return null;
    const c = docColour(getDoc()?.settings);
    return {
      name: PROFILES[c.cmykProfile].name,
      toCmyk: (rgb) => e.rgbToCmyk([rgb.r / 255, rgb.g / 255, rgb.b / 255], c.rgbProfile, c.cmykProfile, { intent: 'relative', bpc: true }),
      toRgb: (cc, m, y, k) => {
        const [r, g, b] = e.cmykToRgb([cc, m, y, k], c.cmykProfile, c.rgbProfile);
        return { r: r * 255, g: g * 255, b: b * 255 };
      },
    };
  });
}

const profileCache = new Map<ProfileId, Promise<Uint8Array>>();
/** A bundled profile's bytes (for embedding in PNG / JPEG exports), without loading the engine. */
export function profileFileBytes(id: ProfileId): Promise<Uint8Array> {
  let p = profileCache.get(id);
  if (!p) {
    p = bytes(URLS[id]);
    profileCache.set(id, p);
  }
  return p;
}
