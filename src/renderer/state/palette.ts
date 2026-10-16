/**
 * Command palette data: open/close events, the searchable entries (menu
 * commands, tools, templates, recent files) and the palette's own "Recent"
 * history. The React side lives in ui/CommandPalette.tsx.
 */
import { APP_MENU, allMenuCommands } from '../../shared/menu';
import { TEMPLATES } from '../../core/templates';
import type { StudioKind } from '../../core/types';
import type { RecentFile } from '../../shared/api';
import { STUDIO_TOOLS, editor, type ToolId } from './editor';
import { hasCommand, runCommand } from './commands';
import { openDialog } from './bus';
import { newFromTemplate, openPath } from './io';
import { disabledReason, pushRecent, TOOL_KEYWORDS, type PaletteContext } from './paletteModel';
import { toolName } from './toolGroups';

export interface PaletteEntry {
  /** Stable id: `cmd:file.save`, `tool:pen`, `template:worksheet`, `file:/path`. */
  key: string;
  label: string;
  group: string;
  keywords?: readonly string[];
  icon?: string;
  /** Electron accelerator or a literal key ('V'). */
  keys?: string;
  /** Why it can't run right now, or null. */
  disabled: string | null;
  run: () => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// open / close

type Listener = (open: boolean) => void;
const listeners = new Set<Listener>();
let isOpen = false;

export function paletteOpen(): boolean {
  return isOpen;
}

/** Opens the palette. Idempotent, so a native menu accelerator and the renderer key handler firing together is harmless. */
export function openPalette(): void {
  if (isOpen) return;
  // never stack over a modal dialog
  if (document.querySelector('.dialog-backdrop')) return;
  isOpen = true;
  for (const l of listeners) l(true);
}

export function closePalette(): void {
  if (!isOpen) return;
  isOpen = false;
  for (const l of listeners) l(false);
}

export function onPalette(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// ---------------------------------------------------------------------------
// recents (what was run from the palette)

const RECENT_KEY = 'quvrelo.palette.recent';

export function recentKeys(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberRun(key: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(pushRecent(recentKeys(), key)));
  } catch {
    /* storage unavailable */
  }
}

// ---------------------------------------------------------------------------
// entries

const STUDIO_NAME: Record<StudioKind, string> = { photo: 'Photo', vector: 'Vector', layout: 'Layout' };

const TOOL_NAMES: Record<ToolId, [string, string?]> = {
  move: ['Move', 'V'], node: ['Node', 'A'], hand: ['Hand', 'H'], zoom: ['Zoom', 'Z'],
  'marquee-rect': ['Rectangle Marquee', 'M'], 'marquee-ellipse': ['Ellipse Marquee'], lasso: ['Freehand Selection', 'L'], 'object-select': ['Object Select', 'W'],
  brush: ['Paint Brush', 'B'], eraser: ['Eraser', 'E'], fill: ['Flood Fill', 'G'], eyedropper: ['Colour Picker', 'I'], crop: ['Crop', 'C'],
  pen: ['Pen', 'P'], pencil: ['Pencil', 'N'], rect: ['Rectangle', 'M'], ellipse: ['Ellipse', 'E'], polygon: ['Polygon', 'Y'], star: ['Star', 'S'], line: ['Line', 'L'],
  text: ['Artistic Text', 'T'], textframe: ['Frame Text', 'X'], imageframe: ['Picture Frame', 'F'],
  'polygon-lasso': ['Polygonal Selection'], 'magic-wand': ['Magic Wand'], clone: ['Clone', 'S'], heal: ['Healing Brush'],
  'spot-heal': ['Spot Healing', 'J'], dodge: ['Dodge', 'O'], burn: ['Burn'], smudge: ['Smudge', 'R'], liquify: ['Liquify'],
};

/** Icon for a menu command; every command has one (tests/unit/paletteIcons.test.ts). */
export function commandIcon(id: string): string | undefined {
  const direct: Record<string, string> = {
    'file.new': 'new', 'file.open': 'open', 'file.close': 'close', 'file.save': 'save', 'file.save-as': 'save', 'file.place': 'image',
    'file.import-svg': 'vector', 'file.hand-in': 'handin', 'file.assignment': 'handin', 'file.document-setup': 'pages', 'app.preferences': 'settings',
    'edit.undo': 'undo', 'edit.redo': 'redo', 'edit.copy': 'copy', 'edit.cut': 'copy', 'edit.paste': 'copy', 'edit.duplicate': 'copy', 'edit.delete': 'trash',
    'edit.select-all': 'select-all', 'edit.deselect': 'deselect', 'arrange.group': 'group', 'arrange.ungroup': 'group',
    'arrange.front': 'arrow-up', 'arrange.forward': 'arrow-up', 'arrange.backward': 'arrow-down', 'arrange.back': 'arrow-down',
    'arrange.rotate-cw': 'rotate', 'arrange.rotate-ccw': 'rotate', 'layer.new-pixel': 'pixel', 'layer.rasterize': 'pixel', 'layer.merge-down': 'arrow-down',
    'layer.mask-selection': 'mask', 'layer.mask-shape': 'mask', 'layer.release-mask': 'mask', 'layer.convert-curves': 'node',
    'layer.lock': 'lock', 'layer.hide': 'eye', 'select.all-pixels': 'select-all', 'select.none': 'deselect', 'select.invert': 'select-invert',
    'select.subject': 'subject', 'select.remove-background': 'remove-bg', 'select.crop': 'crop', 'select.fill': 'fill', 'select.clear': 'eraser', 'select.copy-to-layer': 'copy',
    'page.add': 'pages', 'page.duplicate': 'pages', 'page.delete': 'pages', 'page.prev': 'chevron-left', 'page.next': 'chevron-right',
    'master.add': 'pages', 'text.link': 'link', 'text.unlink': 'link', 'doc.resize': 'rect', 'view.zoom-in': 'zoom', 'view.zoom-out': 'zoom',
    'view.zoom-fit': 'zoom', 'view.zoom-100': 'zoom', 'help.shortcuts': 'keyboard', 'help.command-palette': 'keyboard', 'help.check-updates': 'update',
    'help.guide': 'help', 'help.about': 'help',
    // Photo parity
    'layer.mask-add': 'mask', 'layer.mask-hide-all': 'mask', 'layer.mask-edit': 'brush', 'layer.mask-enable': 'eye', 'layer.mask-invert': 'select-invert',
    'layer.mask-apply': 'check', 'layer.mask-delete': 'trash', 'layer.mask-to-selection': 'marquee-rect', 'layer.clip': 'clip',
    'select.color-range': 'eyedropper', 'select.magic-wand': 'magic-wand', 'select.feather': 'feather', 'select.refine': 'feather', 'select.save-to-mask': 'mask',
    'filter.gaussian-blur': 'filter', 'filter.motion-blur': 'filter', 'filter.unsharp-mask': 'filter', 'filter.add-noise': 'filter', 'filter.reduce-noise': 'filter',
    'layer.adjust-levels': 'adjust', 'layer.adjust-curves': 'adjust', 'layer.adjust-hue-saturation': 'adjust', 'layer.adjust-brightness-contrast': 'adjust', 'layer.adjust-exposure': 'adjust', 'layer.adjust-vibrance': 'adjust', 'layer.adjust-color-balance': 'adjust', 'layer.adjust-temperature': 'adjust', 'layer.adjust-black-white': 'adjust', 'layer.adjust-gradient-map': 'adjust', 'layer.adjust-invert': 'adjust', 'layer.adjust-threshold': 'adjust', 'layer.adjust-posterize': 'adjust',
    'filter.vignette': 'filter',
    'filter.liquify': 'liquify', 'doc.canvas-size': 'crop',
    // every command has an icon, so no row reads as a gap (critique 3 P2-5)
    'doc.clear-guides': 'close', 'view.rulers': 'layout', 'view.snapping': 'magnet', 'view.theme-dark': 'adjust', 'view.theme-light': 'adjust',
    'view.theme-contrast': 'adjust', 'view.ui-bigger': 'plus', 'view.ui-smaller': 'minus', 'view.ui-reset': 'undo', 'view.devtools': 'settings',
  };
  if (direct[id]) return direct[id];
  if (id === 'file.export' || id.startsWith('file.export-')) return 'export';
  if (id.startsWith('studio.')) return id.slice(7);
  if (id.startsWith('layer.adjust-')) return 'adjust';
  const tail = id.split('.')[1];
  if (/^(align-|distribute-|flip-|bool-)/.test(tail)) return tail;
  return undefined;
}

export function paletteContext(): PaletteContext {
  const sel = editor.session ? editor.selectedNodes() : [];
  return {
    hasDoc: !!editor.doc,
    selection: sel.length,
    groups: sel.filter((n) => n.type === 'group').length,
    textFrames: sel.filter((n) => n.type === 'textframe').length,
    pixelSelection: !!editor.ui.pixelSelection,
    canUndo: !!editor.history?.canUndo,
    canRedo: !!editor.history?.canRedo,
    pages: editor.doc?.pages.length ?? 0,
    pageIndex: editor.doc ? editor.activePageIndex : -1,
    studio: editor.ui.studio,
  };
}

/** Run something that replaces the open document, asking first if it has unsaved changes. */
function replacingDocument(run: () => void | Promise<void>): void {
  if (!editor.history?.dirty) {
    void run();
    return;
  }
  openDialog('confirm', {
    title: `Save changes to “${editor.doc?.title || 'Untitled'}” first?`,
    message: "Opening something else replaces it. Your changes will be lost if you don't save them.",
    actions: [
      { label: 'Save', primary: true, run: async () => { await runCommand('file.save'); if (!editor.history?.dirty) void run(); } },
      { label: "Don't save", run: () => void run() },
      { label: 'Cancel', run: () => undefined },
    ],
  });
}

/** Everything the palette can search, in display order (commands in menu order, then tools, templates, recent files). */
export function buildEntries(recentFiles: readonly RecentFile[] = []): PaletteEntry[] {
  const ctx = paletteContext();
  const out: PaletteEntry[] = [];

  // menu commands (same policy filtering as the native menu)
  let group = '';
  for (const c of allMenuCommands()) {
    if (c.id === 'help.command-palette' || !hasCommand(c.id)) continue;
    if (c.feature && !editor.feature(c.feature)) continue;
    if (c.id === 'help.check-updates' && editor.policy.disableUpdateCheck) continue;
    group = sectionOf(c.id);
    out.push({
      key: `cmd:${c.id}`,
      label: c.label.replace(/…$/, ''),
      group,
      keywords: c.keywords,
      icon: commandIcon(c.id),
      keys: c.accel,
      disabled: disabledReason(c.id, ctx),
      run: () => runCommand(c.id),
    });
  }

  // tools: current studio's tools switch directly; others switch studio first
  const studios = (['photo', 'vector', 'layout'] as StudioKind[]).filter((s) => editor.feature(s));
  const order = [editor.ui.studio, ...studios.filter((s) => s !== editor.ui.studio)].filter((s) => studios.includes(s));
  const seen = new Set<ToolId>();
  for (const st of order) {
    for (const t of STUDIO_TOOLS[st]) {
      if (seen.has(t)) continue;
      seen.add(t);
      const [, key] = TOOL_NAMES[t];
      const name = toolName(t);
      const here = st === editor.ui.studio;
      out.push({
        key: `tool:${t}`,
        label: `${name} tool`,
        group: here ? 'Tool' : `${STUDIO_NAME[st]} tool`,
        keywords: TOOL_KEYWORDS[t],
        icon: t,
        keys: here ? key : undefined,
        disabled: ctx.hasDoc ? null : 'Open or create a document first',
        run: () => {
          if (!here) editor.setStudio(st);
          editor.setTool(t);
        },
      });
    }
  }

  // templates
  {
    for (const t of TEMPLATES) {
      if (!editor.feature(t.studio)) continue;
      out.push({
        key: `template:${t.id}`,
        label: `New ${t.name}`,
        group: 'Template',
        keywords: [t.description, t.category, t.size, 'template', 'new'],
        icon: t.studio,
        disabled: null,
        run: () => replacingDocument(() => newFromTemplate(t.id)),
      });
    }
  }

  // recent files
  for (const r of recentFiles) {
    out.push({
      key: `file:${r.path}`,
      label: r.name.replace(/\.(quvrelo|easel)$/i, ''),
      group: 'Recent file',
      keywords: [r.path, 'recent', 'open'],
      icon: 'folder',
      disabled: null,
      run: () => replacingDocument(() => openPath(r.path)),
    });
  }
  return out;
}

const SECTION: Record<string, string> = {};
for (const s of APP_MENU) {
  for (const i of s.items) if (i !== '-') SECTION[i.id] = s.label;
}
function sectionOf(id: string): string {
  return SECTION[id] ?? '';
}
