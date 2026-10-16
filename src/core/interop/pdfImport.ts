/**
 * Adobe Illustrator (.ai, PDF-compatible) and PDF import with editable vectors.
 *
 * Illustrator has saved a full PDF inside every .ai file by default since CS
 * ("Create PDF Compatible File"). We read that PDF with pdf-lib (MIT, bundled)
 * and interpret the page content streams ourselves:
 *  - paths (m l c v y h re) filled/stroked -> editable path nodes, with fill and
 *    stroke colour (Gray/RGB/CMYK/ICC by component count), width, caps, joins,
 *    dashes and opacity / blend mode from ExtGState
 *  - clipping paths (W/W*) -> node masks (the most recent clip)
 *  - Illustrator layers (optional content, /OC BDC…EMC) -> named groups,
 *    hidden layers stay hidden
 *  - text (BT…ET, Tj/TJ/'/") -> editable artistic text, decoded through the
 *    font's ToUnicode map when it has one
 *  - images (JPEG kept as-is; 8-bit Flate RGB/Gray with soft masks decoded)
 *  - form XObjects are expanded in place
 * Gradients/patterns/shadings become a flat colour and are reported.
 * Native Illustrator data (PieceInfo) and PostScript-only .ai files are not read.
 */
import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString,
  decodePDFRawStream, type PDFObject, type PDFPage,
} from 'pdf-lib';
import { createDocument, defaultTextStyle, make, makeStroke, NO_PAINT, solid } from '../document';
import { composeTransform, decompose, invert, multiply, type Matrix } from '../geometry';
import { newId } from '../ids';
import { centrePath, transformPath } from '../path';
import { lineHeightPx } from '../textflow';
import type { PathCommand, SceneNode, Stroke, BlendMode } from '../types';
import { cmykToHex, grayHex, rgbHex } from './color';
import { fontFromPostScript } from './psd';
import { emptyResult, summariseWarnings, type ImportResult } from './types';

export const PX_PER_PT = 96 / 72;

// ---------------------------------------------------------------------------
// Content stream lexer

type Tok =
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  | { t: 'str'; v: string } // bytes as latin1
  | { t: 'arr'; v: Tok[] }
  | { t: 'dict'; v: Record<string, Tok> }
  | { t: 'op'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'null' };

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

export class Lexer {
  i = 0;
  constructor(private b: Uint8Array) {}

  private skipWs() {
    const b = this.b;
    for (;;) {
      while (this.i < b.length && WS.has(b[this.i])) this.i++;
      if (b[this.i] === 37) { // % comment
        while (this.i < b.length && b[this.i] !== 10 && b[this.i] !== 13) this.i++;
        continue;
      }
      return;
    }
  }

