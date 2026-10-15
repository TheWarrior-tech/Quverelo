import { describe, expect, it } from 'vitest';
import { placeTip, tip, tipText } from '../../src/renderer/ui/tips';

const rect = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });

describe('tip() props', () => {
  it('uses data-tip and keycaps, never the native title', () => {
    const p = tip('Undo', 'edit.undo') as unknown as Record<string, string | undefined>;
    expect(p['aria-label']).toBe('Undo');
    expect(p['data-tip']).toBe('Undo');
    expect(p['data-keys']).toBe('CmdOrCtrl+Z');
    expect(p['aria-keyshortcuts']).toBe('Control+Z');
    expect(p.title).toBeUndefined();
  });
  it('accepts literal keys and no shortcut', () => {
    expect(tip('Move', 'V')['data-keys']).toBe('V');
    expect(tip('Align left')['data-keys']).toBeUndefined();
    expect(tip('Align left', 'arrange.align-left')['data-keys']).toBeUndefined();
    expect(tipText('Undo', 'edit.undo')).toBe('Undo (Ctrl+Z)');
  });
});

describe('tooltip placement', () => {
  const size = { w: 100, h: 24 };
  it('sits centred below by default', () => {
    expect(placeTip(rect(200, 100, 32, 32), size, 1000, 800, 'bottom')).toEqual({ x: 166, y: 138, side: 'bottom' });
  });
  it('flips above near the bottom edge', () => {
    const p = placeTip(rect(200, 770, 32, 24), size, 1000, 800, 'bottom');
    expect(p.side).toBe('top');
    expect(p.y).toBe(770 - 6 - 24);
  });
  it('clamps inside the viewport horizontally', () => {
    expect(placeTip(rect(0, 100, 20, 20), size, 1000, 800, 'bottom').x).toBe(8);
    expect(placeTip(rect(990, 100, 10, 20), size, 1000, 800, 'bottom').x).toBe(1000 - 8 - 100);
  });
  it('right side for the tool rail, flipping left at the edge', () => {
    expect(placeTip(rect(6, 200, 32, 32), size, 1000, 800, 'right')).toEqual({ x: 44, y: 204, side: 'right' });
    expect(placeTip(rect(960, 200, 32, 32), size, 1000, 800, 'right').side).toBe('left');
  });
});
