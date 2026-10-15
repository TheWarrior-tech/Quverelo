import { useEffect, useRef, useState } from 'react';
import type { StudioKind } from '../../core/types';
import { editor } from '../state/editor';
import { STUDIO_RAIL, groupOf, isGroup } from '../state/toolGroups';
import { RailGroup, toolParts } from './ToolFlyout';
import { runCommand, setViewport, setSetting } from '../state/commands';
import { Viewport } from '../engine/Viewport';
import { useEditor } from './hooks';
import { Icon, Logo } from './Icons';
import { ContextBar } from './ContextBar';
import { SelectionActions } from './SelectionActions';
import { Rulers } from './Rulers';
import { Panels } from './panels/Panels';
import { tip } from './tooltip';
import { applyFillToSelection, applyStrokeToSelection, swapFillStroke } from './panels/ColorPanel';
import { ColorPopoverBody, FillStrokeChips, type ChipTarget } from './color/Chips';
import { Popover } from './controls/Panel';
import { solid } from '../../core/document';
import { statusLine, useUpdateState } from '../state/updates';
import { openDialog } from '../state/bus';
import { LeftRail } from './panels/LeftRail';
import { SelectionToolbar } from './SelectionToolbar';

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
        <button type="button" className="doc-title" title={`${title} · click to rename`} aria-label={`Document name: ${title}. Click to rename`} onClick={() => setEditing(true)}>
          {title}
        </button>
      )}
      <span className={`doc-state${dirty ? ' dirty' : ''}`} title={stateTip} role="status">
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
        <button className="icon-btn" {...tip('Place image…', 'file.place')} onClick={() => runCommand('file.place')}><Icon name="image" /></button>
      </div>
      <div className="topbar-zone actions">
        <button className="icon-btn" {...tip('Open…', 'file.open')} onClick={() => runCommand('file.open')}><Icon name="open" /></button>
        <button className="icon-btn" {...tip('Save', 'file.save')} onClick={() => runCommand('file.save')}><Icon name="save" /></button>
        <button className="icon-btn" {...tip('Keyboard shortcuts', 'help.shortcuts')} onClick={() => runCommand('help.shortcuts')}><Icon name="keyboard" /></button>
        <button className="icon-btn" {...tip('Preferences', 'app.preferences')} onClick={() => runCommand('app.preferences')}><Icon name="settings" /></button>
        <button className="btn primary export-btn" {...tip('Export…', 'file.export-png')} aria-label="Export" onClick={() => runCommand('file.export-png')}>
          <Icon name="export" /> Export
        </button>
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

/**
 * Tool rail. Related tools share one button with a flyout (toolGroups.ts);
 * dividers come from the rail layout.
 */
function ToolPalette() {
  const ed = useEditor();
  const rail = STUDIO_RAIL[ed.ui.studio];
  return (
    <aside className="toolpalette" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {rail.map((e, i) =>
        e === '|' ? (
          <div key={`d${i}`} className="divider" />
        ) : isGroup(e) ? (
          <RailGroup key={e.id} group={e} />
        ) : (
          <button key={e} className={`icon-btn ${ed.ui.tool === e ? 'active' : ''}`} {...tip(...toolParts(e, groupOf(ed.ui.studio, e)))} aria-pressed={ed.ui.tool === e} data-tool={e} onClick={() => ed.setTool(e)}>
            <Icon name={e} />
          </button>
        ),
      )}
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
      {vp && <SelectionToolbar viewport={vp} />}
      {vp && <SelectionActions viewport={vp} />}
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
      <button className="btn ghost zoom-value" onClick={() => runCommand('view.zoom-fit')} title={tip('Zoom to fit', 'view.zoom-fit').title} aria-label={`Zoom ${zoom}%, fit to window`}><span className="num">{zoom}%</span></button>
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