  next(): Tok | null {
    this.skipWs();
    const b = this.b;
    if (this.i >= b.length) return null;
    const c = b[this.i];
    if (c === 47) { // /name
      let j = ++this.i;
      while (j < b.length && !WS.has(b[j]) && !DELIM.has(b[j])) j++;
      const raw = latin1(b, this.i, j);
      this.i = j;
      return { t: 'name', v: raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) };
    }
    if (c === 40) return { t: 'str', v: this.literal() };
    if (c === 60 && b[this.i + 1] === 60) {
      this.i += 2;
      const v: Record<string, Tok> = {};
      for (;;) {
        this.skipWs();
        if (b[this.i] === 62 && b[this.i + 1] === 62) { this.i += 2; break; }
        const k = this.next();
        if (!k) break;
        const val = this.next();
        if (k.t === 'name' && val) v[k.v] = val;
      }
      return { t: 'dict', v };
    }
    if (c === 60) {
      const j = b.indexOf(62, this.i);
      const hex = latin1(b, this.i + 1, j < 0 ? b.length : j).replace(/\s+/g, '');
      this.i = j < 0 ? b.length : j + 1;
      let s = '';
      for (let k = 0; k < hex.length; k += 2) s += String.fromCharCode(parseInt((hex.slice(k, k + 2) + '0').slice(0, 2), 16));
      return { t: 'str', v: s };
    }
    if (c === 91) {
      this.i++;
      const v: Tok[] = [];
      for (;;) {
        this.skipWs();
        if (b[this.i] === 93) { this.i++; break; }
        const x = this.next();
        if (!x) break;
        v.push(x);
      }
      return { t: 'arr', v };
    }
    if (c === 93 || c === 62 || c === 41 || c === 123 || c === 125) { this.i++; return this.next(); }
    let j = this.i;
    while (j < b.length && !WS.has(b[j]) && !DELIM.has(b[j])) j++;
    if (j === this.i) j++;
    const word = latin1(b, this.i, j);
    this.i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: 'num', v: parseFloat(word) };
    if (word === 'true' || word === 'false') return { t: 'bool', v: word === 'true' };
    if (word === 'null') return { t: 'null' };
    return { t: 'op', v: word };
  }

  private literal(): string {
    const b = this.b;
    this.i++;
    let depth = 1;
    let s = '';
    while (this.i < b.length) {
      const c = b[this.i++];
      if (c === 92) { // backslash
        const n = b[this.i++];
        const map: Record<number, string> = { 110: '\n', 114: '\r', 116: '\t', 98: '\b', 102: '\f', 40: '(', 41: ')', 92: '\\' };
        if (map[n] !== undefined) s += map[n];
        else if (n >= 48 && n <= 55) {
          let o = n - 48;
          for (let k = 0; k < 2 && b[this.i] >= 48 && b[this.i] <= 55; k++) o = o * 8 + (b[this.i++] - 48);
          s += String.fromCharCode(o & 255);
        } else if (n === 13) { if (b[this.i] === 10) this.i++; } else if (n !== 10) s += String.fromCharCode(n);
        continue;
      }
      if (c === 40) depth++;
      if (c === 41 && --depth === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }

  /** Skip inline image data after ID up to EI. */
  skipInlineImage() {
    const b = this.b;
    this.i++;
    while (this.i < b.length - 2) {
      if (b[this.i] === 69 && b[this.i + 1] === 73 && (WS.has(b[this.i + 2]) || this.i + 2 === b.length) && WS.has(b[this.i - 1])) { this.i += 2; return; }
      this.i++;
    }
    this.i = b.length;
  }
}

function latin1(b: Uint8Array, s: number, e: number): string {
  let out = '';
  for (let i = s; i < e; i += 8192) out += String.fromCharCode(...b.subarray(i, Math.min(e, i + 8192)));
  return out;
}

// ---------------------------------------------------------------------------
// Fonts

/** Parse bfchar/bfrange from a ToUnicode CMap. */
export function parseToUnicode(text: string): { map: Map<number, string>; bytes: number } {
  const map = new Map<number, string>();
  let bytes = 1;
  const hexToStr = (h: string) => {
    let s = '';
    for (let i = 0; i + 4 <= h.length; i += 4) s += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
    if (h.length % 4 === 2) s += String.fromCharCode(parseInt(h.slice(-2), 16));
    return s;
  };
  const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
  if (cs) {
    const m = /<([0-9a-fA-F]+)>/.exec(cs[1]);
    if (m) bytes = m[1].length / 2;
  }
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), hexToStr(m[2]));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      if (m[4] !== undefined) {
        const start = hexToStr(m[4]);
        const last = start.charCodeAt(start.length - 1);
        for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, start.slice(0, -1) + String.fromCharCode(last + c - lo));
      } else {
        const items = [...(m[5] ?? '').matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => hexToStr(x[1]));
        items.forEach((s, k) => map.set(lo + k, s));
      }
    }
  }
  return { map, bytes };
}

// Windows-1252 differences from Latin-1 in 0x80..0x9F
const CP1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x2c6, 0x89: 0x2030,
  0x8a: 0x160, 0x8b: 0x2039, 0x8c: 0x152, 0x8e: 0x17d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x2dc, 0x99: 0x2122, 0x9a: 0x161, 0x9b: 0x203a, 0x9c: 0x153, 0x9e: 0x17e, 0x9f: 0x178,
};

interface FontInfo {
  family: string;
  weight: number;
  italic: boolean;
  bytes: number;
  toUnicode: Map<number, string> | null;
  widths: (code: number) => number; // glyph space /1000
}

// ---------------------------------------------------------------------------
// Interpreter

interface GState {
  ctm: Matrix;
  fill: string | null;
  stroke: string | null;
  fillAlpha: number;
  strokeAlpha: number;
  blend: BlendMode;
  lineWidth: number;
  cap: Stroke['cap'];
  join: Stroke['join'];
  dash: number[];
  clip: PathCommand[] | null;
  // text state
  font: FontInfo | null;
  fontSize: number;
  charSpace: number;
  wordSpace: number;
  hScale: number;
  leading: number;
  rise: number;
}

const BLENDS: Record<string, BlendMode> = {
  Normal: 'normal', Compatible: 'normal', Multiply: 'multiply', Screen: 'screen', Overlay: 'overlay', Darken: 'darken', Lighten: 'lighten',
  ColorDodge: 'color-dodge', ColorBurn: 'color-burn', HardLight: 'hard-light', SoftLight: 'soft-light', Difference: 'difference',
  Exclusion: 'exclusion', Hue: 'hue', Saturation: 'saturation', Color: 'color', Luminosity: 'luminosity',
};

