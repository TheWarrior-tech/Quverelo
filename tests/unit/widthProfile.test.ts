import { describe, expect, it } from 'vitest';
import { addProfilePoint, editableProfile, moveProfilePoint, profileAt, profileId, removeProfilePoint, storedProfile, strokeFx } from '../../src/core/strokeFx';
import { makeStroke, solid } from '../../src/core/document';

describe('custom width-profile editing', () => {
  it('turns uniform into an editable flat line with pinned ends', () => {
    expect(editableProfile(undefined)).toEqual([{ t: 0, w: 1 }, { t: 1, w: 1 }]);
    expect(editableProfile([{ t: 0.9, w: 0.2 }, { t: 0.1, w: 2 }])).toEqual([{ t: 0, w: 1 }, { t: 1, w: 0.2 }]);
  });
  it('adds a point on the current curve without changing its shape', () => {
    const base = [{ t: 0, w: 1 }, { t: 1, w: 0 }];
    const { profile, index } = addProfilePoint(base, 0.5);
    expect(index).toBe(1);
    expect(profile[1].w).toBeCloseTo(profileAt(base, 0.5), 3);
    for (const t of [0.1, 0.3, 0.5]) expect(profileAt(profile, t)).toBeLessThanOrEqual(1);
    // adding on top of an existing point selects it instead
    expect(addProfilePoint(profile, 0.502).index).toBe(1);
  });
  it('moves a point between its neighbours; the ends keep their position', () => {
    const p = [{ t: 0, w: 1 }, { t: 0.5, w: 1 }, { t: 1, w: 1 }];
    expect(moveProfilePoint(p, 1, 2, 0.3)).toEqual([{ t: 0, w: 1 }, { t: 0.99, w: 0.3 }, { t: 1, w: 1 }]);
    expect(moveProfilePoint(p, 1, -1, 5)[1]).toEqual({ t: 0.01, w: 1 });
    expect(moveProfilePoint(p, 0, 0.4, 0)[0]).toEqual({ t: 0, w: 0 });
    expect(moveProfilePoint(p, 2, 0.4, 0.5)[2]).toEqual({ t: 1, w: 0.5 });
  });
  it('removes inner points only', () => {
    const p = [{ t: 0, w: 1 }, { t: 0.5, w: 0.2 }, { t: 1, w: 1 }];
    expect(removeProfilePoint(p, 1)).toHaveLength(2);
    expect(removeProfilePoint(p, 0)).toHaveLength(3);
    expect(removeProfilePoint(p, 2)).toHaveLength(3);
  });
  it('stores the bare full-width line as uniform but keeps added points; edited presets read as custom', () => {
    expect(storedProfile([{ t: 0, w: 1 }, { t: 1, w: 1 }])).toBeUndefined();
    expect(storedProfile([{ t: 0, w: 1 }, { t: 0.5, w: 1 }, { t: 1, w: 1 }])).toHaveLength(3);
    expect(profileId(moveProfilePoint([{ t: 0, w: 1 }, { t: 1, w: 0 }], 1, 1, 0.2))).toBe('custom');
  });
  it('an edited profile draws: the outline narrows where the user pulled a point in', () => {
    const d: any = [['M', 0, 0], ['L', 200, 0]];
    const pinch = moveProfilePoint(addProfilePoint(undefined, 0.5).profile, 1, 0.5, 0.1);
    const fx = strokeFx(d, { ...makeStroke('#000', 20), paint: solid('#000'), profile: pinch });
    expect(fx.outline).toBeTruthy();
    const ys = (fx.outline as any[]).filter((c) => c[0] !== 'Z').map((c) => ({ x: c[c.length - 2], y: c[c.length - 1] }));
    const near = (x: number) => Math.max(...ys.filter((p) => Math.abs(p.x - x) < 6).map((p) => Math.abs(p.y)));
    expect(near(100)).toBeLessThan(2);
    expect(near(10)).toBeGreaterThan(8);
  });
});
