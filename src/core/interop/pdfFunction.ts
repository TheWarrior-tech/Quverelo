/**
 * PDF functions (ISO 32000-1 §7.10): the maps behind gradients (shadings) and
 * spot-colour tint transforms. Types 0 (sampled), 2 (exponential),
 * 3 (stitching) and 4 (PostScript calculator) are evaluated; the caller hands
 * in an already-resolved description so this module has no pdf-lib types.
 */

export type PdfFn =
  | { type: 0; domain: number[]; range: number[]; size: number[]; bps: number; encode: number[]; decode: number[]; samples: Uint8Array }
  | { type: 2; domain: number[]; c0: number[]; c1: number[]; n: number }
  | { type: 3; domain: number[]; fns: PdfFn[]; bounds: number[]; encode: number[] }
  | { type: 4; domain: number[]; range: number[]; program: PsOp[] }
  | { type: 'array'; fns: PdfFn[] }; // an array of 1-out functions, one per colour component

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const interp = (x: number, x0: number, x1: number, y0: number, y1: number) => (x1 === x0 ? y0 : y0 + ((x - x0) * (y1 - y0)) / (x1 - x0));

export function evalFn(f: PdfFn, input: number[]): number[] {
  switch (f.type) {
    case 'array':
      return f.fns.map((g) => evalFn(g, input)[0] ?? 0);
    case 2: {
      const x = clamp(input[0] ?? 0, f.domain[0] ?? 0, f.domain[1] ?? 1);
      const p = f.n === 1 ? x : Math.pow(x, f.n);
      return f.c0.map((c, i) => c + p * ((f.c1[i] ?? c) - c));
    }
    case 3: {
      const d0 = f.domain[0] ?? 0, d1 = f.domain[1] ?? 1;
      const x = clamp(input[0] ?? 0, d0, d1);
      let k = 0;
      while (k < f.bounds.length && x >= f.bounds[k]) k++;
      k = Math.min(k, f.fns.length - 1);
      const lo = k === 0 ? d0 : f.bounds[k - 1];
      const hi = k === f.bounds.length ? d1 : f.bounds[k];
      const e = interp(x, lo, hi, f.encode[2 * k] ?? 0, f.encode[2 * k + 1] ?? 1);
      return evalFn(f.fns[k], [e]);
    }
    case 0: {
      const m = f.size.length;
      const nOut = f.range.length / 2;
      // multilinear interpolation over the sample grid
      const e: number[] = [];
      for (let i = 0; i < m; i++) {
        const x = clamp(input[i] ?? 0, f.domain[2 * i], f.domain[2 * i + 1]);
        const enc = f.encode.length ? [f.encode[2 * i], f.encode[2 * i + 1]] : [0, f.size[i] - 1];
        e.push(clamp(interp(x, f.domain[2 * i], f.domain[2 * i + 1], enc[0], enc[1]), 0, f.size[i] - 1));
      }
      const maxV = 2 ** f.bps - 1;
      const sample = (idx: number[], o: number) => {
        let off = 0, mul = 1;
        for (let i = 0; i < m; i++) { off += idx[i] * mul; mul *= f.size[i]; }
        return readBits(f.samples, (off * nOut + o) * f.bps, f.bps);
      };
      const out: number[] = [];
      for (let o = 0; o < nOut; o++) {
        let acc = 0;
        for (let corner = 0; corner < 1 << m; corner++) {
          let w = 1;
          const idx: number[] = [];
          for (let i = 0; i < m; i++) {
            const lo = Math.floor(e[i]), frac = e[i] - lo;
            const up = (corner >> i) & 1;
            idx.push(Math.min(f.size[i] - 1, lo + up));
            w *= up ? frac : 1 - frac;
          }
          if (w) acc += w * sample(idx, o);
        }
        const dec = f.decode.length ? [f.decode[2 * o], f.decode[2 * o + 1]] : [f.range[2 * o], f.range[2 * o + 1]];
        out.push(clamp(interp(acc, 0, maxV, dec[0], dec[1]), f.range[2 * o], f.range[2 * o + 1]));
      }
      return out;
    }
    case 4: {
      const stack = input.map((v, i) => clamp(v, f.domain[2 * i] ?? -Infinity, f.domain[2 * i + 1] ?? Infinity));
      runPs(f.program, stack);
      const nOut = f.range.length / 2;
      const res = stack.slice(-nOut);
      return res.map((v, i) => clamp(Number(v) || 0, f.range[2 * i], f.range[2 * i + 1]));
    }
  }
}