/** cat(a, b): apply a, then b (PDF row-vector order). */
const cat = (a: Matrix, b: Matrix): Matrix => multiply(b, a);
const ap = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

interface Layer { name: string; visible: boolean; nodes: SceneNode[] }

class Interpreter {
  warnings: string[] = [];
  private fonts = new Map<PDFObject, FontInfo>();
  constructor(private pdf: PDFDocument, private out: ImportResult, private hiddenOcgs: Set<PDFRef | PDFObject>) {}

  private lookup<T extends PDFObject>(o: PDFObject | undefined, type?: Function & { prototype: T }): T | undefined {
    if (!o) return undefined;
    const v = o instanceof PDFRef ? this.pdf.context.lookup(o) : o;
    if (type && !(v instanceof type)) return undefined;
    return v as T;
  }

  private dictGet<T extends PDFObject>(d: PDFDict | undefined, key: string, type?: Function & { prototype: T }): T | undefined {
    return d ? this.lookup(d.get(PDFName.of(key)), type) : undefined;
  }

  private num(o: PDFObject | undefined): number | undefined {
    const v = this.lookup(o);
    return v instanceof PDFNumber ? v.asNumber() : undefined;
  }

  streamBytes(s: PDFStream): Uint8Array {
    if (s instanceof PDFRawStream) {
      const filter = s.dict.get(PDFName.of('Filter'));
      if (!filter) return s.contents;
      return decodePDFRawStream(s).decode();
    }
    return (s as unknown as { getContents(): Uint8Array }).getContents();
  }

  private font(resources: PDFDict | undefined, name: string): FontInfo | null {
    const fontDict = this.dictGet(this.dictGet(resources, 'Font', PDFDict), name, PDFDict);
    if (!fontDict) return null;
    const hit = this.fonts.get(fontDict);
    if (hit) return hit;
    const base = (this.dictGet(fontDict, 'BaseFont', PDFName)?.asString() ?? '/Helvetica').slice(1).replace(/^[A-Z]{6}\+/, '');
    const f = fontFromPostScript(base);
    const subtype = this.dictGet(fontDict, 'Subtype', PDFName)?.asString();
    let toUnicode: Map<number, string> | null = null;
    let bytes = subtype === '/Type0' ? 2 : 1;
    const tu = this.dictGet(fontDict, 'ToUnicode', PDFStream);
    if (tu) {
      try {
        const tb = this.streamBytes(tu);
        const parsed = parseToUnicode(latin1(tb, 0, tb.length));
        toUnicode = parsed.map;
        if (subtype === '/Type0') bytes = parsed.bytes;
      } catch {
        /* ignore broken cmap */
      }
    }
    let widths: (c: number) => number = () => 0.5;
    if (subtype === '/Type0') {
      const desc = this.lookup(this.dictGet(fontDict, 'DescendantFonts', PDFArray)?.get(0), PDFDict);
      const dw = this.num(desc?.get(PDFName.of('DW'))) ?? 1000;
      const w = this.dictGet(desc, 'W', PDFArray);
      const table = new Map<number, number>();
      if (w) {
        const arr = w.asArray().map((o) => this.lookup(o));
        for (let i = 0; i < arr.length;) {
          const first = (arr[i] as PDFNumber).asNumber();
          const next = arr[i + 1];
          if (next instanceof PDFArray) {
            next.asArray().forEach((x, k) => table.set(first + k, this.num(x) ?? dw));
            i += 2;
          } else {
            const last = (next as PDFNumber).asNumber();
            const val = this.num(arr[i + 2]) ?? dw;
            for (let c = first; c <= last && c - first < 65536; c++) table.set(c, val);
            i += 3;
          }
        }
      }
      widths = (c) => (table.get(c) ?? dw) / 1000;
    } else {
      const first = this.num(fontDict.get(PDFName.of('FirstChar'))) ?? 0;
      const w = this.dictGet(fontDict, 'Widths', PDFArray)?.asArray().map((x) => this.num(x) ?? 0);
      if (w) widths = (c) => (w[c - first] ?? 500) / 1000;
    }
    const info: FontInfo = { family: f.family, weight: f.weight, italic: f.italic, bytes, toUnicode, widths };
    this.fonts.set(fontDict, info);
    return info;
  }

  private decodeText(font: FontInfo | null, s: string): { text: string; codes: number[] } {
    const codes: number[] = [];
    const n = font?.bytes ?? 1;
    for (let i = 0; i + n <= s.length; i += n) codes.push(n === 2 ? (s.charCodeAt(i) << 8) | s.charCodeAt(i + 1) : s.charCodeAt(i));
    const text = codes.map((c) => {
      const u = font?.toUnicode?.get(c);
      if (u !== undefined) return u;
      if (n === 2) return '';
      return String.fromCharCode(CP1252[c] ?? c);
    }).join('');
    return { text, codes };
  }

