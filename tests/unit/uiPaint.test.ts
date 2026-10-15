import { describe, expect, it } from 'vitest';
import { firstColorOf, uiPaint, uiPaintPatch } from '../../src/renderer/state/uiPaint';
import type { Paint } from '../../src/core/types';

const base = { fillColor: '#112233', fillEnabled: true, fillGradient: null as Paint | null, strokeColor: '#445566', strokeEnabled: false, strokeGradient: null as Paint | null };
const lin: Paint = { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] };

describe('default paints for new objects (one colour popover everywhere)', () => {
  it('reads solid, none and gradient defaults', () => {
    expect(uiPaint(base, 'fill')).toEqual({ type: 'solid', color: '#112233' });
    expect(uiPaint(base, 'stroke')).toEqual({ type: 'none' });
    expect(uiPaint({ ...base, fillGradient: lin }, 'fill')).toEqual(lin);
  });

  it('writes a gradient with its first colour as the flat colour, and None keeps the colour', () => {
    expect(uiPaintPatch('fill', lin, base)).toEqual({ fillColor: '#ff0000', fillEnabled: true, fillGradient: lin });
    expect(uiPaintPatch('fill', { type: 'none' }, base)).toEqual({ fillColor: '#112233', fillEnabled: false, fillGradient: null });
    expect(uiPaintPatch('stroke', { type: 'solid', color: '#abcdef' }, base)).toEqual({ strokeColor: '#abcdef', strokeEnabled: true, strokeGradient: null });
  });

  it('round-trips', () => {
    for (const p of [lin, { type: 'solid', color: '#010203' }, { type: 'none' }] as Paint[]) {
      expect(uiPaint({ ...base, ...uiPaintPatch('fill', p, base) }, 'fill')).toEqual(p);
    }
    expect(firstColorOf({ type: 'none' }, '#fff')).toBe('#fff');
  });
});
