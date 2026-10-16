/**
 * Classroom workflow (offline):
 *
 *  Teacher  — File › Save Assignment Pack… writes `<Assignment>.quvrelo-assignment`:
 *             a zip with assignment.json (the brief) and template.quvrelo (the
 *             starting document). Put it on a share, in a policy
 *             templateDirectories folder, or email it.
 *  Student  — opening the pack starts a NEW untitled document from the template
 *             with the brief attached (the pack itself is never modified).
 *  Hand in  — File › Hand In… writes one named, timestamped bundle
 *             `<Student> - <Assignment> - <YYYY-MM-DD HH.MM>.zip` into
 *             `<handInDirectory>/<Class>/` (policy) containing the editable
 *             work (.quvrelo), a PDF preview for marking on any computer and
 *             manifest.json (who, what, when, app version, SHA-256 of the work).
 *             Teachers open the bundle in Quvrelo (it opens the work) or just
 *             open preview.pdf.
 */
import JSZip from 'jszip';
import type { AssignmentInfo } from './types';
import { handInFileName, safeName } from './classroomNames';

export { handInFileName, safeName, stamp } from './classroomNames';

export const ASSIGNMENT_EXT = 'quvrelo-assignment';
export const ASSIGNMENT_FORMAT = 'quvrelo-assignment';
export const HANDIN_FORMAT = 'quvrelo-handin';

export interface AssignmentManifest {
  format: typeof ASSIGNMENT_FORMAT;
  version: 1;
  createdAt: string;
  appVersion: string;
  assignment: AssignmentInfo;
}

export interface HandInManifest {
  format: typeof HANDIN_FORMAT;
  version: 1;
  student: string;
  className: string;
  assignment: string;
  teacher: string;
  dueDate: string;
  submittedAt: string;
  appVersion: string;
  pages: number;
  work: string;
  workSha256: string;
  preview: string | null;
}

export function assignmentPackName(info: AssignmentInfo): string {
  return `${safeName(info.className ? `${info.className} - ${info.title}` : info.title, 'Assignment')}.${ASSIGNMENT_EXT}`;
}

/** Student-specific fields never go into a pack. */
export function teacherBrief(info: AssignmentInfo): AssignmentInfo {
  const { studentName: _s, submittedAt: _t, ...brief } = info;
  return brief;
}

export async function buildAssignmentPack(template: Uint8Array, info: AssignmentInfo, appVersion: string, now = new Date()): Promise<Uint8Array> {
  const z = new JSZip();
  const manifest: AssignmentManifest = { format: ASSIGNMENT_FORMAT, version: 1, createdAt: now.toISOString(), appVersion, assignment: teacherBrief(info) };
  z.file('assignment.json', JSON.stringify(manifest, null, 2));
  z.file('template.quvrelo', template);
  z.file('README.txt', `Quvrelo assignment: ${info.title}\r\nOpen this file in Quvrelo to start the assignment.\r\n`);
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function readAssignmentPack(data: Uint8Array): Promise<{ manifest: AssignmentManifest; template: Uint8Array }> {
  const z = await JSZip.loadAsync(data);
  const m = z.file('assignment.json');
  const t = z.file('template.quvrelo');
  if (!m || !t) throw new Error('This is not a Quvrelo assignment pack');
  const manifest = JSON.parse(await m.async('string')) as AssignmentManifest;
  if (manifest.format !== ASSIGNMENT_FORMAT) throw new Error('This is not a Quvrelo assignment pack');
  if (manifest.version > 1) throw new Error('This assignment pack was made by a newer Quvrelo — please update');
  return { manifest, template: await t.async('uint8array') };
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function buildHandInBundle(o: {
  work: Uint8Array;
  preview: Uint8Array | null;
  info: AssignmentInfo;
  student: string;
  pages: number;
  appVersion: string;
  at: Date;
}): Promise<{ name: string; data: Uint8Array; manifest: HandInManifest }> {
  const base = `${safeName(o.student, 'Student')} - ${safeName(o.info.title, 'Assignment')}`;
  const manifest: HandInManifest = {
    format: HANDIN_FORMAT,
    version: 1,
    student: o.student,
    className: o.info.className,
    assignment: o.info.title,
    teacher: o.info.teacher,
    dueDate: o.info.dueDate,
    submittedAt: o.at.toISOString(),
    appVersion: o.appVersion,
    pages: o.pages,
    work: `${base}.quvrelo`,
    workSha256: await sha256Hex(o.work),
    preview: o.preview ? `${base}.pdf` : null,
  };
  const z = new JSZip();
  z.file('manifest.json', JSON.stringify(manifest, null, 2));
  z.file(manifest.work, o.work);
  if (o.preview && manifest.preview) z.file(manifest.preview, o.preview);
  // Store (no compression) keeps hand-in fast on shared machines; .quvrelo and PDF are already compressed.
  const data = await z.generateAsync({ type: 'uint8array', compression: 'STORE' });
  return { name: handInFileName(o.student, o.info.title, o.at), data, manifest };
}

/** Teacher opening a hand-in bundle: returns the work file (and checks it is intact). */
export async function readHandInBundle(data: Uint8Array): Promise<{ manifest: HandInManifest; work: Uint8Array; intact: boolean }> {
  const z = await JSZip.loadAsync(data);
  const m = z.file('manifest.json');
  if (!m) throw new Error('This zip is not a Quvrelo hand-in');
  const manifest = JSON.parse(await m.async('string')) as HandInManifest;
  if (manifest.format !== HANDIN_FORMAT) throw new Error('This zip is not a Quvrelo hand-in');
  const w = z.file(manifest.work);
  if (!w) throw new Error('The hand-in is missing its work file');
  const work = await w.async('uint8array');
  return { manifest, work, intact: (await sha256Hex(work)) === manifest.workSha256 };
}

export async function isHandInBundle(data: Uint8Array): Promise<boolean> {
  try {
    const z = await JSZip.loadAsync(data);
    const m = z.file('manifest.json');
    return !!m && JSON.parse(await m.async('string')).format === HANDIN_FORMAT;
  } catch {
    return false;
  }
}
