/**
 * Tool-rail layout per studio, including flyout groups (CRITIQUE #21).
 *
 * A group shows one tool on the rail (the last one used) with a small corner
 * triangle; long-press or right-click opens a flyout listing every member.
 * Shift + a member's shortcut key cycles through the group.
 *
 * Pure data + helpers so it can be unit-tested without a DOM. Only types are
 * imported from the editor, which itself derives STUDIO_TOOLS from this file.
 */
import type { StudioKind } from '../../core/types';
import type { ToolId } from './editor';

export interface ToolGroup {
  /** unique across studios (layout and vector shapes differ) */
  id: string;
  /** accessible name of the flyout menu */
  label: string;
  /** members, in flyout order; the first is shown until another is used */
  tools: ToolId[];
  /** canonical cycle key, shown as "Shift+M" (any member's own key also cycles) */
  key: string;
}

/** A rail entry: a single tool, a flyout group, or '|' for a divider. */
export type RailEntry = ToolId | ToolGroup | '|';

const g = (id: string, label: string, key: string, tools: ToolId[]): ToolGroup => ({ id, label, key, tools });

export const STUDIO_RAIL: Record<StudioKind, RailEntry[]> = {
  photo: [
    'move', g('photo-marquee', 'Marquee tools', 'M', ['marquee-rect', 'marquee-ellipse']), 'lasso', 'object-select', 'crop',
    '|', 'brush', 'eraser', 'fill', 'eyedropper',
    '|', 'text', g('photo-shapes', 'Shape tools', 'U', ['rect', 'ellipse', 'polygon', 'star']),
    '|', 'hand', 'zoom',
  ],
  vector: [
    'move', 'node',
    '|', g('vector-pen', 'Pen tools', 'P', ['pen', 'pencil']),
    '|', g('vector-shapes', 'Shape tools', 'M', ['rect', 'ellipse', 'polygon', 'star']), 'line',
    '|', 'text', 'eyedropper',
    '|', 'hand', 'zoom',
  ],
  layout: [
    'move', 'node',
    '|', g('layout-text', 'Text tools', 'X', ['textframe', 'text']), 'imageframe',
    '|', g('layout-shapes', 'Shape tools', 'M', ['rect', 'ellipse']), 'line', 'eyedropper',
    '|', 'hand', 'zoom',
  ],
};

/**
 * Single-letter tool shortcuts, per studio (plus `common`). Photo's shapes use
 * U (Photoshop's shape key) because M is the marquee and E the eraser there;
 * the other Photo shapes are reached with Shift+U.
 */
export const TOOL_KEYS: Record<'common' | StudioKind, Record<string, ToolId>> = {
  common: { v: 'move', h: 'hand', z: 'zoom', t: 'text', i: 'eyedropper' },
  photo: { m: 'marquee-rect', l: 'lasso', w: 'object-select', b: 'brush', e: 'eraser', g: 'fill', c: 'crop', u: 'rect' },
  vector: { a: 'node', p: 'pen', n: 'pencil', m: 'rect', e: 'ellipse', l: 'line', s: 'star', y: 'polygon' },
  layout: { a: 'node', f: 'imageframe', m: 'rect', e: 'ellipse', l: 'line', x: 'textframe' },
};

/** The tool a single key selects in a studio. */
export function toolForKeyIn(studio: StudioKind, key: string): ToolId | null {
  const k = key.toLowerCase();
  return TOOL_KEYS[studio][k] ?? TOOL_KEYS.common[k] ?? null;
}

/** A tool's own shortcut letter in a studio ('U'), if it has one there. */
export function toolKeyIn(studio: StudioKind, tool: ToolId): string | undefined {
  const own = Object.entries(TOOL_KEYS[studio]).find(([, t]) => t === tool)?.[0];
  const k = own ?? Object.entries(TOOL_KEYS.common).find(([, t]) => t === tool)?.[0];
  return k?.toUpperCase();
}

/** The studio whose rail holds a group. */
export function studioOfGroup(group: ToolGroup): StudioKind | null {
  return (Object.keys(STUDIO_RAIL) as StudioKind[]).find((s) => STUDIO_RAIL[s].some((e) => isGroup(e) && e.id === group.id)) ?? null;
}

export function isGroup(e: RailEntry): e is ToolGroup {
  return typeof e === 'object';
}

/** Every tool a studio offers, in rail order (flyout members included). */
export function studioTools(studio: StudioKind): ToolId[] {
  return STUDIO_RAIL[studio].flatMap((e) => (e === '|' ? [] : isGroup(e) ? e.tools : [e]));
}

export function studioGroups(studio: StudioKind): ToolGroup[] {
  return STUDIO_RAIL[studio].filter(isGroup);
}

/** The flyout group a tool belongs to in a studio, if any. */
export function groupOf(studio: StudioKind, tool: ToolId): ToolGroup | null {
  return studioGroups(studio).find((gr) => gr.tools.includes(tool)) ?? null;
}

/** Last-used tool per group id. */
export type RailMemory = Record<string, ToolId>;

/** The member shown on the rail: the active tool if it is in the group, else the last used, else the first. */
export function visibleTool(group: ToolGroup, current: ToolId, memory: RailMemory): ToolId {
  if (group.tools.includes(current)) return current;
  const last = memory[group.id];
  return last && group.tools.includes(last) ? last : group.tools[0];
}

/** Memory after `tool` was chosen in `studio` (unchanged object when nothing moves). */
export function remember(memory: RailMemory, studio: StudioKind, tool: ToolId): RailMemory {
  const gr = groupOf(studio, tool);
  if (!gr || memory[gr.id] === tool) return memory;
  return { ...memory, [gr.id]: tool };
}

/**
 * Shift+key: when the active tool is already in the group, step to the next
 * member (wrapping); otherwise switch to the group's visible member first.
 */
export function cycleTool(group: ToolGroup, current: ToolId, memory: RailMemory, dir: 1 | -1 = 1): ToolId {
  const i = group.tools.indexOf(current);
  if (i < 0) return visibleTool(group, current, memory);
  return group.tools[(i + dir + group.tools.length) % group.tools.length];
}

/**
 * Tool names as the UI shows them, with the default key in brackets: sentence
 * case (DESIGN.md §4), shared by tooltips, flyouts and the Shortcuts dialog.
 */
export const TOOL_LABELS: Record<ToolId, string> = {
  move: 'Move (V)', node: 'Node (A)', hand: 'Hand (H)', zoom: 'Zoom (Z)',
  'marquee-rect': 'Rectangle marquee (M)', 'marquee-ellipse': 'Ellipse marquee', lasso: 'Freehand selection (L)', 'object-select': 'Object select (W)',
  brush: 'Paint brush (B)', eraser: 'Eraser (E)', fill: 'Flood fill (G)', eyedropper: 'Colour picker (I)', crop: 'Crop (C)',
  pen: 'Pen (P)', pencil: 'Pencil (N)', rect: 'Rectangle (M)', ellipse: 'Ellipse (E)', polygon: 'Polygon (Y)', star: 'Star (S)', line: 'Line (L)',
  text: 'Artistic text (T)', textframe: 'Frame text (X)', imageframe: 'Picture frame (F)',
};

/** A tool's display name without its key ('Rectangle marquee'). */
export function toolName(t: ToolId): string {
  return (TOOL_LABELS[t] ?? t).replace(/ \([^)]*\)$/, '');
}
