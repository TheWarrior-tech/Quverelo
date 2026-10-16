/**
 * OpenType features on the canvas. Canvas 2D has no font-feature-settings,
 * but Chromium honours the FontFace `featureSettings` descriptor, so for each
 * (bundled face, feature set) we register an alias family loaded from the same
 * offline font file with those features on. Text drawn and measured with the
 * alias is shaped by HarfBuzz with real ligatures, old-style / tabular figures
 * and so on. System and installed fonts keep the canvas defaults (kerning and
 * small caps still work through the context properties).
 */
import { bundledFaceFor } from '../../core/pdfFonts';
import { featureSettings } from '../../core/otFeatures';
import type { TextStyle } from '../../core/types';
import { fontUrl } from './pdfFontFiles';

interface Alias {
  name: string;
  ready: boolean;
  failed?: boolean;
}

const aliases = new Map<string, Alias>();
const listeners = new Set<() => void>();
let notifyTimer: number | null = null;

/** Called (debounced) when an alias font finishes loading: re-measure and redraw. */
export function onFeatureFontsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  if (notifyTimer !== null) return;
  notifyTimer = window.setTimeout(() => {
    notifyTimer = null;
    for (const l of listeners) l();
  }, 16);
}

/** Whether the style asks for features the canvas can only get through an alias face. */
export function needsFeatureFace(style: TextStyle): boolean {
  return featureSettings(style) !== '';
}

/** The font-family list to draw a style with (alias first once it has loaded). */
export function familyFor(style: TextStyle): string {
  const fs = featureSettings(style);
  if (!fs || typeof document === 'undefined' || typeof FontFace === 'undefined') return style.fontFamily;
  const face = bundledFaceFor(style);
  if (!face) return style.fontFamily;
  const key = `${face.pkg}/${face.file}|${fs}`;
  let a = aliases.get(key);
  if (!a) {
    a = { name: `qvot${aliases.size}`, ready: false };
    aliases.set(key, a);
    const alias = a;
    const url = fontUrl(`${face.pkg}/${face.file}`);
    if (url) {
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((buf) => new FontFace(alias.name, buf, { weight: String(face.weight), featureSettings: fs } as FontFaceDescriptors).load())
        .then((ff) => {
          document.fonts.add(ff);
          alias.ready = true;
          notify();
        })
        .catch(() => {
          alias.failed = true; // keep the plain face
        });
    } else alias.failed = true;
  }
  return a.ready ? `"${a.name}", ${style.fontFamily}` : style.fontFamily;
}

/** Resolve once every alias requested so far has loaded (tests, export). */
export async function featureFontsSettled(timeoutMs = 3000): Promise<void> {
  const t0 = Date.now();
  while ([...aliases.values()].some((a) => !a.ready && !a.failed) && Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 25));
  }
}
