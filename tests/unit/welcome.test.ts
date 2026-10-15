import { describe, expect, it } from 'vitest';
import { ONBOARDING_STEPS, availableSteps, checklistVisible, isComplete, readOnboarding, withStep } from '../../src/core/onboarding';
import { inferStudio } from '../../src/core/newDocument';
import { defaultExportFormat, pagesStillValid } from '../../src/core/exportDefaults';
import { displayLocation, matchesQuery, parentDir, relativeAge, tildify } from '../../src/core/paths';
import { dropModeFor } from '../../src/core/dropMode';
import { DEFAULT_POLICY, parsePolicy } from '../../src/core/policy';
import { allMenuCommands } from '../../src/shared/menu';

describe('onboarding checklist', () => {
  it('reads missing or malformed settings as a fresh start', () => {
    expect(readOnboarding(undefined)).toEqual({ dismissed: false, done: [] });
    expect(readOnboarding({ dismissed: 'yes', done: ['create', 'bogus', 'create', 'text'] })).toEqual({ dismissed: false, done: ['create', 'text'] });
  });
  it('marks steps once and keeps identity when nothing changes', () => {
    const a = readOnboarding(null);
    const b = withStep(a, 'create');
    expect(b.done).toEqual(['create']);
    expect(withStep(b, 'create')).toBe(b);
  });
  it('is complete when every available step is done', () => {
    let s = readOnboarding(null);
    for (const step of ONBOARDING_STEPS) s = withStep(s, step);
    expect(isComplete(s)).toBe(true);
    const partial = withStep(withStep(withStep(readOnboarding(null), 'create'), 'text'), 'export');
    expect(isComplete(partial)).toBe(false);
    expect(isComplete(partial, ['create', 'text', 'export'])).toBe(true);
  });
  it('drops photo steps when the Photo studio or image import is off', () => {
    const all = () => true;
    expect(availableSteps(all)).toEqual([...ONBOARDING_STEPS]);
    expect(availableSteps((f) => f !== 'photo')).toEqual(['create', 'text', 'export']);
    expect(availableSteps((f) => !f.startsWith('export-') && f !== 'assignments')).toEqual(['create', 'place', 'subject', 'text']);
  });
  it('hides for the policy, a dismissal, or completion', () => {
    const fresh = readOnboarding(null);
    expect(checklistVisible(fresh, { disableOnboarding: false })).toBe(true);
    expect(checklistVisible(fresh, { disableOnboarding: true })).toBe(false);
    expect(checklistVisible({ ...fresh, dismissed: true }, { disableOnboarding: false })).toBe(false);
    expect(checklistVisible(fresh, { disableOnboarding: false }, [])).toBe(false);
  });
});

describe('policy disableOnboarding', () => {
  it('defaults to false and parses booleans only', () => {
    expect(DEFAULT_POLICY.disableOnboarding).toBe(false);
    expect(parsePolicy({ disableOnboarding: true }).policy.disableOnboarding).toBe(true);
    const bad = parsePolicy({ disableOnboarding: 'yes' });
    expect(bad.policy.disableOnboarding).toBe(false);
    expect(bad.warnings).toEqual(['"disableOnboarding" must be true or false']);
  });
});

describe('new document studio inference', () => {
  it('maps categories to studios', () => {
    expect(inferStudio('photo')).toBe('photo');
    expect(inferStudio('screen')).toBe('vector');
    expect(inferStudio('print')).toBe('layout');
    expect(inferStudio('school')).toBe('layout');
  });
  it('sends multi-page documents to Layout', () => {
    expect(inferStudio('screen', { pages: 6 })).toBe('layout');
  });
  it('falls back to an allowed studio', () => {
    expect(inferStudio('photo', {}, ['vector', 'layout'])).toBe('layout');
    expect(inferStudio('print', {}, ['vector'])).toBe('vector');
  });
});

