import { useEffect, useRef, useState } from 'react';
import type { StudioKind } from '../../core/types';
import { editor, STUDIO_TOOLS } from '../state/editor';
import { STUDIO_RAIL, groupOf, isGroup } from '../state/toolGroups';
import { RailGroup, TOOL_HINTS, toolParts } from './ToolFlyout';
import { runCommand, setViewport, setSetting } from '../state/commands';
import { Viewport } from '../engine/Viewport';
import { useEditor } from './hooks';
import { Icon, Logo } from './Icons';
import { ContextBar } from './ContextBar';
import { SelectionActions } from './SelectionActions';
import { Rulers } from './Rulers';
import { Panels } from './panels/Panels';
import { tip } from './tips';
import { applyFillToSelection, applyStrokeToSelection, swapFillStroke } from './panels/ColorPanel';
import { ColorPopoverBody, FillStrokeChips, type ChipTarget } from './color/Chips';
import { Popover } from './controls/Panel';
import { uiPaint, uiPaintPatch } from '../state/uiPaint';
import { statusLine, useUpdateState } from '../state/updates';
import { LeftRail } from './panels/LeftRail';
import { SelectionToolbar } from './SelectionToolbar';
import { openDialog, toast } from '../state/bus';
import { enabledExportFormats, exportFormatFor, lastExportFor } from '../state/io';
import { Menu, type MenuEntry } from './controls/Menu';
import { shortcutFor } from './tips';

export { toolLabel } from './ToolFlyout';

const STUDIOS: { id: StudioKind; label: string }[] = [
  { id: 'photo', label: 'Photo' },
  { id: 'vector', label: 'Vector' },
  { id: 'layout', label: 'Layout' },
];

/**
 * Segmented studio switch. Exactly one segment is active (aria-pressed); it
 * sits in the middle column of the top bar's grid so it never moves when the
 * right-hand icon cluster changes width. Arrow keys move between studios.
 */