  private colour(ops: Tok[], warnPattern: () => void): string | null {
    const nums = ops.filter((o): o is { t: 'num'; v: number } => o.t === 'num').map((o) => o.v);
    if (ops.some((o) => o.t === 'name')) { warnPattern(); return '#808080'; }
    if (nums.length === 1) return grayHex(nums[0]);
    if (nums.length === 3) return rgbHex(nums[0] * 255, nums[1] * 255, nums[2] * 255);
    if (nums.length === 4) return cmykToHex(nums[0], nums[1], nums[2], nums[3]);
    return nums.length ? grayHex(nums[0]) : null;
  }

  private warn(w: string) {
    this.warnings.push(w);
  }

  run(content: Uint8Array, resources: PDFDict | undefined, initial: GState, target: SceneNode[], depth = 0): void {
    if (depth > 12) return;
    const lex = new Lexer(content);
    const stack: GState[] = [];
    let gs: GState = { ...initial };
    const operands: Tok[] = [];
    let path: PathCommand[] = []; // device px
    let cur: [number, number] = [0, 0];
    let start: [number, number] = [0, 0];
    let pendingClip = false;
    // text
    let tm: Matrix = [1, 0, 0, 1, 0, 0];
    let tlm: Matrix = [1, 0, 0, 1, 0, 0];
    let textRun: { text: string; x: number; y: number; size: number; angle: number; gs: GState; endX: number } | null = null;
    // layers: a stack of targets for optional content
    const layerStack: { target: SceneNode[]; layer: Layer | null }[] = [];
    let tgt = target;

    const pt = (x: number, y: number) => ap(gs.ctm, x, y);
    const flushText = () => {
      if (!textRun || !textRun.text.trim()) { textRun = null; return; }
      const r = textRun;
      textRun = null;
      const style = defaultTextStyle({
        fontFamily: r.gs.font?.family ?? defaultTextStyle().fontFamily,
        fontWeight: r.gs.font?.weight ?? 400,
        italic: r.gs.font?.italic ?? false,
        fontSize: r.size,
        lineHeight: 1.2,
        letterSpacing: r.gs.charSpace && r.size ? (r.gs.charSpace / r.size) * 1000 : 0,
        fill: r.gs.fill ? solid(r.gs.fill) : NO_PAINT,
      });
      const width = Math.max(r.endX - r.x, r.size * 0.3);
      // baseline origin -> node centre (see svg.baselineOffset)
      const lh = lineHeightPx(style);
      const toCentre = (lh - r.size) / 2 + r.size * 0.8 - lh / 2;
      const rad = (r.angle * Math.PI) / 180;
      const cx = r.x + Math.cos(rad) * width / 2 + Math.sin(rad) * toCentre;
      const cy = r.y + Math.sin(rad) * width / 2 - Math.cos(rad) * toCentre;
      const node = make.text({ name: r.text.trim().slice(0, 32), text: r.text.trimEnd(), x: cx, y: cy, rotation: r.angle, style, opacity: r.gs.fillAlpha, blend: r.gs.blend });
      tgt.push(this.clipped(node, r.gs.clip));
    };

    const showText = (s: string, rsrc: PDFDict | undefined) => {
      void rsrc;
      const { text, codes } = this.decodeText(gs.font, s);
      const trm = cat(tm, gs.ctm);
      const [ox, oy] = ap(trm, 0, gs.rise);
      const size = gs.fontSize * Math.hypot(trm[2], trm[3]);
      const angle = (Math.atan2(trm[1], trm[0]) * 180) / Math.PI;
      // advance
      let tx = 0;
      for (const c of codes) {
        const w0 = gs.font ? gs.font.widths(c) : 0.5;
        tx += (w0 * gs.fontSize + gs.charSpace + (c === 32 && (gs.font?.bytes ?? 1) === 1 ? gs.wordSpace : 0)) * gs.hScale;
      }
      const startX = ox, startY = oy;
      tm = cat([1, 0, 0, 1, tx, 0], tm);
      const [ex] = ap(cat(tm, gs.ctm), 0, gs.rise);
      const sameLine = textRun && Math.abs(textRun.y - startY) < size * 0.3 && Math.abs(textRun.size - size) < 0.01 && textRun.gs.fill === gs.fill && textRun.gs.font === gs.font && startX >= textRun.endX - size && startX - textRun.endX < size * 1.5;
      if (sameLine && textRun) {
        textRun.text += (startX - textRun.endX > size * 0.2 && !/\s$/.test(textRun.text) && !/^\s/.test(text) ? ' ' : '') + text;
        textRun.endX = Math.max(textRun.endX, ex);
      } else {
        flushText();
        textRun = { text, x: startX, y: startY, size, angle, gs: { ...gs }, endX: ex };
      }
    };

    const paint = (fill: boolean, stroke: boolean, close: boolean) => {
      if (close && path.length) path.push(['Z']);
      if (pendingClip) {
        gs.clip = path.slice();
        pendingClip = false;
      }
      if ((fill || stroke) && path.length > 1) {
        const scale = Math.sqrt(Math.abs(gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2]));
        const st: Stroke = stroke && gs.stroke
          ? { ...makeStroke(gs.stroke, Math.max(0.01, (gs.lineWidth || 1 / scale) * scale)), cap: gs.cap, join: gs.join, dash: gs.dash.map((d) => d * scale) }
          : makeStroke();
        const sameAlpha = !stroke || !fill || Math.abs(gs.fillAlpha - gs.strokeAlpha) < 0.01;
        const node = make.path({
          ...nodeFromWorld(path),
          name: fill && stroke ? 'Path' : fill ? 'Shape' : 'Line',
          fill: fill && gs.fill ? solid(gs.fill) : NO_PAINT,
          stroke: st,
          opacity: fill ? gs.fillAlpha : gs.strokeAlpha,
          blend: gs.blend,
        });
        if (!sameAlpha) this.warn('Different fill and stroke opacity was merged');
        tgt.push(this.clipped(node, gs.clip));
      }
      path = [];
    };

