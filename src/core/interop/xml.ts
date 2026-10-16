/**
 * Minimal, dependency-free XML reader for package formats (IDML). Handles
 * elements, attributes, text, CDATA, comments, processing instructions and the
 * predefined + numeric entities. No DTDs, no namespaces resolution (prefixes
 * are kept in names). Runs in Node and the renderer alike.
 */
export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENT[e] ?? m;
  });
}

export function parseXml(src: string): XmlElement {
  const root: XmlElement = { name: '#document', attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  let i = 0;
  const n = src.length;
  const attrRe = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      const t = src.slice(i);
      if (t.trim()) stack[stack.length - 1].children.push(decodeEntities(t));
      break;
    }
    if (lt > i) {
      const t = src.slice(i, lt);
      if (t.trim() || stack.length > 1) stack[stack.length - 1].children.push(decodeEntities(t));
    }
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9);
      stack[stack.length - 1].children.push(src.slice(lt + 9, e < 0 ? n : e));
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      const e = src.indexOf('>', lt);
      i = e < 0 ? n : e + 1;
      continue;
    }
    // find end of tag, respecting quoted attribute values
    let j = lt + 1;
    let q: string | null = null;
    for (; j < n; j++) {
      const c = src[j];
      if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
    }
    const body = src.slice(lt + 1, j);
    i = j + 1;
    if (body[0] === '/') {
      const name = body.slice(1).trim();
      // pop to the matching element (tolerates mismatches)
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) { stack.length = k; break; }
      }
      continue;
    }
    const selfClose = body.endsWith('/');
    const inner = selfClose ? body.slice(0, -1) : body;
    const m = /^([^\s/>]+)/.exec(inner);
    if (!m) continue;
    const el: XmlElement = { name: m[1], attrs: {}, children: [] };
    attrRe.lastIndex = m[1].length;
    for (let a = attrRe.exec(inner); a; a = attrRe.exec(inner)) el.attrs[a[1]] = decodeEntities(a[3] ?? a[4] ?? '');
    stack[stack.length - 1].children.push(el);
    if (!selfClose) stack.push(el);
  }
  return root;
}

export const elements = (e: XmlElement, name?: string): XmlElement[] =>
  e.children.filter((c): c is XmlElement => typeof c !== 'string' && (!name || c.name === name));

export function child(e: XmlElement, name: string): XmlElement | undefined {
  return elements(e, name)[0];
}

/** Depth-first search for elements by name. */
export function findAll(e: XmlElement, name: string, out: XmlElement[] = []): XmlElement[] {
  for (const c of e.children) {
    if (typeof c === 'string') continue;
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

export function textOf(e: XmlElement): string {
  return e.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
}
