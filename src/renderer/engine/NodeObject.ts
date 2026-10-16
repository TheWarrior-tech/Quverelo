import { FabricObject, classRegistry } from 'fabric';
import type { SceneNode } from '../../core/types';
import { composeTransform, invert } from '../../core/geometry';
import { isNativeBlend } from '../../core/blend';
import { tuneControls } from './controls';
import { drawNodeContent, drawNodeTransformed, renderLocalBounds, type DrawEnv } from './draw';
import { clipInfo, drawClipGroup, drawLayered, needsLayer } from './compose';

/** Node types whose scale is baked into their size (frames resize instead of stretching). */
export const RESIZE_TYPES = new Set(['rect', 'ellipse', 'polygon', 'star', 'textframe', 'imageframe']);

/**
 * Fabric proxy for a model node. Fabric provides hit-testing, selection and
 * transform handles; drawing is delegated to the shared scene renderer.
 */
export class NodeObject extends FabricObject {
  static type = 'QuvreloNode';
  node!: SceneNode;
  nodeId!: string;
  isMaster = false;
  envRef!: () => DrawEnv;

  constructor(node: SceneNode, envRef: () => DrawEnv, isMaster = false) {
    super({ originX: 'center', originY: 'center' });
    this.envRef = envRef;
    this.isMaster = isMaster;
    this.objectCaching = false;
    this.strokeWidth = 0;
    this.stroke = null;
    this.fill = null;
    tuneControls(this);
    this.applyNode(node);
  }

  applyNode(node: SceneNode): void {
    this.node = node;
    this.nodeId = node.id;
    const b = renderLocalBounds(node);
    const w = Math.max(1, b.w);
    const h = Math.max(1, b.h);
    const m = composeTransform(node);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    this.set({
      left: m[0] * cx + m[2] * cy + m[4],
      top: m[1] * cx + m[3] * cy + m[5],
      width: w,
      height: h,
      angle: node.rotation,
      scaleX: node.scaleX,
      scaleY: node.scaleY,
      skewX: node.skewX,
      flipX: node.flipX,
      flipY: node.flipY,
      opacity: node.opacity,
      visible: node.visible,
      // per-pixel blend modes are composited in _render (engine/compose.ts)
      globalCompositeOperation: node.blend === 'normal' || !isNativeBlend(node.blend) ? 'source-over' : node.blend,
    });
    const locked = node.locked || this.isMaster;
    this.selectable = !locked;
    // an adjustment layer covers the page; pick it in the Layers panel, never by a canvas click
    this.evented = !locked && node.type !== 'adjustment';
    this.lockScalingFlip = false;
    this.setCoords();
  }

  /** Centre offset of local bounds (non-zero for off-centre paths). */
  centreOffset(): { x: number; y: number } {
    const b = renderLocalBounds(this.node);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }

  _render(ctx: CanvasRenderingContext2D): void {
    const env = this.envRef();
    const node = this.node;
    const clip = clipInfo(env.doc).get(node.id);
    if (clip?.follower) return; // drawn inside its clip base
    const off = this.centreOffset();
    ctx.save();
    ctx.translate(-off.x, -off.y);
    if (clip?.followers || needsLayer(node)) {
      // fabric has applied opacity to globalAlpha; composite it ourselves instead
      const alpha = ctx.globalAlpha;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (clip?.followers) {
        // the run is drawn in the parent's space: undo this node's own transform
        const m = invert(composeTransform(node));
        ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
        drawClipGroup(ctx, node, clip.followers, env, drawNodeTransformed, alpha);
      } else {
        drawLayered(ctx, node, env, alpha, node.blend, (x) => drawNodeContent(x, node, env), node.type === 'group' ? undefined : renderLocalBounds(node));
      }
      ctx.restore();
      return;
    }
    const sx = this.scaleX / (node.scaleX || 1);
    const sy = this.scaleY / (node.scaleY || 1);
    if (RESIZE_TYPES.has(node.type) && (Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6) && 'w' in node) {
      // live resize preview: draw a resized node instead of a stretched one
      ctx.scale(1 / sx, 1 / sy);
      const tmp = { ...node, w: node.w * Math.abs(sx), h: node.h * Math.abs(sy) } as SceneNode;
      drawNodeContent(ctx, tmp, env);
    } else {
      drawNodeContent(ctx, node, env);
    }
    ctx.restore();
  }
}

classRegistry.setClass(NodeObject);
