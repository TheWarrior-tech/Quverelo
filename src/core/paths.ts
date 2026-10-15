/**
 * Path display for the Welcome screen's Recent list (UX audit P1-13). The full
 * path always goes in a tooltip; the visible location keeps the folder the file
 * is in whole and shortens from the middle, never the end.
 */

export function splitPath(p: string): string[] {
  return p.split(/[\\/]+/).filter((s, i) => s !== '' || i === 0);
}

export function parentDir(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : i === 0 ? p.slice(0, 1) : '';
}

/** Replace the home directory prefix with "~". */
export function tildify(p: string, home: string | null | undefined): string {
  if (!home) return p;
  const h = home.replace(/[\\/]+$/, '');
  if (!h) return p;
  const win = /\\/.test(h) || /^[a-z]:/i.test(h);
  const same = win ? p.toLowerCase().startsWith(h.toLowerCase()) : p.startsWith(h);
  if (!same) return p;
  const rest = p.slice(h.length);
  if (rest === '') return '~';
  if (rest[0] === '/' || rest[0] === '\\') return '~' + rest;
  return p;
}

/**
 * Location of a file's folder for display, at most `max` characters:
 * "~/Documents/Art/Year 9" → "~/…/Art/Year 9". The last folder is never cut.
 */
export function displayLocation(filePath: string, home?: string | null, max = 48): string {
  const dir = tildify(parentDir(filePath), home);
  if (dir.length <= max) return dir;
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  const parts = dir.split(/[\\/]+/);
  const last = parts[parts.length - 1];
  const head = parts[0];
  // keep the head and as many trailing folders as fit
  let tail = [last];
  for (let i = parts.length - 2; i > 0; i--) {
    const next = [parts[i], ...tail];
    if ([head, '…', ...next].join(sep).length > max) break;
    tail = next;
  }
  if (tail.length >= parts.length - 1) return dir;
  const short = [head, '…', ...tail].join(sep);
  return short.length <= max || tail.length > 1 ? short : ['…', last].join(sep);
}

/** "Edited 2 h ago" style relative time for list metadata. */
export function relativeAge(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  const w = Math.round(d / 7);
  if (d < 31) return `${w} wk ago`;
  const date = new Date(t);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

/** Case- and accent-insensitive match of every word in `query` against any of `fields`. */
export function matchesQuery(query: string, fields: (string | undefined | null)[]): boolean {
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = norm(fields.filter(Boolean).join(' '));
  return words.every((w) => hay.includes(w));
}
