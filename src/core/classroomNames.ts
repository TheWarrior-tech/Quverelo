/** Hand-in file naming (no dependencies, so the main process can import it). */

/** File-system-safe name part (Windows, macOS, Linux, SMB shares). */
export function safeName(s: string, fallback = 'Unnamed'): string {
  const clean = s
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.]+$/g, '')
    .slice(0, 80)
    .trim();
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean) || !clean ? fallback : clean;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local time stamp safe for file names: 2026-10-16 07.53 */
export function stamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

export function handInFileName(student: string, assignment: string, at: Date): string {
  return `${safeName(student, 'Student')} - ${safeName(assignment, 'Assignment')} - ${stamp(at)}.zip`;
}

