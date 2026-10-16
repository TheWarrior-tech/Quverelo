/**
 * Colour profiles Quvrelo ships and the document's colour settings.
 *
 * Every profile is bundled and loaded offline (no network, no system profile
 * lookup), and every one may be redistributed:
 *  - sRGB, Adobe RGB (1998)-compatible and Display P3: the Compact ICC Profiles
 *    by Clinton Ingram, CC0 1.0 (icc/LICENSE-compact-icc.txt).
 *  - The two CMYK press profiles are built by the Quvrelo project with
 *    ArgyllCMS `colprof` from the published characterisation data sets in the
 *    ICC registry (FOGRA39L, ISO 15339-2 CRPC6) and released under CC0 1.0
 *    (icc/README.md, scripts/build-cmyk-profiles.sh). They are not the ECI or
 *    Adobe profiles, whose licences forbid bundling them in an MIT app, but they
 *    describe the same printing conditions, so a PDF/X file names the registered
 *    condition (FOGRA39 / CGATS21_CRPC6) and carries the profile with it.
 */
import type { DocumentSettings } from '../types';

export type RgbProfileId = 'srgb' | 'adobe-rgb' | 'display-p3';
export type CmykProfileId = 'fogra39' | 'crpc6';
export type ProfileId = RgbProfileId | CmykProfileId;
export type RenderingIntent = 'perceptual' | 'relative' | 'saturation' | 'absolute';

export interface PdfxCondition {
  /** OutputConditionIdentifier: the registered characterisation name */
  identifier: string;
  /** OutputCondition: a readable description */
  condition: string;
  registry: string;
  info: string;
}

export interface ProfileInfo {
  id: ProfileId;
  space: 'RGB' | 'CMYK';
  /** name in menus */
  name: string;
  /** short form for chips and the status line */
  short: string;
  /** detail line in menus */
  detail: string;
  /** file name in core/colour/icc */
  file: string;
  pdfx?: PdfxCondition;
}

export const PROFILES: Record<ProfileId, ProfileInfo> = {
  srgb: { id: 'srgb', space: 'RGB', name: 'sRGB', short: 'sRGB', detail: 'Screens and the web', file: 'sRGB-v2-magic.icc' },
  'adobe-rgb': { id: 'adobe-rgb', space: 'RGB', name: 'Adobe RGB (1998)', short: 'Adobe RGB', detail: 'Wide gamut for photo print', file: 'AdobeCompat-v2.icc' },
  'display-p3': { id: 'display-p3', space: 'RGB', name: 'Display P3', short: 'P3', detail: 'Wide-gamut screens', file: 'DisplayP3Compat-v2-magic.icc' },
  fogra39: {
    id: 'fogra39',
    space: 'CMYK',
    name: 'Coated FOGRA39',
    short: 'FOGRA39',
    detail: 'Europe · coated paper (ISO 12647-2)',
    file: 'QuvreloCoatedFOGRA39.icc',
    pdfx: {
      identifier: 'FOGRA39',
      condition: 'Offset printing, according to ISO 12647-2:2004/Amd 1, OFCOM, paper type 1 or 2 = coated art, 115 g/m2, tone value increase curves A (CMY) and B (K)',
      registry: 'http://www.color.org',
      info: 'Coated FOGRA39 (ISO 12647-2:2004)',
    },
  },
  crpc6: {
    id: 'crpc6',
    space: 'CMYK',
    name: 'Premium Coated CRPC6 (GRACoL)',
    short: 'CRPC6',
    detail: 'North America · premium coated (ISO 15339)',
    file: 'QuvreloPremiumCoatedCRPC6.icc',
    pdfx: {
      identifier: 'CGATS21_CRPC6',
      condition: 'ISO/PAS 15339-2 Characterized Reference Printing Condition 6, typical premium coated (GRACoL 2013)',
      registry: 'http://www.color.org',
      info: 'CGATS21-2 CRPC6 (GRACoL 2013)',
    },
  },
};

export const RGB_PROFILES: RgbProfileId[] = ['srgb', 'adobe-rgb', 'display-p3'];
export const CMYK_PROFILES: CmykProfileId[] = ['fogra39', 'crpc6'];

export type ColourMode = 'rgb' | 'cmyk';

/** A document's colour settings (Document setup › Colour). */
export interface DocColour {
  /** CMYK documents pick colours in CMYK, always show the press proof and export CMYK PDF by default */
  mode: ColourMode;
  /** the space the document's RGB colours and pixels are in */
  rgbProfile: RgbProfileId;
  /** the press the document is proofed for and converted to on CMYK export */
  cmykProfile: CmykProfileId;
  /** photo documents can keep 16 bits per channel through import, adjustments and export */
  bitDepth: 8 | 16;
  intent: RenderingIntent;
}

export const DEFAULT_COLOUR: DocColour = { mode: 'rgb', rgbProfile: 'srgb', cmykProfile: 'fogra39', bitDepth: 8, intent: 'relative' };

const isRgb = (v: unknown): v is RgbProfileId => typeof v === 'string' && (RGB_PROFILES as string[]).includes(v);
const isCmyk = (v: unknown): v is CmykProfileId => typeof v === 'string' && (CMYK_PROFILES as string[]).includes(v);

/** The document's colour settings with defaults for anything missing or unknown (old files have none). */
export function docColour(settings: Pick<DocumentSettings, 'colour'> | null | undefined): DocColour {
  const c = settings?.colour;
  if (!c) return DEFAULT_COLOUR;
  return {
    mode: c.mode === 'cmyk' ? 'cmyk' : 'rgb',
    rgbProfile: isRgb(c.rgbProfile) ? c.rgbProfile : DEFAULT_COLOUR.rgbProfile,
    cmykProfile: isCmyk(c.cmykProfile) ? c.cmykProfile : DEFAULT_COLOUR.cmykProfile,
    bitDepth: c.bitDepth === 16 ? 16 : 8,
    intent: (['perceptual', 'relative', 'saturation', 'absolute'] as const).includes(c.intent as RenderingIntent) ? c.intent : DEFAULT_COLOUR.intent,
  };
}

/** "CMYK · FOGRA39", "Adobe RGB · 16-bit": the one-line summary the status line and dialogs show. */
export function colourSummary(c: DocColour): string {
  const space = c.mode === 'cmyk' ? `CMYK · ${PROFILES[c.cmykProfile].short}` : PROFILES[c.rgbProfile].short;
  return c.bitDepth === 16 ? `${space} · 16-bit` : space;
}

export const INTENT_CODE: Record<RenderingIntent, number> = { perceptual: 0, relative: 1, saturation: 2, absolute: 3 };
