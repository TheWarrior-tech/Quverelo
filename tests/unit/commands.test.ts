import { describe, expect, it } from 'vitest';
import { createDocument, findNode, make, nodeBounds } from '../../src/core/document';
import {
  addNodes, addPage, alignNodes, arrange, convertToCurves, cropDocument, distributeNodes, duplicateNodes,
  duplicatePage, groupNodes, linkFrames, addTextFrame, removeNodes, removePage, ungroup, unlinkFrame,
  addMaster, removeMaster, setPageMaster, movePage, setMaskFromWorldPath, releaseMask,
} from '../../src/core/commands';
import { rectPath } from '../../src/core/path';

function docWith(...nodes: ReturnType<typeof make.rect>[]) {
  const d = createDocument();
  return addNodes(d, d.pages[0].id, nodes);
}

describe('node commands', () => {
  it('adds, arranges and removes', () => {
    const a = make.rect({ name: 'a' });
    const b = make.rect({ name: 'b' });
    const c = make.rect({ name: 'c' });
    let d = docWith(a, b, c);
    d = arrange(d, [a.id], 'front');
    expect(d.pages[0].nodes.map((n) => n.name)).toEqual(['b', 'c', 'a']);
    d = arrange(d, [a.id], 'backward');
    expect(d.pages[0].nodes.map((n) => n.name)).toEqual(['b', 'a', 'c']);
    d = arrange(d, [c.id], 'back');
    expect(d.pages[0].nodes.map((n) => n.name)).toEqual(['c', 'b', 'a']);
    d = removeNodes(d, [b.id]);
    expect(d.pages[0].nodes).toHaveLength(2);
  });

  it('groups and ungroups preserving world positions', () => {
    const a = make.rect({ x: 100, y: 100, w: 50, h: 50 });
    const b = make.rect({ x: 300, y: 200, w: 50, h: 50, rotation: 30 });
    let d = docWith(a, b);
    const g = groupNodes(d, [a.id, b.id]);
    d = g.doc;
    expect(d.pages[0].nodes).toHaveLength(1);
    const group = d.pages[0].nodes[0];
    expect(group.type).toBe('group');
    // rotate & move the group, then ungroup
    d = { ...d, pages: [{ ...d.pages[0], nodes: [{ ...group, x: group.x + 10, rotation: 90 }] }] };
    const u = ungroup(d, group.id);
    d = u.doc;
    expect(d.pages[0].nodes).toHaveLength(2);
    const nb = d.pages[0].nodes.find((n) => n.id === b.id)!;
    expect(nb.rotation).toBeCloseTo(120);
  });

  it('aligns and distributes', () => {
    const a = make.rect({ x: 50, y: 50, w: 20, h: 20 });
    const b = make.rect({ x: 100, y: 90, w: 40, h: 40 });
    const c = make.rect({ x: 400, y: 10, w: 20, h: 20 });
    let d = docWith(a, b, c);
    d = alignNodes(d, [a.id, b.id, c.id], 'top', null);
    const tops = d.pages[0].nodes.map((n) => nodeBounds(n).y);
    expect(new Set(tops.map((t) => Math.round(t))).size).toBe(1);
    d = distributeNodes(d, [a.id, b.id, c.id], 'h');
    const bs = d.pages[0].nodes.map(nodeBounds).sort((p, q) => p.x - q.x);
    const gap1 = bs[1].x - (bs[0].x + bs[0].w);
    const gap2 = bs[2].x - (bs[1].x + bs[1].w);
    expect(gap1).toBeCloseTo(gap2);
  });

  it('duplicates with new ids', () => {
    const a = make.rect();
    const r = duplicateNodes(docWith(a), [a.id]);
    expect(r.ids).toHaveLength(1);
    expect(r.ids[0]).not.toBe(a.id);
    expect(r.doc.pages[0].nodes).toHaveLength(2);
  });

  it('converts shapes to curves', () => {
    const a = make.star();
    const d = convertToCurves(docWith(a as never), a.id);
    const n = findNode(d, a.id)!.node;
    expect(n.type).toBe('path');
  });

  it('applies and releases masks in local space', () => {
    const a = make.rect({ x: 100, y: 100, w: 100, h: 100 });
    let d = docWith(a);
    d = setMaskFromWorldPath(d, a.id, rectPath(50, 50).map((c) => (c[0] === 'Z' ? c : [c[0], (c[1] as number) + 100, (c[2] as number) + 100])) as never);
    const n = findNode(d, a.id)!.node;
    expect(n.mask?.d[0]).toEqual(['M', -25, -25]);
    d = releaseMask(d, a.id);
    expect(findNode(d, a.id)!.node.mask).toBeUndefined();
  });

  it('crops the document', () => {
    const a = make.rect({ x: 500, y: 500 });
    const d = cropDocument(docWith(a), { x: 400, y: 450, w: 300, h: 200 });
    expect(d.settings.width).toBe(300);
    expect(d.pages[0].nodes[0].x).toBe(100);
    expect(d.pages[0].nodes[0].y).toBe(50);
  });
});

describe('pages and masters', () => {
  it('adds, duplicates, moves and removes pages', () => {
    let d = createDocument();
    d = addPage(d).doc;
    d = addPage(d).doc;
    expect(d.pages.map((p) => p.name)).toEqual(['Page 1', 'Page 2', 'Page 3']);
    const third = d.pages[2].id;
    d = movePage(d, third, 0);
    expect(d.pages[0].id).toBe(third);
    expect(d.pages[0].name).toBe('Page 1');
    d = duplicatePage(d, d.pages[0].id).doc;
    expect(d.pages).toHaveLength(4);
    d = removePage(d, d.pages[1].id);
    expect(d.pages).toHaveLength(3);
  });
  it('assigns and removes masters', () => {
    let d = createDocument();
    const m = addMaster(d);
    d = setPageMaster(m.doc, d.pages[0].id, m.masterId);
    expect(d.pages[0].masterId).toBe(m.masterId);
    d = removeMaster(d, m.masterId);
    expect(d.pages[0].masterId).toBeNull();
  });
});

describe('text frames', () => {
  it('links and unlinks frames', () => {
    let d = createDocument();
    const a = addTextFrame(d, d.pages[0].id, {}, 'Hello world');
    d = a.doc;
    const b = addTextFrame(d, d.pages[0].id, {}, 'more');
    d = b.doc;
    d = linkFrames(d, a.id, b.id);
    const fa = findNode(d, a.id)!.node as { storyId: string };
    const fb = findNode(d, b.id)!.node as { storyId: string };
    expect(fa.storyId).toBe(fb.storyId);
    expect(d.stories[fa.storyId].chain).toEqual([a.id, b.id]);
    expect(d.stories[fa.storyId].text).toContain('more');
    expect(Object.keys(d.stories)).toHaveLength(1);
    d = unlinkFrame(d, b.id);
    expect(d.stories[fa.storyId].chain).toEqual([a.id]);
    expect(Object.keys(d.stories)).toHaveLength(2);
  });
  it('removing a frame removes it from the chain', () => {
    let d = createDocument();
    const a = addTextFrame(d, d.pages[0].id, {}, 'x');
    const b = addTextFrame(a.doc, d.pages[0].id, {}, '');
    d = linkFrames(b.doc, a.id, b.id);
    d = removeNodes(d, [b.id]);
    const sid = (findNode(d, a.id)!.node as { storyId: string }).storyId;
    expect(d.stories[sid].chain).toEqual([a.id]);
  });
});