    for (let tok = lex.next(); tok; tok = lex.next()) {
      if (tok.t !== 'op') { operands.push(tok); continue; }
      const op = tok.v;
      const n = (i: number) => { const o = operands[i]; return o && o.t === 'num' ? o.v : 0; };
      switch (op) {
        case 'q': stack.push({ ...gs }); break;
        case 'Q': if (stack.length) gs = stack.pop()!; break;
        case 'cm': gs.ctm = cat([n(0), n(1), n(2), n(3), n(4), n(5)], gs.ctm); break;
        case 'w': gs.lineWidth = n(0); break;
        case 'J': gs.cap = (['butt', 'round', 'square'] as const)[n(0)] ?? 'butt'; break;
        case 'j': gs.join = (['miter', 'round', 'bevel'] as const)[n(0)] ?? 'miter'; break;
        case 'd': { const a = operands[0]; gs.dash = a?.t === 'arr' ? a.v.map((x) => (x.t === 'num' ? x.v : 0)) : []; break; }
        case 'g': case 'rg': case 'k': gs.fill = this.colour(operands, () => {}); break;
        case 'G': case 'RG': case 'K': gs.stroke = this.colour(operands, () => {}); break;
        case 'sc': case 'scn': gs.fill = this.colour(operands, () => this.warn('Gradient and pattern fills were imported as flat grey')); break;
        case 'SC': case 'SCN': gs.stroke = this.colour(operands, () => this.warn('Gradient and pattern strokes were imported as flat grey')); break;
        case 'cs': gs.fill = '#000000'; break;
        case 'CS': gs.stroke = '#000000'; break;
        case 'gs': {
          const nm = operands[0]?.t === 'name' ? operands[0].v : '';
          const eg = this.dictGet(this.dictGet(resources, 'ExtGState', PDFDict), nm, PDFDict);
          if (eg) {
            const ca = this.num(eg.get(PDFName.of('ca'))), CA = this.num(eg.get(PDFName.of('CA')));
            if (ca !== undefined) gs.fillAlpha = ca;
            if (CA !== undefined) gs.strokeAlpha = CA;
            const lw = this.num(eg.get(PDFName.of('LW')));
            if (lw !== undefined) gs.lineWidth = lw;
            let bm = this.lookup(eg.get(PDFName.of('BM')));
            if (bm instanceof PDFArray) bm = this.lookup(bm.get(0));
            if (bm instanceof PDFName) gs.blend = BLENDS[bm.asString().slice(1)] ?? 'normal';
            const sm = this.lookup(eg.get(PDFName.of('SMask')));
            if (sm instanceof PDFDict) this.warn('Soft (opacity) masks were not imported');
          }
          break;
        }
        case 'm': { cur = start = pt(n(0), n(1)); path.push(['M', cur[0], cur[1]]); break; }
        case 'l': { cur = pt(n(0), n(1)); path.push(['L', cur[0], cur[1]]); break; }
        case 'c': { const a = pt(n(0), n(1)), b = pt(n(2), n(3)); cur = pt(n(4), n(5)); path.push(['C', a[0], a[1], b[0], b[1], cur[0], cur[1]]); break; }
        case 'v': { const b = pt(n(0), n(1)); const a = cur; cur = pt(n(2), n(3)); path.push(['C', a[0], a[1], b[0], b[1], cur[0], cur[1]]); break; }
        case 'y': { const a = pt(n(0), n(1)); cur = pt(n(2), n(3)); path.push(['C', a[0], a[1], cur[0], cur[1], cur[0], cur[1]]); break; }
        case 'h': path.push(['Z']); cur = start; break;
        case 're': {
          const [x, y, w, h] = [n(0), n(1), n(2), n(3)];
          const p = [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)];
          path.push(['M', p[0][0], p[0][1]], ['L', p[1][0], p[1][1]], ['L', p[2][0], p[2][1]], ['L', p[3][0], p[3][1]], ['Z']);
          cur = start = p[0];
          break;
        }
        case 'S': paint(false, true, false); break;
        case 's': paint(false, true, true); break;
        case 'f': case 'F': case 'f*': paint(true, false, false); break;
        case 'B': case 'B*': paint(true, true, false); break;
        case 'b': case 'b*': paint(true, true, true); break;
        case 'n': paint(false, false, false); break;
        case 'W': case 'W*': pendingClip = true; break;
        case 'sh': this.warn('Gradients (shadings) were not imported'); break;
        case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = tm; break;
        case 'ET': flushText(); break;
        case 'Tf': {
          const nm = operands[0]?.t === 'name' ? operands[0].v : '';
          gs.font = this.font(resources, nm);
          gs.fontSize = n(1);
          break;
        }
        case 'Tc': gs.charSpace = n(0); break;
        case 'Tw': gs.wordSpace = n(0); break;
        case 'Tz': gs.hScale = n(0) / 100; break;
        case 'TL': gs.leading = n(0); break;
        case 'Ts': gs.rise = n(0); break;
        case 'Td': tlm = cat([1, 0, 0, 1, n(0), n(1)], tlm); tm = tlm; break;
        case 'TD': gs.leading = -n(1); tlm = cat([1, 0, 0, 1, n(0), n(1)], tlm); tm = tlm; break;
        case 'Tm': tlm = [n(0), n(1), n(2), n(3), n(4), n(5)]; tm = tlm; break;
        case 'T*': tlm = cat([1, 0, 0, 1, 0, -gs.leading], tlm); tm = tlm; break;
        case 'Tj': if (operands[0]?.t === 'str') showText(operands[0].v, resources); break;
        case "'": tlm = cat([1, 0, 0, 1, 0, -gs.leading], tlm); tm = tlm; if (operands[0]?.t === 'str') showText(operands[0].v, resources); break;
        case '"': gs.wordSpace = n(0); gs.charSpace = n(1); tlm = cat([1, 0, 0, 1, 0, -gs.leading], tlm); tm = tlm; if (operands[2]?.t === 'str') showText(operands[2].v, resources); break;
        case 'TJ': {
          const a = operands[0];
          if (a?.t !== 'arr') break;
          for (const el of a.v) {
            if (el.t === 'str') showText(el.v, resources);
            else if (el.t === 'num') tm = cat([1, 0, 0, 1, (-el.v / 1000) * gs.fontSize * gs.hScale, 0], tm);
          }
          break;
        }
        case 'Tr': if (n(0) === 3) gs.fill = null; break;
        case 'Do': {
          const nm = operands[0]?.t === 'name' ? operands[0].v : '';
          const xo = this.dictGet(this.dictGet(resources, 'XObject', PDFDict), nm, PDFStream);
          if (!xo) break;
          const sub = this.dictGet(xo.dict, 'Subtype', PDFName)?.asString();
          if (sub === '/Form') {
            const mArr = this.dictGet(xo.dict, 'Matrix', PDFArray)?.asArray().map((x) => this.num(x) ?? 0);
            const m: Matrix = mArr && mArr.length === 6 ? (mArr as Matrix) : [1, 0, 0, 1, 0, 0];
            const res = this.dictGet(xo.dict, 'Resources', PDFDict) ?? resources;
            try {
              this.run(this.streamBytes(xo), res, { ...gs, ctm: cat(m, gs.ctm) }, tgt, depth + 1);
            } catch {
              this.warn('A embedded drawing could not be read');
            }
          } else if (sub === '/Image') {
            const node = this.image(xo, gs.ctm, nm);
            if (node) tgt.push(this.clipped({ ...node, opacity: gs.fillAlpha, blend: gs.blend }, gs.clip));
          }
          break;
        }
        case 'BDC': case 'BMC': {
          let layer: Layer | null = null;
          if (op === 'BDC' && operands[0]?.t === 'name' && operands[0].v === 'OC') {
            const p = operands[1];
            let ocg: PDFDict | undefined;
            let ocgObj: PDFObject | undefined;
            if (p?.t === 'name') {
              ocgObj = this.dictGet(resources, 'Properties', PDFDict)?.get(PDFName.of(p.v));
              ocg = this.lookup(ocgObj, PDFDict);
            }
            if (ocg) {
              const nmObj = this.lookup(ocg.get(PDFName.of('Name')));
              const name = nmObj instanceof PDFString || nmObj instanceof PDFHexString ? nmObj.decodeText() : 'Layer';
              layer = { name, visible: !(ocgObj && this.hiddenOcgs.has(ocgObj)), nodes: [] };
            }
          }
          layerStack.push({ target: tgt, layer });
          if (layer) tgt = layer.nodes;
          break;
        }
        case 'EMC': {
          const top = layerStack.pop();
          if (!top) break;
          flushText();
          tgt = top.target;
          if (top.layer && top.layer.nodes.length) tgt.push(groupOf(top.layer.nodes, top.layer.name, top.layer.visible));
          break;
        }
        case 'BI': break;
        case 'ID': lex.skipInlineImage(); this.warn('Inline images were not imported'); break;
        default: break;
      }
      operands.length = 0;
    }
    flushText();
    while (layerStack.length) {
      const top = layerStack.pop()!;
      tgt = top.target;
      if (top.layer && top.layer.nodes.length) tgt.push(groupOf(top.layer.nodes, top.layer.name, top.layer.visible));
    }
  }

  private clipped(node: SceneNode, clip: PathCommand[] | null): SceneNode {
    if (!clip || !clip.length) return node;
    return { ...node, mask: { d: transformPath(clip, invert(composeTransform(node))), inverted: false, enabled: true } };
  }

  private image(xo: PDFStream, ctm: Matrix, name: string): SceneNode | null {
    const d = xo.dict;
    const w = this.num(d.get(PDFName.of('Width'))) ?? 0;
    const h = this.num(d.get(PDFName.of('Height'))) ?? 0;
    if (!w || !h) return null;
    const filters = (() => {
      const f = this.lookup(d.get(PDFName.of('Filter')));
      if (f instanceof PDFName) return [f.asString()];
      if (f instanceof PDFArray) return f.asArray().map((x) => (this.lookup(x) as PDFName).asString());
      return [];
    })();
    const id = newId('a');
    const smask = this.dictGet(d, 'SMask', PDFStream);
    try {
      if (filters.length === 1 && filters[0] === '/DCTDecode' && xo instanceof PDFRawStream && !smask) {
        this.out.encoded.set(id, { bytes: xo.contents, mime: 'image/jpeg' });
      } else {
        const bpc = this.num(d.get(PDFName.of('BitsPerComponent'))) ?? 8;
        if (bpc !== 8 || filters.some((f) => f !== '/FlateDecode')) {
          this.warn('Some images use an encoding that could not be imported');
          return null;
        }
        const raw = this.streamBytes(xo);
        const comps = raw.length / (w * h);
        if (comps !== 1 && comps !== 3 && comps !== 4) { this.warn('Some images use a colour space that could not be imported'); return null; }
        const px = new Uint8ClampedArray(w * h * 4);
        for (let i = 0, j = 0; i < w * h; i++, j += comps) {
          if (comps === 1) px.set([raw[j], raw[j], raw[j], 255], i * 4);
          else if (comps === 3) px.set([raw[j], raw[j + 1], raw[j + 2], 255], i * 4);
          else {
            const [c, m, y, k] = [raw[j] / 255, raw[j + 1] / 255, raw[j + 2] / 255, raw[j + 3] / 255];
            px.set([255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k), 255], i * 4);
          }
        }
        if (smask) {
          const sw = this.num(smask.dict.get(PDFName.of('Width'))), sh = this.num(smask.dict.get(PDFName.of('Height')));
          const a = this.streamBytes(smask);
          if (sw === w && sh === h && a.length >= w * h) for (let i = 0; i < w * h; i++) px[i * 4 + 3] = a[i];
          else this.warn('An image transparency mask could not be applied');
        }
        this.out.pixels.set(id, { width: w, height: h, data: px });
      }
    } catch {
      this.warn('An image could not be decoded');
      return null;
    }
    this.out.doc.assets[id] = { id, name: name || 'Image', mime: this.out.encoded.has(id) ? 'image/jpeg' : 'image/png', width: w, height: h };
    // raster local (centred, y down, size w x h) -> image unit square (y up) -> device
    const local: Matrix = [1 / w, 0, 0, -1 / h, 0.5, 0.5];
    const t = decompose(cat(local, ctm));
    return make.raster({ name: 'Image', assetId: id, w, h, ...t });
  }
}

