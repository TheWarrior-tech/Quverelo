/**
 * Vector studio commands: node editing, live compounds, symbols, artboards,
 * text on a path, spacing / align-to and export slices. Registered into the
 * command registry by state/commands.ts (registerVectorCommands), so menus,
 * the palette, buttons and tests all run them by id.
 */
import {
  addNodes, convertToCurves, distributeCentres, groupNodes, matchSize, removeNodes, spaceNodes, ungroup, updateNode, worldPath,
} from '../../core/commands';
import { findNode, make, makeStroke, nodeToPath, solid } from '../../core/document';
import { centrePath, transformPath } from '../../core/path';
import { createSymbol, detachInstances } from '../../core/symbols';
import { addArtboard, makeArtboard, nextArtboardName } from '../../core/artboards';
import { addSlice, slicesFromArtboards, worldBounds } from '../../core/slices';
import { unionRects, type Rect } from '../../core/geometry';
import type { CompoundOp, GroupNode, Id, SceneNode, TextNode } from '../../core/types';
import { editor } from './editor';
import { toast } from './bus';
import { nodeAction, type NodeAction } from './nodeEdit';
import { exportSlices } from './sliceExport';
import { renderBounds, renderLocalBounds } from '../engine/draw';

type Reg = (id: string, fn: () => unknown) => void;

const sel = () => editor.ui.selection;

/** Selected ids in stacking order (bottom first), top-level of the active container only. */
function stackOrdered(ids: Id[]): Id[] {
  const c = editor.activeContainer;
  const doc = editor.doc;
  if (!c || !doc) return [];
  const order: Id[] = [];
  const visit = (nodes: SceneNode[]) => {
    for (const n of nodes) {
      if (ids.includes(n.id)) order.push(n.id);
      else if (n.type === 'group' && n.artboard) visit(n.children);
    }
  };
  visit(c.nodes);
  return order;
}

const SHAPE_TYPES = new Set(['rect', 'ellipse', 'polygon', 'star', 'path']);

