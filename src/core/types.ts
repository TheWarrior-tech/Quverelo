import type { CurvesData } from './curves';
/**
 * Quvrelo document model.
 *
 * One model is shared by all three studios (Photo, Vector, Layout). It is plain,
 * JSON-serialisable data and is treated as immutable: every edit produces a new
 * document object with structural sharing, which makes undo/redo cheap and lets
 * the renderer diff by reference.
 *
 * Coordinates are in document pixels at 96 px per inch. Every node is positioned
 * by its centre (x, y) and has an intrinsic size (w, h) before rotation/scale.
 */

export type Id = string;

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  // Photo parity (Affinity / Photoshop extras): composited per pixel by core/blend.ts,
  // since canvas 2D has no native operator for them.
  | 'linear-burn'
  | 'linear-dodge'
  | 'vivid-light'
  | 'linear-light'
  | 'pin-light'
  | 'hard-mix'
  | 'subtract'
  | 'divide';

/** The 16 W3C compositing modes (native in canvas 2D, SVG and PDF). */
export const BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
];

/** Extra pixel-composited modes (Photo). */
export const EXTENDED_BLEND_MODES: BlendMode[] = [
  'linear-burn', 'linear-dodge', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix', 'subtract', 'divide',
];

/** Every blend mode, in the order the Blend menu lists them (grouped like Affinity / Photoshop). */
export const ALL_BLEND_MODES: BlendMode[] = [
  'normal',
  'darken', 'multiply', 'color-burn', 'linear-burn',
  'lighten', 'screen', 'color-dodge', 'linear-dodge',
  'overlay', 'soft-light', 'hard-light', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix',
  'difference', 'exclusion', 'subtract', 'divide',
  'hue', 'saturation', 'color', 'luminosity',
];

export interface GradientStop {
  offset: number; // 0..1
  color: string; // css colour (#rrggbb or rgba())
}

export type Paint =
  | { type: 'none' }
  | { type: 'solid'; color: string }
  | { type: 'linear'; stops: GradientStop[]; angle: number }
  | { type: 'radial'; stops: GradientStop[] };

export interface Stroke {
  paint: Paint;
  width: number;
  dash: number[];
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
}

/** Absolute path commands in node-local coordinates (centre of node = 0,0). */
export type PathCommand =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Q', number, number, number, number]
  | ['Z'];

export interface Transform {
  x: number;
  y: number;
  rotation: number; // degrees, clockwise
  scaleX: number;
  scaleY: number;
  skewX: number;
  flipX: boolean;
  flipY: boolean;
}

export interface Mask {
  /** Vector mask in node-local coordinates. */
  d: PathCommand[];
  inverted: boolean;
  enabled: boolean;
}

/**
 * Pixel (greyscale) layer mask. The asset is an RGBA canvas whose alpha is the
 * coverage (opaque = shown), stretched over the node's local box. Painting on
 * it with the brush hides/reveals; it stays editable until applied.
 */
export interface PixelMask {
  assetId: Id;
  enabled: boolean;
  inverted: boolean;
}

export interface NodeBase extends Transform {
  id: Id;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..1
  blend: BlendMode;
  mask?: Mask;
  /** greyscale pixel mask (Photo), applied after the vector mask */
  pixelMask?: PixelMask;
  /** clipping mask: drawn only where the nearest unclipped layer below has pixels */
  clipped?: boolean;
}

export interface ShapeStyle {
  fill: Paint;
  stroke: Stroke;
}

export interface RectNode extends NodeBase, ShapeStyle {
  type: 'rect';
  w: number;
  h: number;
  radius: number;
}

export interface EllipseNode extends NodeBase, ShapeStyle {
  type: 'ellipse';
  w: number;
  h: number;
}

export interface PolygonNode extends NodeBase, ShapeStyle {
  type: 'polygon';
  w: number;
  h: number;
  sides: number;
}

export interface StarNode extends NodeBase, ShapeStyle {
  type: 'star';
  w: number;
  h: number;
  points: number;
  innerRatio: number; // 0..1
}

export interface PathNode extends NodeBase, ShapeStyle {
  type: 'path';
  d: PathCommand[];
  closed: boolean;
}

export type TextAlign = 'left' | 'center' | 'right' | 'justify';

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  lineHeight: number; // multiplier
  letterSpacing: number; // em/1000 (tracking)
  align: TextAlign;
  fill: Paint;
  /** OpenType basics (inspector › Text › More type options); absent = font defaults. Pair kerning, default on. */
  kerning?: boolean;
  /** capitals: small caps from the font's smcp/c2sc features */
  caps?: TextCaps;
}

export type TextCaps = 'normal' | 'small-caps' | 'all-small-caps';

