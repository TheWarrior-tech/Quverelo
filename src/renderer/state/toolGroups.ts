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
    '|', 'text',
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