function readBits(b: Uint8Array, bit: number, n: number): number {
  if (n === 8) return b[bit >> 3] ?? 0;
  if (n === 16) return ((b[bit >> 3] ?? 0) << 8) | (b[(bit >> 3) + 1] ?? 0);
  let v = 0;
  for (let i = 0; i < n; i++) {
    const p = bit + i;
    v = (v << 1) | (((b[p >> 3] ?? 0) >> (7 - (p & 7))) & 1);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Type 4: PostScript calculator

export type PsOp = number | boolean | string | { if: PsOp[]; else?: PsOp[] };

/** Parse "{ 0 exch 1 sub … }" into nested ops. */
export function parsePs(src: string): PsOp[] {
  const toks = src.replace(/([{}])/g, ' $1 ').split(/\s+/).filter(Boolean);
  let i = 0;
  const block = (): PsOp[] => {
    const out: PsOp[] = [];
    while (i < toks.length) {
      const t = toks[i++];
      if (t === '{') {
        const body = block();
        out.push({ if: body });
      } else if (t === '}') return out;
      else if (t === 'if') {
        const last = out.pop();
        if (last && typeof last === 'object') out.push({ if: last.if });
      } else if (t === 'ifelse') {
        const b = out.pop(), a = out.pop();
        if (a && b && typeof a === 'object' && typeof b === 'object') out.push({ if: a.if, else: b.if });
      } else if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) out.push(parseFloat(t));
      else if (t === 'true' || t === 'false') out.push(t === 'true');
      else out.push(t);
    }
    return out;
  };
  const top = block();
  // the program is one outer { … }: unwrap it
  return top.length === 1 && typeof top[0] === 'object' && !(top[0] as { else?: PsOp[] }).else ? (top[0] as { if: PsOp[] }).if : top;
}

function runPs(prog: PsOp[], s: (number | boolean)[]): void {
  const num = () => Number(s.pop() ?? 0);
  const bool = () => { const v = s.pop(); return typeof v === 'boolean' ? v : !!v; };
  for (const op of prog) {
    if (typeof op === 'number' || typeof op === 'boolean') { s.push(op); continue; }
    if (typeof op === 'object') {
      if (op.else) { const c = bool(); runPs(c ? op.if : op.else, s); }
      else if (bool()) runPs(op.if, s);
      continue;
    }
    let a: number, b: number;
    switch (op) {
      case 'add': b = num(); a = num(); s.push(a + b); break;
      case 'sub': b = num(); a = num(); s.push(a - b); break;
      case 'mul': b = num(); a = num(); s.push(a * b); break;
      case 'div': b = num(); a = num(); s.push(b === 0 ? 0 : a / b); break;
      case 'idiv': b = num(); a = num(); s.push(b === 0 ? 0 : Math.trunc(a / b)); break;
      case 'mod': b = num(); a = num(); s.push(b === 0 ? 0 : a % b); break;
      case 'neg': s.push(-num()); break;
      case 'abs': s.push(Math.abs(num())); break;
      case 'ceiling': s.push(Math.ceil(num())); break;
      case 'floor': s.push(Math.floor(num())); break;
      case 'round': s.push(Math.round(num())); break;
      case 'truncate': s.push(Math.trunc(num())); break;
      case 'sqrt': s.push(Math.sqrt(Math.max(0, num()))); break;
      case 'sin': s.push(Math.sin((num() * Math.PI) / 180)); break;
      case 'cos': s.push(Math.cos((num() * Math.PI) / 180)); break;
      case 'atan': b = num(); a = num(); s.push(((Math.atan2(a, b) * 180) / Math.PI + 360) % 360); break;
      case 'exp': b = num(); a = num(); s.push(Math.pow(a, b)); break;
      case 'ln': s.push(Math.log(num())); break;
      case 'log': s.push(Math.log10(num())); break;
      case 'cvi': s.push(Math.trunc(num())); break;
      case 'cvr': s.push(num()); break;
      case 'eq': b = num(); a = num(); s.push(a === b); break;
      case 'ne': b = num(); a = num(); s.push(a !== b); break;
      case 'gt': b = num(); a = num(); s.push(a > b); break;
      case 'ge': b = num(); a = num(); s.push(a >= b); break;
      case 'lt': b = num(); a = num(); s.push(a < b); break;
      case 'le': b = num(); a = num(); s.push(a <= b); break;
      case 'and': { const y = s.pop(), x = s.pop(); s.push(typeof x === 'boolean' ? x && !!y : Number(x) & Number(y)); break; }
      case 'or': { const y = s.pop(), x = s.pop(); s.push(typeof x === 'boolean' ? x || !!y : Number(x) | Number(y)); break; }
      case 'xor': { const y = s.pop(), x = s.pop(); s.push(typeof x === 'boolean' ? x !== !!y : Number(x) ^ Number(y)); break; }
      case 'not': { const x = s.pop(); s.push(typeof x === 'boolean' ? !x : ~Number(x)); break; }
      case 'bitshift': b = num(); a = num(); s.push(b >= 0 ? a << b : a >> -b); break;
      case 'pop': s.pop(); break;
      case 'exch': { const y = s.pop()!, x = s.pop()!; s.push(y, x); break; }
      case 'dup': s.push(s[s.length - 1] ?? 0); break;
      case 'copy': { const n = num(); s.push(...s.slice(s.length - n)); break; }
      case 'index': { const n = num(); s.push(s[s.length - 1 - n] ?? 0); break; }
      case 'roll': {
        const j = num(), n = num();
        if (n > 0 && n <= s.length) {
          const part = s.splice(s.length - n, n);
          const k = ((j % n) + n) % n;
          s.push(...part.slice(n - k), ...part.slice(0, n - k));
        }
        break;
      }
      default: break; // unknown operator: ignored (the result is clamped to Range)
    }
  }
}