function nodeFromWorld(d: PathCommand[]) {
  const c = centrePath(d);
  return { d: c.d, x: c.cx, y: c.cy, closed: d.some((x) => x[0] === 'Z') };
}

function groupOf(nodes: SceneNode[], name: string, visible: boolean): SceneNode {
  // centre the group on its children's centres
  const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return make.group(nodes.map((n) => ({ ...n, x: n.x - cx, y: n.y - cy, mask: n.mask })), { name, visible, x: cx, y: cy });
}

function initialState(ctm: Matrix): GState {
  return {
    ctm, fill: '#000000', stroke: '#000000', fillAlpha: 1, strokeAlpha: 1, blend: 'normal', lineWidth: 1, cap: 'butt', join: 'miter', dash: [], clip: null,
    font: null, fontSize: 12, charSpace: 0, wordSpace: 0, hScale: 1, leading: 0, rise: 0,
  };
}

function pageContent(interp: Interpreter, page: PDFPage): Uint8Array {
  const contents = page.node.Contents();
  if (!contents) return new Uint8Array();
  const streams: PDFStream[] = [];
  if (contents instanceof PDFStream) streams.push(contents);
  else if (contents instanceof PDFArray) {
    for (const o of contents.asArray()) {
      const s = page.doc.context.lookup(o);
      if (s instanceof PDFStream) streams.push(s);
    }
  }
  const parts = streams.map((s) => interp.streamBytes(s));
  const total = parts.reduce((t, p) => t + p.length + 1, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; out[o++] = 10; }
  return out;
}