export function registerVectorCommands(reg: Reg): void {
  // ---- Node tool actions (also from the Layer menu and palette) -------------
  for (const a of ['sharp', 'smooth', 'symmetric', 'break', 'join', 'close', 'reverse'] as NodeAction[]) {
    reg(`node.${a}`, () => {
      if (nodeAction(a)) return;
      const n = editor.selectedNodes()[0];
      if (!n || !(SHAPE_TYPES.has(n.type) || (n.type === 'group' && n.compound))) return toast('Select a curve or shape first');
      // open the Node tool on the selected curve, then act
      editor.setTool('node');
      setTimeout(() => nodeAction(a), 0);
    });
  }

  // ---- live compounds -------------------------------------------------------
  for (const op of ['add', 'subtract', 'intersect', 'exclude'] as CompoundOp[]) {
    reg(`layer.compound-${op}`, () => {
      const doc = editor.doc;
      if (!doc) return;
      const ids = stackOrdered(sel()).filter((id) => {
        const n = findNode(doc, id)?.node;
        return !!n && !!nodeToPath(n);
      });
      if (ids.length < 2) return toast('Select two or more shapes');
      const first = findNode(doc, ids[0])!.node;
      const fill = 'fill' in first && first.type !== 'textframe' && first.type !== 'imageframe' ? first.fill : first.type === 'group' && first.compound ? first.compound.fill : solid('#3d6fb6');
      const stroke = 'stroke' in first ? first.stroke : first.type === 'group' && first.compound ? first.compound.stroke : makeStroke();
      let gid: Id | null = null;
      editor.commit(`Compound ${op}`, (d) => {
        const r = groupNodes(d, ids, renderBounds);
        gid = r.groupId;
        if (!gid) return d;
        return updateNode<GroupNode>(r.doc, gid, (g) => ({ ...g, name: 'Compound', compound: { op, fill, stroke } }));
      });
      if (gid) editor.select([gid]);
    });
  }
  reg('layer.release-compound', () => {
    const groups = editor.selectedNodes().filter((n): n is GroupNode => n.type === 'group' && !!n.compound);
    if (!groups.length) return toast('Select a compound shape');
    let ids: Id[] = [];
    editor.commit('Release compound', (d) => {
      let out = d;
      for (const g of groups) {
        out = updateNode<GroupNode>(out, g.id, (x) => ({ ...x, compound: undefined }));
        const r = ungroup(out, g.id);
        out = r.doc;
        ids = ids.concat(r.ids);
      }
      return out;
    });
    editor.select(ids);
  });
  reg('layer.expand-compound', () => {
    const groups = editor.selectedNodes().filter((n) => n.type === 'group' && n.compound);
    if (!groups.length) return toast('Select a compound shape');
    editor.commit('Expand compound', (d) => groups.reduce((acc, g) => convertToCurves(acc, g.id), d));
  });

  // ---- symbols --------------------------------------------------------------
  reg('symbol.create', () => {
    const doc = editor.doc;
    if (!doc || !sel().length) return toast('Select the objects to turn into a symbol');
    const n = (doc.symbols?.length ?? 0) + 1;
    let id: Id | null = null;
    editor.commit('Create symbol', (d) => {
      const r = createSymbol(d, stackOrdered(sel()).length ? stackOrdered(sel()) : sel(), `Symbol ${n}`, renderBounds);
      id = r.instanceId;
      return r.doc;
    });
    if (id) editor.select([id]);
  });
  reg('symbol.detach', () => {
    const ids = editor.selectedNodes().filter((n) => n.type === 'group' && n.symbolId).map((n) => n.id);
    if (!ids.length) return toast('Select a symbol instance');
    editor.commit('Detach from symbol', (d) => detachInstances(d, ids));
  });

  // ---- artboards ------------------------------------------------------------
  reg('artboard.insert', () => {
    const doc = editor.doc;
    const c = editor.activeContainer;
    if (!doc || !c || !doc.pages.some((p) => p.id === c.id)) return;
    const picked = stackOrdered(sel()).filter((id) => {
      const loc = findNode(doc, id);
      return loc && !loc.ancestors.length && !(loc.node.type === 'group' && loc.node.artboard);
    });
    let id = '';
    if (picked.length) {
      // wrap the selection in a board fitted to it
      const r = unionRects(picked.map((pid) => renderBounds(findNode(doc, pid)!.node)));
      const ab = makeArtboard({ x: Math.floor(r.x), y: Math.floor(r.y), w: Math.ceil(r.w), h: Math.ceil(r.h) }, nextArtboardName(doc, c.id));
      const kids = picked.map((pid) => {
        const n = findNode(doc, pid)!.node;
        return { ...n, x: n.x - ab.x, y: n.y - ab.y } as SceneNode;
      });
      id = ab.id;
      editor.commit('Insert artboard', (d) => addNodes(removeNodes(d, picked), c.id, [{ ...ab, children: kids }], 0));
    } else {
      // a page-sized board to the right of the existing ones
      const boards = c.nodes.filter((n): n is GroupNode => n.type === 'group' && !!n.artboard);
      const right = boards.length ? Math.max(...boards.map((b) => b.x + b.artboard!.w / 2)) + 80 : 0;
      editor.commit('Insert artboard', (d) => {
        const r = addArtboard(d, c.id, { x: right, y: 0, w: d.settings.width, h: d.settings.height });
        id = r.id;
        return r.doc;
      });
    }
    editor.select([id]);
  });

  // ---- text on a path -------------------------------------------------------
  reg('text.on-path', () => {
    const doc = editor.doc;
    const c = editor.activeContainer;
    if (!doc || !c) return;
    const nodes = editor.selectedNodes();
    const pathNode = nodes.find((n) => SHAPE_TYPES.has(n.type));
    if (!pathNode) return toast('Select a curve or shape (and optionally a text) to put text on');
    const text = nodes.find((n): n is TextNode => n.type === 'text');
    const wp = worldPath(doc, pathNode.id)!;
    const cp = centrePath(wp);
    const style = text?.style ?? { ...make.text().style, fontFamily: editor.ui.toolOptions.fontFamily, fontSize: Math.max(12, Math.round(editor.ui.toolOptions.fontSize / 2)), fill: solid('#1b1b1f') };
    const node = make.text({
      name: 'Text on path',
      x: cp.cx, y: cp.cy,
      text: text?.text || 'Text on a path',
      style,
      stroke: 'stroke' in pathNode ? { ...pathNode.stroke } : makeStroke(),
      onPath: { d: cp.d, start: 0, showPath: false },
    });
    const remove = [pathNode.id, ...(text ? [text.id] : [])];
    const index = c.nodes.findIndex((n) => n.id === pathNode.id);
    editor.commit('Text on path', (d) => addNodes(removeNodes(d, remove), c.id, [node], index >= 0 ? index : undefined));
    editor.select([node.id]);
  });
  reg('text.off-path', () => {
    const doc = editor.doc;
    const t = editor.selectedNodes().find((n): n is TextNode => n.type === 'text' && !!n.onPath);
    if (!doc || !t) return toast('Select text on a path');
    const c = editor.activeContainer!;
    // give the path back as a curve, and the text as plain artistic text beside it
    const curve = make.path({ name: 'Curve', x: t.x, y: t.y, d: transformPath(t.onPath!.d, [1, 0, 0, 1, 0, 0]), closed: t.onPath!.d.some((x) => x[0] === 'Z'), stroke: t.stroke.width ? t.stroke : makeStroke('#1b1b1f', 1), fill: make.path().fill });
    editor.commit('Remove text from path', (d) => {
      const out = updateNode<TextNode>(d, t.id, (x) => ({ ...x, onPath: undefined, stroke: makeStroke() }));
      return addNodes(out, c.id, [curve]);
    });
  });

  // ---- spacing / align helpers ---------------------------------------------
  for (const axis of ['h', 'v'] as const) {
    reg(`arrange.space-${axis}`, () => {
      if (sel().length < 2) return toast('Select two or more objects');
      const gap = editor.ui.toolOptions.spaceGap;
      editor.commit('Space', (d) => spaceNodes(d, sel(), axis, gap, renderBounds));
    });
    reg(`arrange.distribute-centres-${axis}`, () => {
      if (sel().length < 3) return toast('Select three or more objects');
      editor.commit('Distribute centres', (d) => distributeCentres(d, sel(), axis, renderBounds));
    });
  }
  for (const [id, which] of [['arrange.match-width', 'w'], ['arrange.match-height', 'h'], ['arrange.match-size', 'both']] as const) {
    reg(id, () => {
      if (sel().length < 2) return toast('Select two or more objects; the first one sets the size');
      editor.commit('Match size', (d) => matchSize(d, sel(), sel()[0], which, renderBounds));
    });
  }

  // ---- slices ---------------------------------------------------------------
  reg('slice.add', () => {
    const doc = editor.doc;
    const c = editor.activeContainer;
    if (!doc || !c || !doc.pages.some((p) => p.id === c.id)) return;
    const nodes = editor.selectedNodes();
    if (!nodes.length) {
      const before = doc.slices?.length ?? 0;
      editor.commit('Slices from artboards', (d) => slicesFromArtboards(d, c.id));
      if ((editor.doc!.slices?.length ?? 0) === before) {
        editor.commit('Add slice', (d) => addSlice(d, { name: d.title || 'Page', pageId: c.id, rect: { x: 0, y: 0, w: d.settings.width, h: d.settings.height } }).doc);
      }
      return;
    }
    editor.commit('Add slice', (d) => nodes.reduce((acc, n) => {
      const r: Rect = worldBounds(acc, n.id, (x) => renderLocalBounds(x)) ?? { x: 0, y: 0, w: 0, h: 0 };
      return addSlice(acc, { name: n.name, pageId: c.id, nodeId: n.id, rect: r }).doc;
    }, d));
  });
  reg('file.export-slices', () => exportSlices());
}

