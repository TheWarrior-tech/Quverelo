import type { CurvesData } from './curves';
import type { DocColour } from './colour/profiles';
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

/** A point in a node's bounding box: 0,0 = top-left corner, 1,1 = bottom-right (gradient geometry). */
export interface UnitPoint {
  x: number;
  y: number;
}

/**
 * Paints. Gradient geometry is optional and relative to the painted object's
 * box (see core/gradient.ts): without it a linear gradient runs across the box
 * at `angle`, a radial one fills it from the centre and a conical one sweeps
 * round the centre starting at `angle`.
 */
export type Paint =
  | { type: 'none' }
  | {
      type: 'solid';
      /** css colour in the document's RGB space (what the canvas draws) */
      color: string;
      /** exact CMYK (0..1) when the colour was picked in CMYK or from a CMYK/spot swatch; PDF output writes it as is */
      cmyk?: [number, number, number, number];
      /** spot (named ink) colour: written as a PDF Separation with `cmyk` as its alternate */
      spot?: string;
    }
  | { type: 'linear'; stops: GradientStop[]; angle: number; from?: UnitPoint; to?: UnitPoint }
  | { type: 'radial'; stops: GradientStop[]; center?: UnitPoint; /** edge point; distance from centre = radius */ edge?: UnitPoint; focal?: UnitPoint }
  | { type: 'conical'; stops: GradientStop[]; angle: number; center?: UnitPoint };

export type GradientPaint = Extract<Paint, { type: 'linear' | 'radial' | 'conical' }>;

export type ArrowHead = 'none' | 'triangle' | 'open' | 'circle' | 'square' | 'diamond' | 'bar';

/** One point of a variable-width stroke profile: `t` along the path (0..1), width multiplier `w` (0..1+). */
export interface WidthPoint {
  t: number;
  w: number;
}

export interface Stroke {
  paint: Paint;
  width: number;
  dash: number[];
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  /** mitre limit (default 10) */
  miter?: number;
  /** offset into the dash pattern */
  dashOffset?: number;
  /** arrowheads at the path's start / end (open paths) */
  startArrow?: ArrowHead;
  endArrow?: ArrowHead;
  /** arrowhead size as a multiple of the stroke width × 3 (default 1) */
  arrowScale?: number;
  /** variable width profile; absent or < 2 points = constant width */
  profile?: WidthPoint[];
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
  /** text wrap (Layout); absent = none */
  wrap?: TextWrap;
  /** set on a page item copied from a master item (master override) */
  overrideOf?: Id;
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
  /**
   * How overlapping subpaths fill (SVG fill-rule; Affinity's Alternate /
   * Winding). Absent means even-odd, what every earlier file was drawn with.
   */
  fillRule?: 'nonzero' | 'evenodd';
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
  // --- Pro typography (Layout studio). All optional: absent = the default noted.
  /** standard ligatures (liga/clig), default on */
  ligatures?: boolean;
  /** discretionary ligatures (dlig), default off */
  discretionaryLigatures?: boolean;
  /** figure style: lnum / onum, default = the font's own */
  figures?: FigureStyle;
  /** figure spacing: pnum / tnum, default = the font's own */
  figureSpacing?: FigureSpacing;
  /** baseline shift in px, positive raises */
  baselineShift?: number;
  /** superscript / subscript (synthesised from size and shift) */
  position?: TextPosition;
  strike?: boolean;
  /** paragraph: absolute leading in px (overrides lineHeight when > 0) */
  leading?: number;
  /** paragraph spacing and indents, px */
  spaceBefore?: number;
  spaceAfter?: number;
  firstIndent?: number;
  leftIndent?: number;
  rightIndent?: number;
  /** paragraph: snap baselines to the document baseline grid */
  alignToGrid?: boolean;
  /** paragraph: hyphenate words at line ends (Liang / TeX patterns), default off */
  hyphenate?: boolean;
  /** paragraph: language for hyphenation, default en-GB */
  language?: TextLanguage;
  /** paragraph: tab stops (px from the column's left edge, ascending); past the last, default stops every 48px (½ in) */
  tabStops?: TabStop[];
  /** paragraph: keep the last line in the same column / frame as the next paragraph's first line */
  keepWithNext?: boolean;
  /** paragraph: never split the paragraph across columns / frames */
  keepTogether?: boolean;
  /** paragraph: fewest lines left at the foot of a column when a paragraph breaks (orphans), 0/1 = off */
  orphans?: number;
  /** paragraph: fewest lines carried to the top of the next column (widows), 0/1 = off */
  widows?: number;
}

