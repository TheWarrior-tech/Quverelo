import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  assignmentPackName, buildAssignmentPack, buildHandInBundle, handInFileName, isHandInBundle, readAssignmentPack, readHandInBundle, safeName, stamp, teacherBrief,
} from '../../src/core/classroom';
import type { AssignmentInfo } from '../../src/core/types';

const info: AssignmentInfo = { title: 'Poster: Climate', className: '9B Art', teacher: 'Ms Patel', dueDate: 'Fri 21 Nov', instructions: 'A3 poster', studentName: 'Sam', submittedAt: '2026-01-01' };

describe('classroom workflow', () => {
  it('makes file names safe on every OS and share', () => {
    expect(safeName('a/b\\c:d*e?"f<g>h|')).toBe('a-b-c-d-e-f-g-h-');
    expect(safeName('  ..hidden. ')).toBe('hidden');
    expect(safeName('CON')).toBe('Unnamed');
    expect(safeName('')).toBe('Unnamed');
    expect(safeName('x'.repeat(200))).toHaveLength(80);
  });

  it('names hand-ins by student, assignment and local time', () => {
    const at = new Date(2026, 9, 16, 7, 5);
    expect(stamp(at)).toBe('2026-10-16 07.05');
    expect(handInFileName('Sam Lee', 'Poster: Climate', at)).toBe('Sam Lee - Poster- Climate - 2026-10-16 07.05.zip');
    expect(assignmentPackName(info)).toBe('9B Art - Poster- Climate.quvrelo-assignment');
  });

  it('round-trips an assignment pack without student details', async () => {
    const template = new Uint8Array([1, 2, 3]);
    const pack = await buildAssignmentPack(template, info, '0.6.0');
    const r = await readAssignmentPack(pack);
    expect(r.template).toEqual(template);
    expect(r.manifest.assignment).toEqual(teacherBrief(info));
    expect(r.manifest.assignment.studentName).toBeUndefined();
    expect(r.manifest.appVersion).toBe('0.6.0');
    const z = new JSZip();
    z.file('x.txt', 'no');
    await expect(readAssignmentPack(await z.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/not a Quvrelo assignment/);
  });

  it('builds a hand-in bundle with work, PDF preview and a verifiable manifest', async () => {
    const work = new TextEncoder().encode('quvrelo-work');
    const preview = new TextEncoder().encode('%PDF-1.7');
    const at = new Date(2026, 9, 16, 9, 30);
    const b = await buildHandInBundle({ work, preview, info, student: 'Sam Lee', pages: 2, appVersion: '0.6.0', at });
    expect(b.name).toBe('Sam Lee - Poster- Climate - 2026-10-16 09.30.zip');
    expect(await isHandInBundle(b.data)).toBe(true);
    const z = await JSZip.loadAsync(b.data);
    expect(Object.keys(z.files).sort()).toEqual(['Sam Lee - Poster- Climate.pdf', 'Sam Lee - Poster- Climate.quvrelo', 'manifest.json']);
    const r = await readHandInBundle(b.data);
    expect(r.intact).toBe(true);
    expect(r.work).toEqual(work);
    expect(r.manifest).toMatchObject({ student: 'Sam Lee', className: '9B Art', assignment: 'Poster: Climate', pages: 2, submittedAt: at.toISOString() });
    expect(r.manifest.workSha256).toMatch(/^[0-9a-f]{64}$/);

    // tampering is detected
    z.file(r.manifest.work, 'changed');
    const tampered = await readHandInBundle(await z.generateAsync({ type: 'uint8array' }));
    expect(tampered.intact).toBe(false);
  });

  it('omits the preview when there is none', async () => {
    const b = await buildHandInBundle({ work: new Uint8Array([1]), preview: null, info, student: 'A', pages: 1, appVersion: 'x', at: new Date() });
    expect(b.manifest.preview).toBeNull();
    expect(await isHandInBundle(new Uint8Array([1, 2]))).toBe(false);
  });
});
