import { useEffect, useRef, useState } from 'react';
import type { StudioKind } from '../../core/types';
import { STUDIO_TOOLS, editor, type ToolId } from '../state/editor';
import { runCommand, setViewport, setSetting } from '../state/commands';
import { Viewport } from '../engine/Viewport';
import { useEditor } from './hooks';
import { Icon, Logo } from './Icons';
import { ContextBar } from './ContextBar';
import { Rulers } from './Rulers';
import { Panels } from './panels/Panels';
import { tip } from './tooltip';
import { applyFillToSelection, applyStrokeToSelection, swapFillStroke } from './panels/ColorPanel';
import { ColorPopoverBody, FillStrokeChips, type ChipTarget } from './color/Chips';
import { Popover } from './controls/Panel';
import { solid } from '../../core/document';
import { statusLine, useUpdateState } from '../state/updates';
import { openDialog } from '../state/bus';

const TOOL_LABELS: Record<ToolId, string> = {
  move: 'Move (V)', node: 'Node (A)', hand: 'Hand (H)', zoom: 'Zoom (Z)',
  'marquee-rect': 'Rectangle Marquee (M)', 'marquee-ellipse': 'Ellipse Marquee', lasso: 'Freehand Selection (L)',
  brush: 'Paint Brush (B)', eraser: 'Eraser (E)', fill: 'Flood Fill (G)', eyedropper: 'Colour Picker (I)', crop: 'Crop (C)',
  pen: 'Pen (P)', pencil: 'Pencil (N)', rect: 'Rectangle (M)', ellipse: 'Ellipse (E)', polygon: 'Polygon (Y)', star: 'Star (S)', line: 'Line (L)',
  text: 'Artistic Text (T)', textframe: 'Frame Text (X)', imageframe: 'Picture Frame (F)',
};

export function toolLabel(t: ToolId): string {
  return TOOL_LABELS[t];
}

/** Tool name without the shortcut suffix, and the shortcut key ('V'), if any. */
function toolParts(t: ToolId): [string, string | undefined] {
  const m = /^(.*) \((.+)\)$/.exec(TOOL_LABELS[t]);
  return m ? [m[1], m[2]] : [TOOL_LABELS[t], undefined];
}

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

