/**
 * Classroom workflow, offline: a teacher saves an assignment pack, a student
 * opens it (new untitled document with the brief), hands in a named,
 * timestamped bundle to the policy hand-in folder, and the teacher opens it.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import JSZip from 'jszip';
import { launch, run, shot, state, type Launched } from './helpers';

let L: Launched | null = null;
test.afterEach(async () => {
  await L?.app.close();
  L = null;
});

test.describe('classroom', () => {
  test('teacher pack → student hand-in bundle → teacher opens it', async () => {
    // --- teacher
    L = await launch();
    let { page } = L;
    const teacherDir = L.saveDir;
    await page.click('[data-template="newsletter"]');
    await expect(page.locator('.workspace')).toBeVisible();
    await run(page, 'file.assignment');
    const dlg = page.getByRole('dialog', { name: 'Assignment details' });
    await dlg.getByLabel('Assignment').fill('Climate poster');
    await dlg.getByLabel('Class').fill('9B Art');
    await dlg.getByLabel('Teacher').fill('Ms Patel');
    await dlg.getByLabel('Due date').fill('Friday');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await run(page, 'file.save-assignment-pack');
    const pack = path.join(teacherDir, '9B Art - Climate poster.quvrelo-assignment');
    await expect.poll(() => fs.existsSync(pack)).toBe(true);
    const z = await JSZip.loadAsync(fs.readFileSync(pack));
    expect(Object.keys(z.files).sort()).toEqual(['README.txt', 'assignment.json', 'template.quvrelo']);
    await L.app.close();

    // --- student (hand-in share set by policy)
    const share = fs.mkdtempSync(path.join(os.tmpdir(), 'quvrelo-share-'));
    const policy = path.join(share, 'policy.json');
    fs.writeFileSync(policy, JSON.stringify({ handInDirectory: path.join(share, 'Hand-in') }));
    L = await launch({ QUVRELO_E2E_OPEN: pack, QUVRELO_POLICY_PATH: policy });
    page = L.page;
    await run(page, 'file.open');
    await expect.poll(() => state<string>(page, 'editor.doc && editor.doc.title')).toBe('Climate poster');
    const opened = await state<{ path: string | null; dirty: boolean; cls: string; pages: number }>(page, '({ path: editor.session.filePath, dirty: editor.history.dirty, cls: editor.doc.assignment.className, pages: editor.doc.pages.length })');
    expect(opened).toEqual({ path: null, dirty: true, cls: '9B Art', pages: 2 });

    await run(page, 'file.hand-in');
    const hand = page.getByRole('dialog', { name: 'Hand in' });
    await expect(hand).toContainText('Climate poster');
    await hand.getByLabel('Your name').fill('Sam Lee');
    await shot(page, 'classroom-hand-in');
    await hand.getByRole('button', { name: 'Hand in' }).click();
    const classDir = path.join(share, 'Hand-in', '9B Art');
    await expect.poll(() => (fs.existsSync(classDir) ? fs.readdirSync(classDir).filter((f) => f.endsWith('.zip')).length : 0), { timeout: 30_000 }).toBe(1);
    const bundleName = fs.readdirSync(classDir).find((f) => f.endsWith('.zip'))!;
    expect(bundleName).toMatch(/^Sam Lee - Climate poster - \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.zip$/);
    const bz = await JSZip.loadAsync(fs.readFileSync(path.join(classDir, bundleName)));
    expect(Object.keys(bz.files).sort()).toEqual(['Sam Lee - Climate poster.pdf', 'Sam Lee - Climate poster.quvrelo', 'manifest.json']);
    const manifest = JSON.parse(await bz.file('manifest.json')!.async('string'));
    expect(manifest).toMatchObject({ format: 'quvrelo-handin', student: 'Sam Lee', className: '9B Art', assignment: 'Climate poster', teacher: 'Ms Patel', pages: 2 });
    const pdf = await bz.file('Sam Lee - Climate poster.pdf')!.async('uint8array');
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');

    // a second hand-in never overwrites the first
    await run(page, 'file.hand-in');
    await page.getByRole('dialog', { name: 'Hand in' }).getByRole('button', { name: 'Hand in' }).click();
    await expect.poll(() => fs.readdirSync(classDir).filter((f) => f.endsWith('.zip')).length, { timeout: 30_000 }).toBe(2);
    await L.app.close();

    // --- teacher opens the bundle
    L = await launch({ QUVRELO_E2E_OPEN: path.join(classDir, bundleName) });
    page = L.page;
    await run(page, 'file.open');
    await expect.poll(() => state<string | undefined>(page, 'editor.doc && editor.doc.assignment && editor.doc.assignment.studentName')).toBe('Sam Lee');
    await expect(page.locator('.toast', { hasText: 'Sam Lee' }).first()).toBeVisible();
  });

  test('policy can leave the PDF preview out of hand-ins', async () => {
    const share = fs.mkdtempSync(path.join(os.tmpdir(), 'quvrelo-share-'));
    const policy = path.join(share, 'policy.json');
    fs.writeFileSync(policy, JSON.stringify({ handInDirectory: share, handInIncludePreview: false }));
    L = await launch({ QUVRELO_POLICY_PATH: policy });
    const { page } = L;
    await page.click('[data-template="newsletter"]');
    await run(page, 'file.hand-in');
    const hand = page.getByRole('dialog', { name: 'Hand in' });
    await hand.getByLabel('Your name').fill('Alex');
    await hand.getByRole('button', { name: 'Hand in' }).click();
    const classDir = path.join(share, 'Class');
    await expect.poll(() => (fs.existsSync(classDir) ? fs.readdirSync(classDir).length : 0), { timeout: 30_000 }).toBe(1);
    const bz = await JSZip.loadAsync(fs.readFileSync(path.join(classDir, fs.readdirSync(classDir)[0])));
    expect(Object.keys(bz.files).some((f) => f.endsWith('.pdf'))).toBe(false);
  });
});
