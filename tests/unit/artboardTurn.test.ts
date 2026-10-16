import { describe, expect, it } from 'vitest';
import { createDocument, make, findNode, worldMatrix } from '../../src/core/document';
import { addNodes, flipNodes, rotateNodes } from '../../src/core/commands';
import { makeArtboard, setArtboardOrientation } from '../../src/core/artboards';
import { apply } from '../../src/core/geometry';
import type { GroupNode } from '../../src/core/types';

function setup() {
  const child = make.rect({ x: 100, y: -20, w: 40, h: 20, rotation: 10 });
  const board = makeArtboard({ x: 0, y: 0, w: 400, h: 300 }, 'Card', '#ffffff', [child]);
  let d = createDocument({ settings: { width: 1000, height: 1000 } });
  d = addNodes(d, d.pages[0].id, [board]);
  return { d, board, child };
}
/** where a point of the child (its local +x corner) lands on the page */
const corner = (d: any, id: string) => apply(worldMatrix(findNode(d, id)!), { x: 20, y: 0 });

describe('artboards stay upright', () => {
  it('Rotate 90° turns the content about the board centre and swaps the board to portrait', () => {
    const { d, board, child } = setup();
    const before = corner(d, child.id);
    const out = rotateNodes(d, [board.id], 90);
    const g = findNode(out, board.id)!.node as GroupNode;
    expect(g.rotation).toBe(0);
    expect(g.artboard).toMatchObject({ w: 300, h: 400 });
    const c = g.children[0];
    expect(c.x).toBeCloseTo(20);
    expect(c.y).toBeCloseTo(100);
    expect(c.rotation).toBeCloseTo(100);
    // the corner turned 90° about the board centre (200, 150)
    const after = corner(out, child.id);
    expect(after.x - 200).toBeCloseTo(-(before.y - 150), 6);
    expect(after.y - 150).toBeCloseTo(before.x - 200, 6);
    // four quarter turns: back where it started
    const full = [90, 90, 90].reduce((acc, deg) => rotateNodes(acc, [board.id], deg), out);
    const c4 = (findNode(full, board.id)!.node as GroupNode).children[0];
    expect(c4.x).toBeCloseTo(100);
    expect(c4.y).toBeCloseTo(-20);
    expect(c4.rotation).toBeCloseTo(10);
  });
  it('Flip mirrors the content about the centre line; the board never flips', () => {
    const { d, board, child } = setup();
    const before = corner(d, child.id);
    const out = flipNodes(d, [board.id], 'h');
    const g = findNode(out, board.id)!.node as GroupNode;
    expect(g.flipX).toBe(false);
    const after = corner(out, child.id);
    expect(after.x - 200).toBeCloseTo(-(before.x - 200), 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    // twice is the identity
    const back = findNode(flipNodes(out, [board.id], 'h'), board.id)!.node as GroupNode;
    expect(back.children[0]).toMatchObject({ x: 100, y: -20, flipX: false });
    expect(back.children[0].rotation).toBeCloseTo(10);
  });
  it('orientation swaps sides only when needed; ordinary objects still rotate', () => {
    const { d, board } = setup();
    expect((findNode(setArtboardOrientation(d, board.id, 'landscape'), board.id)!.node as GroupNode).artboard).toMatchObject({ w: 400, h: 300 });
    expect((findNode(setArtboardOrientation(d, board.id, 'portrait'), board.id)!.node as GroupNode).artboard).toMatchObject({ w: 300, h: 400 });
    const r = make.rect({ rotation: 0 });
    let d2 = createDocument();
    d2 = addNodes(d2, d2.pages[0].id, [r]);
    expect(findNode(rotateNodes(d2, [r.id], 90), r.id)!.node.rotation).toBe(90);
  });
});
