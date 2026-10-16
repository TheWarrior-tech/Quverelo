import { describe, expect, it } from 'vitest';
import type { StudioKind } from '../../src/core/types';
import { STUDIO_RAIL, TOOL_KEYS, cycleTool, groupOf, isGroup, remember, studioGroups, studioOfGroup, studioTools, toolForKeyIn, toolKeyIn, visibleTool } from '../../src/renderer/state/toolGroups';

const STUDIOS: StudioKind[] = ['photo', 'vector', 'layout'];

describe('tool rail groups', () => {
  it('lists every tool exactly once per studio', () => {
    for (const s of STUDIOS) {
      const tools = studioTools(s);
      expect(new Set(tools).size, s).toBe(tools.length);
      expect(tools[0], s).toBe('move');
    }
    // the tools each studio offered before flyouts are all still reachable
    expect(new Set(studioTools('photo'))).toEqual(new Set([
      'move', 'marquee-rect', 'marquee-ellipse', 'lasso', 'object-select', 'crop', 'brush', 'eraser', 'fill', 'eyedropper', 'text', 'rect', 'ellipse', 'polygon', 'star', 'hand', 'zoom',
      // photo parity: selection and retouch tools
      'polygon-lasso', 'magic-wand', 'spot-heal', 'heal', 'clone', 'dodge', 'burn', 'smudge',
    ]));
    expect(new Set(studioTools('vector'))).toEqual(new Set(['move', 'node', 'pen', 'pencil', 'rect', 'ellipse', 'polygon', 'star', 'line', 'text', 'eyedropper', 'hand', 'zoom']));
    expect(new Set(studioTools('layout'))).toEqual(new Set(['move', 'node', 'textframe', 'imageframe', 'text', 'rect', 'ellipse', 'line', 'eyedropper', 'hand', 'zoom']));
  });

  it('groups have unique ids, at least two members and a cycle key', () => {
    const ids = STUDIOS.flatMap((s) => studioGroups(s).map((g) => g.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of STUDIOS) for (const g of studioGroups(s)) {
      expect(g.tools.length).toBeGreaterThanOrEqual(2);
      expect(g.key).toMatch(/^[A-Z]$/);
    }
  });

  it('never starts, ends or doubles a divider', () => {
    for (const s of STUDIOS) {
      const r = STUDIO_RAIL[s];
      expect(r[0]).not.toBe('|');
      expect(r[r.length - 1]).not.toBe('|');
      r.forEach((e, i) => i > 0 && e === '|' && expect(r[i - 1]).not.toBe('|'));
    }
  });

  it('finds the group of a tool per studio', () => {
    expect(groupOf('photo', 'marquee-ellipse')?.id).toBe('photo-marquee');
    expect(groupOf('vector', 'star')?.id).toBe('vector-shapes');
    expect(groupOf('layout', 'ellipse')?.id).toBe('layout-shapes');
    expect(groupOf('vector', 'move')).toBeNull();
    expect(STUDIO_RAIL.vector.filter(isGroup).map((g) => g.id)).toEqual(['vector-pen', 'vector-shapes']);
    // photo parity rail groups: Lasso (L), Smart selection (W), Healing (J), Dodge and burn (O)
    expect(STUDIO_RAIL.photo.filter(isGroup).map((g) => g.id)).toEqual(['photo-marquee', 'photo-lasso', 'photo-smart-select', 'photo-heal', 'photo-tone', 'photo-shapes']);
    expect(groupOf('photo', 'polygon-lasso')?.id).toBe('photo-lasso');
    expect(groupOf('photo', 'magic-wand')?.id).toBe('photo-smart-select');
    expect(groupOf('photo', 'heal')?.id).toBe('photo-heal');
    expect(groupOf('photo', 'burn')?.id).toBe('photo-tone');
    expect(groupOf('photo', 'clone')).toBeNull();
  });

  it('shows the active member, else the last used, else the first', () => {
    const g = groupOf('vector', 'rect')!;
    expect(visibleTool(g, 'move', {})).toBe('rect');
    expect(visibleTool(g, 'move', { 'vector-shapes': 'star' })).toBe('star');
    expect(visibleTool(g, 'polygon', { 'vector-shapes': 'star' })).toBe('polygon');
    // stale memory (a tool not in the group) falls back to the first member
    expect(visibleTool(g, 'move', { 'vector-shapes': 'brush' })).toBe('rect');
  });

  it('remembers the last-used tool per group', () => {
    let m = remember({}, 'vector', 'star');
    expect(m).toEqual({ 'vector-shapes': 'star' });
    m = remember(m, 'vector', 'pencil');
    expect(m).toEqual({ 'vector-shapes': 'star', 'vector-pen': 'pencil' });
    // tools outside any group leave memory untouched (same object)
    expect(remember(m, 'vector', 'move')).toBe(m);
    expect(remember(m, 'vector', 'star')).toBe(m);
  });

  it('cycles within a group with Shift+key semantics', () => {
    const g = groupOf('vector', 'rect')!;
    // from outside the group: first press lands on the shown member
    expect(cycleTool(g, 'move', {})).toBe('rect');
    expect(cycleTool(g, 'move', { 'vector-shapes': 'polygon' })).toBe('polygon');
    // inside: step and wrap, both directions
    expect(cycleTool(g, 'rect', {})).toBe('ellipse');
    expect(cycleTool(g, 'star', {})).toBe('rect');
    expect(cycleTool(g, 'rect', {}, -1)).toBe('star');
    const m = groupOf('photo', 'marquee-rect')!;
    expect(cycleTool(m, 'marquee-rect', {})).toBe('marquee-ellipse');
    expect(cycleTool(m, 'marquee-ellipse', {})).toBe('marquee-rect');
  });

  it('Photo has a Shapes flyout (critique 2 P1-10) on U, clear of marquee M and eraser E', () => {
    const g = groupOf('photo', 'star')!;
    expect(g.id).toBe('photo-shapes');
    expect(g.tools).toEqual(['rect', 'ellipse', 'polygon', 'star']);
    expect(g.key).toBe('U');
    expect(studioOfGroup(g)).toBe('photo');
    // placed after Text, in the same rail section
    const rail = STUDIO_RAIL.photo;
    expect(rail[rail.indexOf('text') + 1]).toBe(g);
    expect(toolForKeyIn('photo', 'u')).toBe('rect');
    expect(toolForKeyIn('photo', 'm')).toBe('marquee-rect');
    expect(toolForKeyIn('photo', 'e')).toBe('eraser');
    expect(toolKeyIn('photo', 'rect')).toBe('U');
    expect(toolKeyIn('vector', 'rect')).toBe('M');
    expect(toolKeyIn('photo', 'ellipse')).toBeUndefined();
    expect(cycleTool(g, 'rect', {})).toBe('ellipse');
  });

  it('every key maps to a tool its studio offers, and each tool has at most one key per studio', () => {
    for (const s of STUDIOS) {
      const tools = new Set(studioTools(s));
      const keyed = Object.values({ ...TOOL_KEYS.common, ...TOOL_KEYS[s] });
      for (const t of keyed) expect(tools.has(t), `${s}:${t}`).toBe(true);
      expect(new Set(Object.values(TOOL_KEYS[s])).size, s).toBe(Object.values(TOOL_KEYS[s]).length);
    }
  });

  it('Photo retouch tools have keys J / S / O / R and the new groups cycle', () => {
    expect(toolForKeyIn('photo', 'j')).toBe('spot-heal');
    expect(toolForKeyIn('photo', 's')).toBe('clone');
    expect(toolForKeyIn('photo', 'o')).toBe('dodge');
    expect(toolForKeyIn('photo', 'r')).toBe('smudge');
    expect(toolForKeyIn('photo', 'l')).toBe('lasso');
    expect(toolForKeyIn('photo', 'w')).toBe('object-select');
    expect(cycleTool(groupOf('photo', 'lasso')!, 'lasso', {})).toBe('polygon-lasso');
    expect(cycleTool(groupOf('photo', 'heal')!, 'heal', {})).toBe('spot-heal');
    expect(cycleTool(groupOf('photo', 'dodge')!, 'dodge', {})).toBe('burn');
  });
});