function Topbar() {
  const ed = useEditor();
  const h = ed.history;
  const sel = ed.ui.selection.length;
  return (
    <header className="topbar" role="toolbar" aria-label="Main toolbar">
      <div className="topbar-side start">
      <div className="brand">
        <Logo className="logo" />
        <span className="doc-title" title={ed.doc?.title}>{ed.doc?.title}{h?.dirty && <i className="dirty" aria-label="Unsaved changes" />}</span>
      </div>
      <button className="icon-btn" {...tip('New document', 'file.new')} onClick={() => runCommand('file.new')}><Icon name="new" /></button>
      <button className="icon-btn" {...tip('Open', 'file.open')} onClick={() => runCommand('file.open')}><Icon name="open" /></button>
      <button className="icon-btn" {...tip('Save', 'file.save')} onClick={() => runCommand('file.save')}><Icon name="save" /></button>
      <button className="icon-btn" {...tip('Export PNG', 'file.export-png')} onClick={() => runCommand('file.export-png')}><Icon name="export" /></button>
      <button className="icon-btn" {...tip('Place image', 'file.place')} onClick={() => runCommand('file.place')}><Icon name="image" /></button>
      <div className="sep" />
      <button className="icon-btn" {...tip('Undo', 'edit.undo')} disabled={!h?.canUndo} onClick={() => runCommand('edit.undo')}><Icon name="undo" /></button>
      <button className="icon-btn" {...tip('Redo', 'edit.redo')} disabled={!h?.canRedo} onClick={() => runCommand('edit.redo')}><Icon name="redo" /></button>
      </div>
      <StudioSwitch />
      <div className="topbar-side end">
      <button className="icon-btn" {...tip('Align left')} disabled={!sel} onClick={() => runCommand('arrange.align-left')}><Icon name="align-left" /></button>
      <button className="icon-btn" {...tip('Align centre')} disabled={!sel} onClick={() => runCommand('arrange.align-hcenter')}><Icon name="align-hcenter" /></button>
      <button className="icon-btn" {...tip('Align right')} disabled={!sel} onClick={() => runCommand('arrange.align-right')}><Icon name="align-right" /></button>
      <button className="icon-btn" {...tip('Align top')} disabled={!sel} onClick={() => runCommand('arrange.align-top')}><Icon name="align-top" /></button>
      <button className="icon-btn" {...tip('Align middle')} disabled={!sel} onClick={() => runCommand('arrange.align-vcenter')}><Icon name="align-vcenter" /></button>
      <button className="icon-btn" {...tip('Align bottom')} disabled={!sel} onClick={() => runCommand('arrange.align-bottom')}><Icon name="align-bottom" /></button>
      {ed.ui.studio === 'vector' && (
        <>
          <div className="sep" />
          <button className="icon-btn" {...tip('Boolean add')} disabled={sel < 2} onClick={() => runCommand('layer.bool-add')}><Icon name="bool-add" /></button>
          <button className="icon-btn" {...tip('Boolean subtract')} disabled={sel < 2} onClick={() => runCommand('layer.bool-subtract')}><Icon name="bool-subtract" /></button>
          <button className="icon-btn" {...tip('Boolean intersect')} disabled={sel < 2} onClick={() => runCommand('layer.bool-intersect')}><Icon name="bool-intersect" /></button>
          <button className="icon-btn" {...tip('Boolean exclude')} disabled={sel < 2} onClick={() => runCommand('layer.bool-exclude')}><Icon name="bool-exclude" /></button>
          <button className="icon-btn" {...tip('Boolean divide')} disabled={sel < 2} onClick={() => runCommand('layer.bool-divide')}><Icon name="bool-divide" /></button>
        </>
      )}
      <div className="sep" />
      <button className="icon-btn" {...tip('Keyboard shortcuts', 'help.shortcuts')} onClick={() => runCommand('help.shortcuts')}><Icon name="keyboard" /></button>
      <button className="icon-btn" {...tip('Preferences', 'app.preferences')} onClick={() => runCommand('app.preferences')}><Icon name="settings" /></button>
      </div>
    </header>
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
            color={isFill ? ed.ui.fillColor : ed.ui.strokeColor}
            enabled={isFill ? ed.ui.fillEnabled : ed.ui.strokeEnabled}
            onToggle={(on) => ed.setUi(isFill ? { fillEnabled: on } : { strokeEnabled: on })}
            onChange={(c) => {
              ed.setUi(isFill ? { fillColor: c, fillEnabled: true } : { strokeColor: c, strokeEnabled: true });
              if (ed.ui.selection.length) (isFill ? applyFillToSelection : applyStrokeToSelection)(solid(c), isFill ? 'rail-fill' : 'rail-stroke');
            }}
          />
        </Popover>
      )}
    </>
  );
}

function ToolPalette() {
  const ed = useEditor();
  const tools = STUDIO_TOOLS[ed.ui.studio];
  return (
    <aside className="toolpalette" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {tools.map((t, i) => (
        <span key={t} style={{ display: 'contents' }}>
          {(t === 'hand' || (i > 0 && ['brush', 'pen', 'rect', 'text', 'textframe'].includes(t) && tools[i - 1] !== 'textframe')) && <div className="divider" />}
          <button className={`icon-btn ${ed.ui.tool === t ? 'active' : ''}`} {...tip(...toolParts(t))} aria-pressed={ed.ui.tool === t} data-tool={t} onClick={() => ed.setTool(t)}>
            <Icon name={t} />
          </button>
        </span>
      ))}
      <div className="divider" />
      <RailChips />
    </aside>
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
  return (
    <section className={`canvas-area ${ed.settings.showRulers ? '' : 'no-rulers'}`} aria-label="Canvas">
      <div className="ruler-corner" title="Toggle rulers" onDoubleClick={() => setSetting({ showRulers: false })} />
      {vp && <Rulers viewport={vp} />}
      <div className="viewport" ref={hostRef} />
      {master && (
        <div className="master-banner" style={{ gridArea: '2 / 2' }}>
          Editing master “{master.name}”
          <button onClick={() => ed.setUi({ activeContainerId: doc.pages[0].id, selection: [] })}>Done</button>
        </div>
      )}
      {doc.pages.length > 1 && pageIndex >= 0 && (
        <div className="page-indicator" style={{ gridArea: '2 / 2' }}>
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
    <button type="button" className="update-ind" data-update-status={u!.status} onClick={() => openDialog('updates')} aria-label={`${line}. Open Software Update`} title="Software Update">
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
      <button className="btn ghost" style={{ height: 20, padding: '0 6px' }} onClick={() => runCommand('view.zoom-fit')} title={tip('Zoom to fit', 'view.zoom-fit').title} aria-label={`Zoom ${zoom}%, fit to window`}><span className="num">{zoom}%</span></button>
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
      <CanvasArea />
      <Panels />
      <StatusBar />
    </div>
  );
}