export function isPostScriptOnlyAi(bytes: Uint8Array): boolean {
  const head = latin1(bytes, 0, Math.min(bytes.length, 1024));
  return !head.includes('%PDF') && head.startsWith('%!PS');
}

export async function importPdfVectors(bytes: Uint8Array, title: string, opts: { pages?: number[] } = {}): Promise<ImportResult> {
  if (isPostScriptOnlyAi(bytes)) {
    throw new Error('This Illustrator file was saved without “Create PDF Compatible File”. Re-save it from Illustrator with that option on, or as PDF.');
  }
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  const pages = pdf.getPages();
  if (!pages.length) throw new Error('The file has no pages');
  // hidden Illustrator layers (OCProperties /D /OFF)
  const hidden = new Set<PDFObject>();
  const ocp = pdf.catalog.lookup(PDFName.of('OCProperties'));
  if (ocp instanceof PDFDict) {
    const d = ocp.lookup(PDFName.of('D'));
    const off = d instanceof PDFDict ? d.lookup(PDFName.of('OFF')) : undefined;
    if (off instanceof PDFArray) for (const o of off.asArray()) hidden.add(o);
  }
  const which = (opts.pages ?? pages.map((_, i) => i)).filter((i) => i >= 0 && i < pages.length);
  const first = pages[which[0]];
  const box = (p: PDFPage) => {
    const b = p.getCropBox();
    return b.width > 0 && b.height > 0 ? b : p.getMediaBox();
  };
  const b0 = box(first);
  const doc = createDocument({
    title, studio: which.length > 1 ? 'layout' : 'vector', pages: which.length,
    settings: { width: Math.round(b0.width * PX_PER_PT * 100) / 100, height: Math.round(b0.height * PX_PER_PT * 100) / 100, background: '#ffffff', dpi: 300, unit: 'pt' },
  });
  const out = emptyResult(doc);
  const interp = new Interpreter(pdf, out, hidden);
  const docPages = out.doc.pages.map((p, k) => {
    const page = pages[which[k]];
    const b = box(page);
    const rot = page.getRotation().angle % 360;
    if (rot) interp.warnings.push('Rotated pages were imported unrotated');
    const k2 = PX_PER_PT;
    const base: Matrix = [k2, 0, 0, -k2, -b.x * k2, (b.y + b.height) * k2];
    const nodes: SceneNode[] = [];
    interp.run(pageContent(interp, page), page.node.Resources(), initialState(base), nodes);
    return { ...p, name: which.length > 1 ? `Page ${which[k] + 1}` : p.name, nodes };
  });
  out.doc = { ...out.doc, pages: docPages };
  const sizes = new Set(which.map((i) => `${Math.round(box(pages[i]).width)}x${Math.round(box(pages[i]).height)}`));
  if (sizes.size > 1) interp.warnings.push('Pages (artboards) of different sizes were imported at the size of the first');
  if (pdf.catalog.lookup(PDFName.of('PieceInfo')) || first.node.lookup(PDFName.of('PieceInfo'))) {
    interp.warnings.push('Illustrator-only data (effects, symbols, live text options) is read from the PDF copy');
  }
  out.warnings = summariseWarnings(interp.warnings);
  return out;
}

