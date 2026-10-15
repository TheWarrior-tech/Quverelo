export interface AuditRow {
  theme: 'dark' | 'light' | 'high-contrast';
  fg: string;
  bg: string;
  kind: 'text' | 'ui' | 'decorative';
  note: string;
  ratio: number;
  min: number;
  pass: boolean;
  fgHex: string;
  bgHex: string;
}
export interface Rgba { r: number; g: number; b: number; a: number }
export const PAIRS: { fg: string; on: string[]; kind: AuditRow['kind']; note: string }[];
export const MIN: Record<AuditRow['kind'], number>;
export function parseColor(v: string): Rgba | null;
export function composite(fg: Rgba, bg: Rgba): Rgba;
export function ratio(a: Rgba, b: Rgba): number;
export function toHex(c: Rgba): string;
export function parseTokens(css: string): Record<AuditRow['theme'], Record<string, string>>;
export function audit(css: string): AuditRow[];
export function failures(rows: AuditRow[]): AuditRow[];