function StudioSwitch() {
  const ed = useEditor();
  const studios = STUDIOS.filter((s) => ed.feature(s.id));
  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = studios.findIndex((s) => s.id === ed.ui.studio);
    const next = studios[(i + (e.key === 'ArrowRight' ? 1 : studios.length - 1)) % studios.length];
    ed.setStudio(next.id);
    (e.currentTarget.querySelector(`[data-studio="${next.id}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <nav className="studio-switch" aria-label="Studios" onKeyDown={onKey}>
      {studios.map((s) => {
        const on = ed.ui.studio === s.id;
        return (
          <button key={s.id} data-studio={s.id} className={on ? 'active' : undefined} aria-pressed={on} tabIndex={on ? 0 : -1} onClick={() => ed.setStudio(s.id)} {...tip(`${s.label} Studio`, `studio.${s.id}`)} aria-label={undefined}>
            <Icon name={s.id} /> {s.label}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Document identity (top-bar zone 1): the name, renamed in place (click, type,
 * Enter; Esc cancels), and the save state as quiet text with a dot.
 */
function DocIdentity() {
  const ed = useEditor();
  const [editing, setEditing] = useState(false);
  const title = ed.doc?.title ?? '';
  const dirty = !!ed.history?.dirty;
  const saved = !!ed.session?.filePath;
  const state = dirty ? 'Edited' : saved ? 'Saved' : 'Not saved';
  const stateTip = dirty ? 'Unsaved changes' : saved ? 'All changes saved' : 'This document has not been saved yet';
  return (
    <div className="doc-identity">
      <Logo className="logo" />
      {editing ? (
        <input
          className="doc-title-input"
          type="text"
          aria-label="Document name"
          autoFocus
          defaultValue={title}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            setEditing(false);
            const v = e.target.value.trim();
            if (v && v !== title) ed.commit('Rename document', (x) => ({ ...x, title: v }));
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <button type="button" className="doc-title" data-tip={`${title} · click to rename`} aria-label={`Document name: ${title}. Click to rename`} onClick={() => setEditing(true)}>
          {title}
        </button>
      )}
      <span className={`doc-state${dirty ? ' dirty' : ''}`} data-tip={stateTip} role="status">
        <i aria-hidden="true" />
        {state}
      </span>
    </div>
  );
}

/**
 * Top bar in three semantic zones (DESIGN.md §8 v3, MOBBIN #4):
 * document identity | studio switch + tools | outbound actions, with Export as
 * the single filled (primary) button in the bar.
 */
function Topbar() {
  const ed = useEditor();
  const h = ed.history;
  return (
    <header className="topbar" role="toolbar" aria-label="Main toolbar">
      <div className="topbar-zone identity">
        <DocIdentity />
      </div>
      <div className="topbar-zone centre">
        <StudioSwitch />
        <span className="sep" aria-hidden="true" />
        <button className="icon-btn" {...tip('Undo', 'edit.undo')} disabled={!h?.canUndo} onClick={() => runCommand('edit.undo')}><Icon name="undo" /></button>
        <button className="icon-btn" {...tip('Redo', 'edit.redo')} disabled={!h?.canRedo} onClick={() => runCommand('edit.redo')}><Icon name="redo" /></button>
        {ed.feature('import-images') && <button className="icon-btn" {...tip('Place image…', 'file.place')} onClick={() => runCommand('file.place')}><Icon name="image" /></button>}
      </div>
      <div className="topbar-zone actions">
        <button className="icon-btn" {...tip('Open…', 'file.open')} onClick={() => runCommand('file.open')}><Icon name="open" /></button>
        <button className="icon-btn" {...tip('Save', 'file.save')} onClick={() => runCommand('file.save')}><Icon name="save" /></button>
        <button className="icon-btn" {...tip('Keyboard shortcuts', 'help.shortcuts')} onClick={() => runCommand('help.shortcuts')}><Icon name="keyboard" /></button>
        <button className="icon-btn" {...tip('Preferences', 'app.preferences')} onClick={() => runCommand('app.preferences')}><Icon name="settings" /></button>
        <ExportSplit />
      </div>
    </header>
  );
}

const FORMAT_NAMES = { png: 'PNG', jpg: 'JPEG', svg: 'SVG', pdf: 'PDF' } as const;

/**
 * Top-bar "Export ▾" split button (UX audit P0-5). The main half opens the
 * Export dialog on the right format (last used for this document, PDF for Layout
 * documents); the chevron opens Export… · Export again · one row per format ·
 * Hand in… (when assignments are on).
 */
function ExportSplit() {
  const ed = useEditor();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const formats = enabledExportFormats();
  const assignments = ed.feature('assignments');
  if (!formats.length && !assignments) return null;
  const last = lastExportFor(ed.doc?.id);
  const def = formats.length ? exportFormatFor() : null;
  const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
  const items: MenuEntry[] = [];
  if (formats.length) {
    items.push(
      { id: 'export', label: 'Export…', keys: shortcutFor('file.export'), detail: def ? `Opens on ${FORMAT_NAMES[def]}` : undefined, run: () => void runCommand('file.export') },
      {
        id: 'export-again',
        label: 'Export again',
        keys: shortcutFor('file.export-again'),
        detail: last ? `${FORMAT_NAMES[last.req.format]} · ${last.paths.length === 1 ? fileName(last.paths[0]) : `${last.paths.length} files`}` : 'Export once first',
        disabled: !last,
        run: () => void runCommand('file.export-again'),
      },
      '-',
      { heading: 'Format' },
      ...formats.map((f) => ({ id: `export-${f}`, label: `${FORMAT_NAMES[f]}…`, keys: shortcutFor(`file.export-${f}`), run: () => void runCommand(`file.export-${f}`) })),
    );
  }
  if (assignments) {
    if (items.length) items.push('-');
    items.push({ id: 'hand-in', label: 'Hand in…', detail: ed.doc?.assignment?.title ? `To ${ed.doc.assignment.className || 'class'}` : undefined, run: () => void runCommand('file.hand-in') });
  }
  const main = () => (formats.length ? void runCommand('file.export') : void runCommand('file.hand-in'));
  return (
    <div className="split-btn primary" data-testid="export-split">
      <button type="button" className="btn primary split-main export-btn" onClick={main} {...tip(formats.length ? 'Export…' : 'Hand in…', formats.length ? 'file.export' : undefined)} aria-label={undefined}>
        <Icon name="export" size={16} />
        <span>Export</span>
      </button>
      <button
        type="button"
        className="split-more"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        {...tip('More export options')}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        data-testid="export-menu"
      >
        <Icon name="chevron-down" size={16} />
      </button>
      {anchor && <Menu anchor={anchor} label="Export" align="end" items={items} onClose={() => setAnchor(null)} />}
    </div>
  );
}

/** Fill/stroke chips at the foot of the tool rail; clicking one opens its picker beside the rail. */
function RailChips() {
  const ed = useEditor();
  const [target, setTarget] = useState<ChipTarget>('fill');
  const [open, setOpen] = useState<{ t: ChipTarget; el: HTMLElement } | null>(null);
  const isFill = open?.t === 'fill';
  return (
    <>
      <FillStrokeChips
        size="sm"
        fill={{ color: ed.ui.fillColor, enabled: ed.ui.fillEnabled }}
        stroke={{ color: ed.ui.strokeColor, enabled: ed.ui.strokeEnabled }}
        target={target}
        onTarget={setTarget}
        onSwap={swapFillStroke}
        onOpen={(t, el) => setOpen(open && open.t === t ? null : { t, el })}
      />
      {open && (
        <Popover anchor={open.el} placement="right" label={isFill ? 'Fill colour' : 'Stroke colour'} onClose={() => setOpen(null)}>
          <ColorPopoverBody
            label={isFill ? 'Fill' : 'Stroke'}
            value={uiPaint(ed.ui, open.t)}
            fallback={isFill ? ed.ui.fillColor : ed.ui.strokeColor}
            onChange={(p) => {
              ed.setUi(uiPaintPatch(open.t, p, ed.ui));
              if (ed.ui.selection.length) (isFill ? applyFillToSelection : applyStrokeToSelection)(p, isFill ? 'rail-fill' : 'rail-stroke');
            }}
          />
        </Popover>
      )}
    </>
  );
}

/**
 * Tool rail. Related tools share one button with a flyout (toolGroups.ts);
 * dividers come from the rail layout.
 */
function ToolPalette() {
  const ed = useEditor();
  const rail = STUDIO_RAIL[ed.ui.studio];
  return (
    <aside className="toolpalette" role="toolbar" aria-label="Tools" aria-orientation="vertical" data-tip-side="right">
      {rail.map((e, i) =>
        e === '|' ? (
          <div key={`d${i}`} className="divider" />
        ) : isGroup(e) ? (
          <RailGroup key={e.id} group={e} />
        ) : (
          <button key={e} className={`icon-btn ${ed.ui.tool === e ? 'active' : ''}`} {...tip(...toolParts(e, groupOf(ed.ui.studio, e)))} data-tip-hint={TOOL_HINTS[e]} aria-pressed={ed.ui.tool === e} data-tool={e} onClick={() => ed.setTool(e)}>
            <Icon name={e} />
          </button>
        ),
      )}
      <div className="divider" />
      <RailChips />
    </aside>
  );
}

/**
 * Canvas empty state (UX audit P0-3c): a quiet panel over an empty page with the
 * three likeliest first actions. Gone as soon as the page has a layer.
 */
function CanvasEmptyState() {
  const ed = useEditor();
  const shapesHere = STUDIO_TOOLS[ed.ui.studio].includes('rect');
  const canPlace = ed.feature('import-images');
  const drawShape = () => {
    if (!shapesHere) {
      if (!ed.feature('vector')) return;
      ed.setStudio('vector');
      toast('Switched to Vector for shapes. Drag on the page to draw a rectangle.');
    } else toast('Drag on the page to draw a rectangle');
    ed.setTool('rect');
  };
  const addText = () => {
    ed.setTool('text');
    toast('Click on the page to start typing');
  };
  return (
    <div className="canvas-empty" data-testid="canvas-empty">
      <div className="canvas-empty-card" role="group" aria-labelledby="canvas-empty-title">
        <p id="canvas-empty-title" className="canvas-empty-title">This page is empty</p>
        <div className="canvas-empty-actions">
          {canPlace && (
            <button type="button" className="ce-action" onClick={() => runCommand('file.place')} data-empty-action="place">
              <Icon name="image" size={16} />
              <span>Place image…</span>
              {shortcutFor('file.place') && <span className="ce-keys">{shortcutFor('file.place')}</span>}
            </button>
          )}
          {(shapesHere || ed.feature('vector')) && (
            <button type="button" className="ce-action" onClick={drawShape} data-empty-action="shape">
              <Icon name="rect" size={16} />
              <span>Draw a shape</span>
              <span className="ce-keys">{shapesHere ? 'M' : ''}</span>
            </button>
          )}
          <button type="button" className="ce-action" onClick={addText} data-empty-action="text">
            <Icon name="text" size={16} />
            <span>Add text</span>
            <span className="ce-keys">T</span>
          </button>
        </div>
        {canPlace && <p className="canvas-empty-hint"><Icon name="drop" size={16} />or drop an image here</p>}
      </div>
    </div>
  );
}

function CanvasArea() {
  const ed = useEditor();
  const hostRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Viewport | null>(null);
  useEffect(() => {
    if (!hostRef.current) return;
    const v = new Viewport(hostRef.current, editor);
    setViewport(v);
    setVp(v);
    return () => {
      setViewport(null);
      v.destroy();
    };
  }, [ed.session]);
  const doc = ed.doc!;
  const pageIndex = ed.activePageIndex;
  const master = doc.masters.find((m) => m.id === ed.ui.activeContainerId);
  const container = ed.activeContainer;
  const empty = !master && !!container && container.nodes.length === 0;
  return (
    <section className={`canvas-area ${ed.settings.showRulers ? '' : 'no-rulers'}`} aria-label="Canvas">
      <div className="ruler-corner" data-tip="Toggle rulers" onDoubleClick={() => setSetting({ showRulers: false })} />
      {vp && <Rulers viewport={vp} />}
      <div className="viewport" ref={hostRef} />
      {vp && <SelectionToolbar viewport={vp} />}
      {vp && <SelectionActions viewport={vp} />}
      {empty && <CanvasEmptyState />}
      {master && (
        <div className="master-banner">
          Editing master “{master.name}”
          <button onClick={() => ed.setUi({ activeContainerId: doc.pages[0].id, selection: [] })}>Done</button>
        </div>
      )}
      {doc.pages.length > 1 && pageIndex >= 0 && (
        <div className="page-indicator">
          <button className="icon-btn sm" {...tip('Previous page', 'PageUp')} disabled={pageIndex === 0} onClick={() => runCommand('page.prev')}><Icon name="chevron-left" /></button>
          <span>Page {pageIndex + 1} of {doc.pages.length}</span>
          <button className="icon-btn sm" {...tip('Next page', 'PageDown')} disabled={pageIndex === doc.pages.length - 1} onClick={() => runCommand('page.next')}><Icon name="chevron-right" /></button>
        </div>
      )}
    </section>
  );
}

/** Quiet update indicator: only shown while downloading, when an update is ready, or one is available. */
function UpdateIndicator() {
  const u = useUpdateState();
  const line = statusLine(u);
  if (!line) return null;
  return (
    <button type="button" className="update-ind" data-update-status={u!.status} onClick={() => openDialog('updates')} aria-label={`${line}. Open software update`} data-tip="Software update">
      <Icon name="update" size={16} />
      <span>{line}</span>
    </button>
  );
}

function StatusBar() {
  const ed = useEditor();
  const doc = ed.doc!;
  const zoom = Math.round(ed.ui.zoom * 100);
  const s = doc.settings;
  const fmt = (px: number) => {
    const u = ed.settings.units;
    const k = { px: 1, mm: 25.4 / 96, cm: 2.54 / 96, in: 1 / 96, pt: 72 / 96 }[u];
    return `${Math.round(px * k * 10) / 10}`;
  };
  return (
    <footer className="statusbar">
      <span className="num">{fmt(s.width)} × {fmt(s.height)} {ed.settings.units}</span>
      <span>{ed.ui.selection.length ? <><span className="num">{ed.ui.selection.length}</span> selected</> : 'Nothing selected'}</span>
      <span className="num">{ed.ui.status}</span>
      <div className="spacer" />
      <UpdateIndicator />
      <label>
        Units{' '}
        <select value={ed.settings.units} onChange={(e) => setSetting({ units: e.target.value as never })} aria-label="Display units">
          {['px', 'mm', 'cm', 'in', 'pt'].map((u) => <option key={u}>{u}</option>)}
        </select>
      </label>
      <button className="icon-btn sm" {...tip('Zoom out', 'view.zoom-out')} onClick={() => runCommand('view.zoom-out')}><Icon name="minus" /></button>
      <button className="btn ghost zoom-value" onClick={() => runCommand('view.zoom-fit')} {...tip('Zoom to fit', 'view.zoom-fit')} aria-label={`Zoom ${zoom}%, fit to window`}><span className="num">{zoom}%</span></button>
      <button className="icon-btn sm" {...tip('Zoom in', 'view.zoom-in')} onClick={() => runCommand('view.zoom-in')}><Icon name="plus" /></button>
      <span>{ed.settings.snapping ? 'Snap on' : 'Snap off'}</span>
    </footer>
  );
}

export function Workspace() {
  const ed = useEditor();
  useEffect(() => {
    if (ed.settings.lastStudio !== ed.ui.studio) void setSetting({ lastStudio: ed.ui.studio });
  }, [ed.ui.studio]);
  return (
    <div className="workspace" data-studio={ed.ui.studio}>
      <Topbar />
      <ContextBar />
      <ToolPalette />
      <LeftRail />
      <CanvasArea />
      <Panels />
      <StatusBar />
    </div>
  );
}
