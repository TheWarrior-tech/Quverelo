import { describe, expect, it } from 'vitest';
import { createDocument } from '../../src/core/document';
import { addColourSwatch, cleanInkName, cmykFromPercent, formatCmyk, paintUsesSwatch, swatchDetail, swatchPaint, swatchProblem } from '../../src/core/colour/swatches';

describe('CMYK and spot swatches', () => {
  it('formats and clamps ink values', () => {
    expect(formatCmyk([0, 1, 0.8, 0])).toBe('C0 M100 Y80 K0');
    expect(cmykFromPercent([120, -5, 50, Number.NaN])).toEqual([1, 0, 0.5, 0]);
    expect(cleanInkName('  PANTONE   185   C ')).toBe('PANTONE 185 C');
  });

  it('adds a CMYK swatch with exact values and a spot swatch with its ink name', () => {
    let d = createDocument();
    const n = d.swatches.length;
    d = addColourSwatch(d, { name: '', color: '#00a0e0', cmyk: [1, 0, 0, 0] });
    d = addColourSwatch(d, { name: ' PANTONE 185 C ', color: '#e4002b', cmyk: [0, 1, 0.8, 0], spot: true });
    expect(d.swatches.length).toBe(n + 2);
    const [cy, sp] = d.swatches.slice(-2);
    expect(cy.name).toBe('C100 M0 Y0 K0');
    expect(cy.cmyk).toEqual([1, 0, 0, 0]);
    expect(cy.spot).toBeUndefined();
    expect(sp.name).toBe('PANTONE 185 C');
    expect(sp.spot).toBe(true);
    expect(swatchPaint(cy)).toEqual({ type: 'solid', color: '#00a0e0', cmyk: [1, 0, 0, 0] });
    expect(swatchPaint(sp)).toEqual({ type: 'solid', color: '#e4002b', cmyk: [0, 1, 0.8, 0], spot: 'PANTONE 185 C' });
    expect(swatchDetail(sp)).toBe('Spot colour · C0 M100 Y80 K0 for process');
    expect(paintUsesSwatch(swatchPaint(sp), sp)).toBe(true);
    expect(paintUsesSwatch(swatchPaint(cy), sp)).toBe(false);
    expect(paintUsesSwatch({ type: 'solid', color: '#00a0e0' }, cy)).toBe(false);
  });

  it('refuses duplicates, nameless or reserved spot inks and spots without a process alternate', () => {
    let d = createDocument();
    d = addColourSwatch(d, { name: 'Brand red', color: '#e4002b', cmyk: [0, 1, 0.8, 0], spot: true });
    expect(swatchProblem(d, { name: 'brand RED', color: '#000', cmyk: [0, 0, 0, 1] })).toMatch(/already/);
    expect(swatchProblem(d, { name: '', color: '#000', cmyk: [0, 0, 0, 1], spot: true })).toMatch(/ink name/);
    expect(swatchProblem(d, { name: 'Black', color: '#000', cmyk: [0, 0, 0, 1], spot: true })).toMatch(/reserved/);
    expect(swatchProblem(d, { name: 'Gold', color: '#c90', spot: true })).toMatch(/CMYK values/);
    const before = d.swatches.length;
    expect(addColourSwatch(d, { name: '', color: '#000', cmyk: [0, 0, 0, 1], spot: true }).swatches.length).toBe(before);
  });
});
