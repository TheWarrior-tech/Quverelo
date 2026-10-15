/**
 * URLs of the bundled font files the vector PDF embeds (Vite copies them as
 * local assets; nothing is fetched from the network). Keys are
 * "<package>/<file>" as produced by core/pdfFonts.ts; keep in step with the
 * faces main.tsx loads.
 */
import inter_400 from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
import inter_500 from '@fontsource/inter/files/inter-latin-500-normal.woff?url';
import inter_600 from '@fontsource/inter/files/inter-latin-600-normal.woff?url';
import inter_700 from '@fontsource/inter/files/inter-latin-700-normal.woff?url';
import inter_800 from '@fontsource/inter/files/inter-latin-800-normal.woff?url';
import atkinson_hyperlegible_400 from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff?url';
import atkinson_hyperlegible_700 from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff?url';
import opendyslexic_400 from '@fontsource/opendyslexic/files/opendyslexic-latin-400-normal.woff?url';
import opendyslexic_700 from '@fontsource/opendyslexic/files/opendyslexic-latin-700-normal.woff?url';
import merriweather_400 from '@fontsource/merriweather/files/merriweather-latin-400-normal.woff?url';
import merriweather_700 from '@fontsource/merriweather/files/merriweather-latin-700-normal.woff?url';
import roboto_slab_400 from '@fontsource/roboto-slab/files/roboto-slab-latin-400-normal.woff?url';
import roboto_slab_700 from '@fontsource/roboto-slab/files/roboto-slab-latin-700-normal.woff?url';
import caveat_400 from '@fontsource/caveat/files/caveat-latin-400-normal.woff?url';
import caveat_700 from '@fontsource/caveat/files/caveat-latin-700-normal.woff?url';

const FILES: Record<string, string> = {
  'inter/files/inter-latin-400-normal.woff': inter_400,
  'inter/files/inter-latin-500-normal.woff': inter_500,
  'inter/files/inter-latin-600-normal.woff': inter_600,
  'inter/files/inter-latin-700-normal.woff': inter_700,
  'inter/files/inter-latin-800-normal.woff': inter_800,
  'atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff': atkinson_hyperlegible_400,
  'atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff': atkinson_hyperlegible_700,
  'opendyslexic/files/opendyslexic-latin-400-normal.woff': opendyslexic_400,
  'opendyslexic/files/opendyslexic-latin-700-normal.woff': opendyslexic_700,
  'merriweather/files/merriweather-latin-400-normal.woff': merriweather_400,
  'merriweather/files/merriweather-latin-700-normal.woff': merriweather_700,
  'roboto-slab/files/roboto-slab-latin-400-normal.woff': roboto_slab_400,
  'roboto-slab/files/roboto-slab-latin-700-normal.woff': roboto_slab_700,
  'caveat/files/caveat-latin-400-normal.woff': caveat_400,
  'caveat/files/caveat-latin-700-normal.woff': caveat_700,
};

export function fontUrl(key: string): string | null {
  return FILES[key] ?? null;
}