export type TextLanguage = 'en-GB' | 'en-US';
export type TabAlign = 'left' | 'center' | 'right' | 'decimal';
export interface TabStop {
  /** px from the left edge of the column (inside the frame inset) */
  pos: number;
  align: TabAlign;
  /** characters repeated to fill the tab space ('' or absent = none), e.g. '.' or '. ' */
  leader?: string;
}

export type FigureStyle = 'default' | 'lining' | 'oldstyle';
export type FigureSpacing = 'default' | 'proportional' | 'tabular';
export type TextPosition = 'normal' | 'superscript' | 'subscript';

/** Named paragraph style (paragraph + character attributes); resolved through its basedOn chain. */
export interface ParagraphStyleDef {
  id: Id;
  name: string;
  basedOn: Id | null;
  props: Partial<TextStyle>;
  /** style given to a new paragraph made by pressing Return */
  nextStyle?: Id | null;
}

/** Named character style (character attributes only). */
export interface CharacterStyleDef {
  id: Id;
  name: string;
  basedOn: Id | null;
  props: Partial<TextStyle>;
}

/** Named table cell style. */
export interface CellStyleDef {
  id: Id;
  name: string;
  props: Partial<CellProps>;
}

export interface TextStyleSheet {
  paragraph: ParagraphStyleDef[];
  character: CharacterStyleDef[];
  cell: CellStyleDef[];
}

/** Character formatting over [start, end) of a story's text. Spans are sorted and never overlap. */
export interface CharSpan {
  start: number;
  end: number;
  styleId?: Id | null;
  props?: Partial<TextStyle>;
}

/** Per-paragraph formatting (index = paragraph number in the story). */
export interface ParaAttrs {
  styleId?: Id | null;
  props?: Partial<TextStyle>;
}

/** Text wrap set on an object: text in other frames on its page flows around it. */
export interface TextWrap {
  mode: 'none' | 'box' | 'contour' | 'jump';
  offset: number;
}

export type TextCaps = 'normal' | 'small-caps' | 'all-small-caps';

/** Artistic text: a single block of text that grows with its content. */
export interface TextNode extends NodeBase {
  type: 'text';
  text: string;
  style: TextStyle;
  stroke: Stroke;
  /** Text on a path: glyphs flow along `d` (node-local) starting `start` (0..1) of the way along. */
  onPath?: TextPath;
}

