/**
 * Text on a path: places each character along a path by arc length. Shared by
 * the canvas renderer, hit/bounds and the SVG exporter (which uses <textPath>
 * but needs the same start offset and overflow rule).
 */
import { flattenPath, pathToSubpaths, subpathsToPath } from './path';
import { reverseSubpath } from './pathEdit';
import type { PathCommand } from './types';
import type { Point } from './geometry';

export interface PlacedGlyph {
  ch: string;
  /** baseline-left of the glyph */
  x: number;
  y: number;
  /** rotation in radians (0 = along +x) */
  angle: number;
  width: number;
}

export interface PathSampler {
  length: number;
  closed: boolean;
  at(s: number): { p: Point; angle: number };
}

/** The path a text-on-path uses: its first subpath, reversed when flipped. */
export function textPathCommands(d: PathCommand[], flip = false): PathCommand[] {
  const subs = pathToSubpaths(d);
  if (!subs.length) return [];
  const first = flip ? reverseSubpath(subs[0]) : subs[0];
  return subpathsToPath([first]);
}

export function samplePath(d: PathCommand[]): PathSampler {
  const poly = flattenPath(d, 32)[0] ?? [];
  const closed = d.some((c) => c[0] === 'Z');
  const lens = [0];
  for (let i = 1; i < poly.length; i++) lens.push(lens[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y));
  const length = lens[lens.length - 1] ?? 0;
  return {
    length,
    closed,
    at(s: number) {
      if (poly.length < 2) return { p: poly[0] ?? { x: 0, y: 0 }, angle: 0 };
      const target = Math.min(length, Math.max(0, s));
      let lo = 1;
      let hi = lens.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (lens[mid] < target) lo = mid + 1;
        else hi = mid;
      }
      const i = lo;
      const a = poly[i - 1];
      const b = poly[i];
      const seg = lens[i] - lens[i - 1] || 1;
      const f = (target - lens[i - 1]) / seg;
      return { p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    },
  };
}

/**
 * Lay `text` along the path. `advance(ch)` is the character's advance width
 * (tracking included). Characters that run past the end of an open path are
 * dropped (overflow); on a closed path the text wraps until it meets its start.
 */
export function layoutTextOnPath(
  text: string, d: PathCommand[], start: number, advance: (ch: string) => number, flip = false,
): { glyphs: PlacedGlyph[]; overflow: boolean; length: number } {
  const path = textPathCommands(d, flip);
  const sampler = samplePath(path);
  const glyphs: PlacedGlyph[] = [];
  const L = sampler.length;
  if (L <= 0) return { glyphs, overflow: text.length > 0, length: 0 };
  let s = Math.min(1, Math.max(0, start)) * L;
  let used = 0;
  let overflow = false;
  for (const ch of Array.from(text.replace(/\n/g, ' '))) {
    const w = advance(ch);
    if (used + w > L + 0.01 || (!sampler.closed && s + w > L + 0.01)) {
      overflow = true;
      break;
    }
    // rotate about the glyph's middle so it sits on the curve
    const mid = sampler.closed ? (s + w / 2) % L : s + w / 2;
    const { p, angle } = sampler.at(mid);
    glyphs.push({ ch, x: p.x - Math.cos(angle) * (w / 2), y: p.y - Math.sin(angle) * (w / 2), angle, width: w });
    s += w;
    used += w;
  }
  return { glyphs, overflow, length: L };
}

/** Rough bounds of laid-out glyphs (each glyph as a box of `ascent` above / `descent` below the baseline). */
export function glyphBounds(glyphs: PlacedGlyph[], ascent: number, descent: number): { x: number; y: number; w: number; h: number } | null {
  if (!glyphs.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const g of glyphs) {
    const c = Math.cos(g.angle);
    const s = Math.sin(g.angle);
    for (const [u, v] of [[0, -ascent], [g.width, -ascent], [0, descent], [g.width, descent]]) {
      const x = g.x + u * c - v * s;
      const y = g.y + u * s + v * c;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