/** Artistic text: a single block of text that grows with its content. */
export interface TextNode extends NodeBase {
  type: 'text';
  text: string;
  style: TextStyle;
  stroke: Stroke;
}

/** Layout text frame: a fixed box that shows part of a (possibly linked) story. */
export interface TextFrameNode extends NodeBase {
  type: 'textframe';
  w: number;
  h: number;
  storyId: Id;
  padding: number;
  columns: number;
  columnGap: number;
  fill: Paint;
  stroke: Stroke;
}

export type ImageFit = 'fill' | 'fit' | 'stretch' | 'none';

export interface ImageFrameNode extends NodeBase {
  type: 'imageframe';
  w: number;
  h: number;
  assetId: Id | null;
  fit: ImageFit;
  /** Content offset (frame-local px) and extra content scale, applied after fit. */
  contentX: number;
  contentY: number;
  contentScale: number;
  fill: Paint;
  stroke: Stroke;
}

export type AdjustmentType =
  | 'brightness-contrast'
  | 'levels'
  | 'curves'
  | 'hue-saturation'
  | 'exposure'
  | 'black-white'
  | 'invert'
  | 'posterize'
  | 'threshold'
  | 'vibrance'
  | 'temperature'
  | 'blur'
  | 'sharpen'
  | 'noise'
  | 'vignette'
  | 'color-balance'
  | 'gradient-map'
  | 'motion-blur'
  | 'reduce-noise';

export interface Adjustment {
  id: Id;
  type: AdjustmentType;
  enabled: boolean;
  params: Record<string, number>;
  /** Curves only: control points per channel (see core/curves.ts). */
  curves?: CurvesData;
  /** Gradient map only: the colour ramp, shadows (0) to highlights (1). */
  stops?: GradientStop[];
}

/** Pixel layer. Pixels live in the asset store and are immutable per assetId. */
export interface RasterNode extends NodeBase {
  type: 'raster';
  w: number;
  h: number;
  assetId: Id;
  adjustments: Adjustment[];
}

/**
 * Adjustment layer (Photo): a live adjustment applied to everything composited
 * below it in its parent (the page, or an isolated group), limited to its box
 * and masks. Editable at any time; nothing is baked until it is merged.
 */
export interface AdjustmentNode extends NodeBase {
  type: 'adjustment';
  w: number;
  h: number;
  adjustment: Adjustment;
}

export interface GroupNode extends NodeBase {
  type: 'group';
  children: SceneNode[];
}

export type SceneNode =
  | RectNode
  | EllipseNode
  | PolygonNode
  | StarNode
  | PathNode
  | TextNode
  | TextFrameNode
  | ImageFrameNode
  | RasterNode
  | AdjustmentNode
  | GroupNode;

export type NodeType = SceneNode['type'];

export interface Story {
  id: Id;
  text: string;
  style: TextStyle;
  /** Ordered ids of the text frames the story flows through. */
  chain: Id[];
}

export interface Page {
  id: Id;
  name: string;
  masterId: Id | null;
  nodes: SceneNode[]; // bottom-most first
}

export interface MasterPage {
  id: Id;
  name: string;
  nodes: SceneNode[];
}

export interface Guide {
  id: Id;
  orientation: 'h' | 'v';
  position: number;
}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type Unit = 'px' | 'mm' | 'cm' | 'in' | 'pt';

export interface Swatch {
  id: Id;
  name: string;
  color: string;
}

export interface AssetRef {
  id: Id;
  name: string;
  mime: string;
  width: number;
  height: number;
}

export type StudioKind = 'photo' | 'vector' | 'layout';

export interface DocumentSettings {
  width: number;
  height: number;
  unit: Unit;
  dpi: number; // output resolution hint for raster export
  bleed: number;
  margins: Margins;
  background: string | null; // null = transparent
  facingPages: boolean;
  columns: number;
  columnGutter: number;
}

export interface QuvreloDocument {
  format: 'quvrelo';
  version: 1;
  id: Id;
  title: string;
  createdAt: string;
  modifiedAt: string;
  settings: DocumentSettings;
  pages: Page[];
  masters: MasterPage[];
  stories: Record<Id, Story>;
  guides: Guide[];
  swatches: Swatch[];
  /** Metadata for binary assets (pixels live in the asset store / zip). */
  assets: Record<Id, AssetRef>;
  /** Studio the document was last edited in (UI hint only). */
  studio: StudioKind;
  /** Optional classroom assignment metadata (hand-in workflow). */
  assignment?: AssignmentInfo;
}

export interface AssignmentInfo {
  title: string;
  className: string;
  teacher: string;
  dueDate: string;
  instructions: string;
  studentName?: string;
  submittedAt?: string;
}
