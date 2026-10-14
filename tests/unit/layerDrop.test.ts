import { describe, expect, it } from 'vitest';
import { dropIndex, isNoopDrop } from '../../src/renderer/ui/panels/layerDrop';

// stored order bottom-first: [A0, B1, C2, D3]; the panel lists D, C, B, A
const move = (list: string[], from: number, to: number) => {
  const l = [...list];
  const [x] = l.splice(from, 1);
  l.splice(to, 0, x);
  return l;
};
const L = ['A', 'B', 'C', 'D'];

describe('layer drag reorder', () => {
  it('drops above a row (in front of it)', () => {
    expect(move(L, 0, dropIndex(0, 2, 'above'))).toEqual(['B', 'C', 'A', 'D']);
    expect(move(L, 3, dropIndex(3, 1, 'above'))).toEqual(['A', 'B', 'D', 'C']);
  });
  it('drops below a row (behind it)', () => {
    expect(move(L, 0, dropIndex(0, 2, 'below'))).toEqual(['B', 'A', 'C', 'D']);
    expect(move(L, 3, dropIndex(3, 0, 'below'))).toEqual(['D', 'A', 'B', 'C']);
  });
  it('detects drops that change nothing', () => {
    expect(isNoopDrop(1, 0, 'above')).toBe(true);
    expect(isNoopDrop(1, 2, 'below')).toBe(true);
    expect(isNoopDrop(1, 2, 'above')).toBe(false);
    expect(isNoopDrop(-1, 2, 'above')).toBe(false);
  });
});