describe('export defaults', () => {
  const all = ['png', 'jpg', 'svg', 'pdf'] as const;
  it('opens Layout documents on PDF and others on PNG', () => {
    expect(defaultExportFormat('layout', null, [...all])).toBe('pdf');
    expect(defaultExportFormat('vector', null, [...all])).toBe('png');
    expect(defaultExportFormat('photo', undefined, [...all])).toBe('png');
  });
  it('remembers the last format per document', () => {
    expect(defaultExportFormat('layout', 'jpg', [...all])).toBe('jpg');
  });
  it('skips formats the policy disables', () => {
    expect(defaultExportFormat('layout', null, ['png', 'jpg'])).toBe('png');
    expect(defaultExportFormat('vector', 'svg', ['pdf'])).toBe('pdf');
  });
  it('keeps only pages that still exist for Export again', () => {
    expect(pagesStillValid([0, 2, 5], 3)).toEqual([0, 2]);
    expect(pagesStillValid([4], 2)).toBeNull();
  });
  it('has Export… and Export Again in the File menu with shortcuts', () => {
    const cmds = new Map(allMenuCommands().map((c) => [c.id, c]));
    expect(cmds.get('file.export')?.accel).toBe('CmdOrCtrl+Shift+E');
    expect(cmds.get('file.export-again')?.accel).toBe('CmdOrCtrl+Alt+Shift+E');
    const accels = allMenuCommands().filter((c) => c.accel).map((c) => c.accel);
    expect(new Set(accels).size).toBe(accels.length);
  });
});

describe('recent file locations', () => {
  it('finds the parent folder on both path styles', () => {
    expect(parentDir('/home/sam/Art/poster.quvrelo')).toBe('/home/sam/Art');
    expect(parentDir('C:\\Users\\sam\\Art\\poster.quvrelo')).toBe('C:\\Users\\sam\\Art');
  });
  it('abbreviates the home folder', () => {
    expect(tildify('/home/sam/Art', '/home/sam')).toBe('~/Art');
    expect(tildify('/home/samuel/Art', '/home/sam')).toBe('/home/samuel/Art');
    expect(tildify('c:\\users\\sam\\Art', 'C:\\Users\\sam')).toBe('~\\Art');
  });
  it('keeps short locations whole', () => {
    expect(displayLocation('/home/sam/Documents/quvrelo-samples/poster.quvrelo', '/home/sam')).toBe('~/Documents/quvrelo-samples');
  });
  it('shortens long locations from the middle and never cuts the last folder', () => {
    const p = '/home/sam/Documents/School/2026/Year 9/Art and Design/Portfolio pieces/poster.quvrelo';
    const out = displayLocation(p, '/home/sam', 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.startsWith('~/…/')).toBe(true);
    expect(out.endsWith('Portfolio pieces')).toBe(true);
  });
  it('formats relative ages', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    expect(relativeAge('2026-10-15T11:59:40Z', now)).toBe('just now');
    expect(relativeAge('2026-10-15T11:20:00Z', now)).toBe('40 min ago');
    expect(relativeAge('2026-10-15T10:00:00Z', now)).toBe('2 h ago');
    expect(relativeAge('2026-10-14T10:00:00Z', now)).toBe('yesterday');
    expect(relativeAge('nope', now)).toBe('');
  });
  it('matches every search word, ignoring case and accents', () => {
    expect(matchesQuery('', ['anything'])).toBe(true);
    expect(matchesQuery('work dog', ['Worksheet', 'Questions with answer lines'])).toBe(false);
    expect(matchesQuery('answer work', ['Worksheet', 'Questions with answer lines'])).toBe(true);
    expect(matchesQuery('cafe', ['Café menu'])).toBe(true);
  });
});

describe('drop mode', () => {
  it('places images into an open document and opens everything else', () => {
    expect(dropModeFor(['image/png'], true)).toBe('place');
    expect(dropModeFor(['image/png', 'image/jpeg'], true)).toBe('place');
    expect(dropModeFor(['image/png', ''], true)).toBe('open');
    expect(dropModeFor(['image/png'], false)).toBe('open');
    expect(dropModeFor([], true)).toBe('open');
  });
});