export interface TextPath {
  d: PathCommand[];
  start: number;
  /** put the text on the other side of the path (runs backwards) */
  flip?: boolean;
  /** keep drawing the path itself (stroke from the node's stroke) */
  showPath?: boolean;
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

export interface CellProps {
  fill: Paint;
  /** border colour + width (all four sides) */
  stroke: Paint;
  strokeWidth: number;
  padding: number;
  vAlign: 'top' | 'middle' | 'bottom';
  /** text formatting for the cell's content */
  text: Partial<TextStyle>;
}

export interface TableCell {
  text: string;
  /** character formatting inside the cell (same model as Story.spans) */
  spans?: CharSpan[];
  /** merged cells: the top-left cell carries the span, covered cells are hidden */
  rowSpan?: number;
  colSpan?: number;
  styleId?: Id | null;
  props?: Partial<CellProps>;
}

/** Layout table: rows × cols grid with merges and cell styles. Size = sum of rows/cols. */
export interface TableNode extends NodeBase {
  type: 'table';
  w: number;
  h: number;
  /** column widths and row heights in px (scaled to w/h when the frame is resized) */
  colWidths: number[];
  rowHeights: number[];
  cells: TableCell[][];
  /** number of header rows (drawn with the header style) */
  headerRows: number;
}

/** divide: every overlap becomes its own piece (live, the cut lines show in the stroke; Expand makes the pieces separate curves) */
export type CompoundOp = 'add' | 'subtract' | 'intersect' | 'exclude' | 'divide';

export interface CompoundInfo {
  op: CompoundOp;
  fill: Paint;
  stroke: Stroke;
}

/** An artboard: a group with a fixed, clipped board (node-local, centred on 0,0). */
export interface ArtboardInfo {
  w: number;
  h: number;
  background: string | null;
}

export interface GroupNode extends NodeBase {
  type: 'group';
  children: SceneNode[];
  /**
   * Photo: blend "Normal" (true) composites the children on their own first,
   * so adjustment layers and blend modes inside only see the group's content.
   * Unset / false is "Pass through" (Affinity / Photoshop default): at 100 %
   * Normal the children blend straight into what is below.
   */
  isolated?: boolean;
  /**
   * Non-destructive compound: the children's outlines are combined with this
   * boolean operation (bottom-most child is the base) and drawn as one shape
   * with the compound's own fill and stroke. Children stay editable.
   */
  compound?: CompoundInfo;
  artboard?: ArtboardInfo;
  /** Symbol instance: every group with the same symbolId shows the same children. */
  symbolId?: Id;
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
  | TableNode
  | GroupNode;

export type NodeType = SceneNode['type'];

export interface Story {
  id: Id;
  text: string;
  style: TextStyle;
  /** Ordered ids of the text frames the story flows through. */
  chain: Id[];
  /** character formatting runs (absent = whole story in `style`) */
  spans?: CharSpan[];
  /** paragraph formatting by paragraph index */
  paras?: (ParaAttrs | null)[];
}

export interface Page {
  id: Id;
  name: string;
  masterId: Id | null;
  nodes: SceneNode[]; // bottom-most first
  /** master items hidden on this page because they were overridden (copied to the page) */
  overrides?: Id[];
  /** starts a new section here (page numbering restarts) */
  section?: PageSection;
}

export type PageNumberStyle = 'arabic' | 'roman' | 'ROMAN' | 'alpha' | 'ALPHA';

export interface PageSection {
  name: string;
  /** number of this page; default 1 */
  startAt: number;
  style: PageNumberStyle;
  /** text shown before the number, e.g. "A-" */
  prefix?: string;
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
  /** css colour in the document's RGB space (the on-screen preview) */
  color: string;
  /** a CMYK swatch (0..1): kept exactly and written as CMYK to print PDFs */
  cmyk?: [number, number, number, number];
  /** a spot colour (named ink, such as a Pantone mix the printer stocks); needs `cmyk` as its process alternate */
  spot?: boolean;
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
  /** colour management (absent = RGB, sRGB, 8-bit; see core/colour/profiles.ts) */
  colour?: DocColour;
  /** baseline grid (Layout); absent = off */
  baselineGrid?: BaselineGrid;
}

export interface BaselineGrid {
  enabled: boolean;
  /** first line, px from the top of the page */
  start: number;
  /** increment, px */
  increment: number;
  /** draw the grid on the canvas */
  visible: boolean;
  colour?: string;
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
  /** Named paragraph / character / cell styles (Layout). */
  textStyles?: TextStyleSheet;
  /** Optional classroom assignment metadata (hand-in workflow). */
  assignment?: AssignmentInfo;
  /** Symbols (Vector): names for the symbol ids instances share. */
  symbols?: SymbolDef[];
  /** Export slices (Vector Export persona). */
  slices?: Slice[];
}

export interface SymbolDef {
  id: Id;
  name: string;
  /** the symbol's content (instance-local), kept in step with its instances */
  nodes: SceneNode[];
}

export type SliceFormat = 'png' | 'jpg' | 'svg' | 'pdf';

export interface SliceOutput {
  format: SliceFormat;
  /** 1 = @1x, 2 = @2x ... */
  scale: number;
}

/** An export slice: a named area (or one object's / artboard's bounds) with its own outputs. */
export interface Slice {
  id: Id;
  name: string;
  pageId: Id;
  /** follow this node's bounds (artboard or object); null = fixed rect */
  nodeId: Id | null;
  rect: { x: number; y: number; w: number; h: number };
  outputs: SliceOutput[];
  enabled: boolean;
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
