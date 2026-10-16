import { useEffect, useRef, useState } from 'react';
import { updateNode } from '../../../core/commands';
import { ADJUSTMENTS, adjustmentSpec, defaultParams, histogram } from '../../../core/pixels';
import type { Adjustment, AdjustmentNode, AdjustmentType, GradientStop, RasterNode, SceneNode } from '../../../core/types';
import { DEFAULT_GRADIENT_MAP } from '../../../core/photoFilters';
import { solid } from '../../../core/document';
import { ColorChipButton } from '../color/Chips';
import { firstColorOf } from '../../state/uiPaint';
import { SliderField } from '../controls/NumberField';
import { ADJUSTMENT_LAYER_TYPES, addAdjustmentLayer, newAdjustment } from '../../state/photoCommands';
import '../photo.css';
import { editor, topPixelLayer } from '../../state/editor';
import { layerDisplayName } from '../../../core/document';
import { EmptyState } from '../controls/EmptyState';
import { Menu, useMenu } from '../controls/Menu';
import { tip } from '../tips';
import { runCommand } from '../../state/commands';
import { canvasToPixels, createCanvas, ctx2d } from '../../engine/assets';
import { useEditor } from '../hooks';
import { activeRaster } from '../../engine/pixelOps';
import { Icon } from '../Icons';
import { CurvesEditor } from './CurvesEditor';

function setAdjustments(n: RasterNode, list: Adjustment[], merge?: string) {
  editor.commit('Adjustment', (d) => updateNode(d, n.id, { adjustments: list } as Partial<SceneNode>), merge);
}

type HistMode = 'rgb' | 'l' | 'r' | 'g' | 'b';
const HIST_MODES: { v: HistMode; label: string }[] = [
  { v: 'rgb', label: 'Colours' },
  { v: 'l', label: 'Luminance' },
  { v: 'r', label: 'Red' },
  { v: 'g', label: 'Green' },
  { v: 'b', label: 'Blue' },
];
const HIST_LINE: Record<'r' | 'g' | 'b', string> = { r: '#ff6b6b', g: '#5fd47c', b: '#6ba4ff' };

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * Histogram (critique 2 P1-13): a micro-label header with a channel menu, then
 * luminance as a quiet text-3 area with R/G/B as thin lines (no saturated fills).
 */
function Histogram({ node }: { node: RasterNode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<HistMode>('rgb');
  useEffect(() => {
    const c = ref.current;
    // a small render level (shared with the canvas cache) is plenty for 256 bins; never a separate 1600 px render
    const base = editor.assets.get(node.assetId);
    const src = base && editor.assets.rendered(node.assetId, node.adjustments, 512 / Math.max(base.width, base.height));
    if (!c || !src) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = c.clientWidth || 264;
    const ch = c.clientHeight || 60;
    c.width = Math.round(cw * dpr);
    c.height = Math.round(ch * dpr);
    // sample a downscaled copy for speed
    const s = Math.min(1, 256 / Math.max(src.width, src.height));
    const small = createCanvas(src.width * s, src.height * s);
    ctx2d(small).drawImage(src, 0, 0, small.width, small.height);
    const h = histogram(canvasToPixels(small));
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const chans = mode === 'rgb' ? (['l', 'r', 'g', 'b'] as const) : ([mode] as const);
    let max = 1;
    for (const k of chans) for (let i = 1; i < 255; i++) max = Math.max(max, h[k][i]);
    const yOf = (v: number) => ch - Math.min(1, v / max) * (ch - 1);
    const theme = document.documentElement.dataset.theme;
    const hc = theme === 'high-contrast';
    const trace = (arr: Uint32Array) => {
      ctx.beginPath();
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * cw;
        if (i === 0) ctx.moveTo(x, yOf(arr[i]));
        else ctx.lineTo(x, yOf(arr[i]));
      }
    };
    // area: luminance (or the one channel picked)
    const areaKey = mode === 'rgb' ? 'l' : mode;
    trace(h[areaKey]);
    ctx.lineTo(cw, ch);
    ctx.lineTo(0, ch);
    ctx.closePath();
    ctx.globalAlpha = hc ? 0.6 : 0.4;
    ctx.fillStyle = hc ? '#ffffff' : mode === 'rgb' || mode === 'l' ? cssVar('--c-text-3', '#8b8d93') : HIST_LINE[mode];
    ctx.fill();
    // colour lines
    if (mode === 'rgb') {
      ctx.globalAlpha = hc ? 1 : 0.6;
      ctx.lineWidth = 1;
      for (const k of ['r', 'g', 'b'] as const) {
        trace(h[k]);
        ctx.strokeStyle = HIST_LINE[k];
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }, [node.assetId, node.adjustments, mode]);
  return (
    <section className="histo" aria-label="Histogram">
      <header className="histo-head">
        <span className="micro" id="histo-label">Histogram</span>
        <select aria-label="Histogram channel" value={mode} onChange={(e) => setMode(e.target.value as HistMode)}>
          {HIST_MODES.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
        </select>
      </header>
      <canvas ref={ref} className="histogram" aria-labelledby="histo-label" role="img" />
    </section>
  );
}

/**
 * One header for every adjustment card (CRITIQUE-3 N3): name, visibility (eye)
 * and a ⋯ menu holding Reset and Delete. Per-channel resets live inside the
 * card (Curves' channel row), so there is exactly one reset per scope.
 */
function AdjustmentHeader({ label, enabled, curves, onToggle, onReset, onDelete }: { label: string; enabled: boolean; curves: boolean; onToggle: () => void; onReset: () => void; onDelete: () => void }) {
  const [anchor, toggle, close] = useMenu();
  return (
    <header>
      <span className={`adjust-name${enabled ? '' : ' off'}`}>{label}</span>
      <button
        type="button"
        className={`icon-btn sm toggle eye${enabled ? '' : ' set'}`}
        aria-pressed={!enabled}
        {...tip(enabled ? `Hide ${label}` : `Show ${label}`)}
        onClick={onToggle}
      >
        <Icon name={enabled ? 'eye' : 'eye-off'} size={16} />
      </button>
      <button
        type="button"
        className={`icon-btn sm adjust-more${anchor ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        {...tip(`${label} options`)}
        onClick={(e) => toggle(e.currentTarget)}
      >
        <Icon name="more" size={16} />
      </button>
      {anchor && (
        <Menu
          anchor={anchor}
          label={`${label} options`}
          align="end"
          minWidth={184}
          onClose={close}
          items={[
            { id: 'reset', label: curves ? 'Reset all channels' : `Reset ${label.toLowerCase()}`, icon: 'undo', run: onReset },
            { id: 'delete', label: 'Delete adjustment', icon: 'trash', run: onDelete },
          ]}
        />
      )}
    </header>
  );
}

/** Gradient map ramp: preview strip, one colour chip and position per stop, add / remove. */
function GradientStopsEditor({ adj, onChange }: { adj: Adjustment; onChange: (stops: GradientStop[], merge?: string) => void }) {
  const stops = [...(adj.stops ?? DEFAULT_GRADIENT_MAP)].sort((a, b) => a.offset - b.offset);
  const css = `linear-gradient(to right, ${stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ')})`;
  const set = (i: number, patch: Partial<GradientStop>, merge?: string) => onChange(stops.map((s, k) => (k === i ? { ...s, ...patch } : s)), merge);
  return (
    <div className="gradient-map-editor">
      <div className="gradient-ramp" style={{ backgroundImage: css }} role="img" aria-label="Gradient map ramp" />
      {stops.map((s, i) => (
        <div className="gradient-stops" key={i}>
          <ColorChipButton kind="fill" label={`Stop ${i + 1} colour`} value={solid(s.color)} allowNone={false} allowGradient={false} onChange={(p) => set(i, { color: firstColorOf(p, s.color) }, `gm:${adj.id}:${i}`)} />
          <SliderField label="At" ariaLabel={`Stop ${i + 1} position`} unit="%" min={0} max={100} value={Math.round(s.offset * 100)} onChange={(v) => set(i, { offset: v / 100 }, `gmo:${adj.id}:${i}`)} compact />
          <button type="button" className="icon-btn sm" {...tip('Remove stop')} disabled={stops.length <= 2} onClick={() => onChange(stops.filter((_, k) => k !== i))}><Icon name="minus" size={16} /></button>
        </div>
      ))}
      <button type="button" className="btn ghost sm" onClick={() => onChange([...stops, { offset: 0.5, color: '#808080' }])}><Icon name="plus" size={16} /> Add stop</button>
    </div>
  );
}

/** Sliders (grouped by section), toggles, the curve editor or the gradient ramp for one adjustment. */
function AdjustmentControls({ adj, histNode, onPatch, beginDrag, endDrag }: {
  adj: Adjustment;
  histNode: RasterNode;
  onPatch: (patch: Partial<Adjustment>, merge?: string) => void;
  beginDrag: () => void;
  endDrag: () => void;
}) {
  const spec = adjustmentSpec(adj.type);
  let lastSection: string | undefined;
  return (
    <>
      {adj.type === 'curves' && (
        <CurvesEditor node={histNode} adj={adj} onChange={(curves, merge) => onPatch({ curves }, merge)} onBegin={beginDrag} onEnd={endDrag} />
      )}
      {adj.type === 'gradient-map' && <GradientStopsEditor adj={adj} onChange={(stops, merge) => onPatch({ stops }, merge)} />}
      {spec.params.length > 0 && (
        <div className="params">
          {spec.params.map((p) => {
            const head = p.section && p.section !== lastSection ? <div className="adjust-section" key={`s-${p.section}`}>{p.section}</div> : null;
            lastSection = p.section;
            const value = adj.params[p.key] ?? p.default;
            if (p.toggle) {
              return (
                <div key={p.key}>
                  {head}
                  <label className="check"><input type="checkbox" aria-label={`${spec.label} ${p.label}`} checked={value >= 0.5} onChange={(e) => onPatch({ params: { ...adj.params, [p.key]: e.target.checked ? 1 : 0 } })} /> {p.label}</label>
                </div>
              );
            }
            return (
              <div key={p.key}>
                {head}
                <div className="slider-row">
                  <label>{p.label}</label>
                  <input
                    type="range"
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={value}
                    aria-label={`${spec.label} ${p.section ? p.section + ' ' : ''}${p.label}`}
                    onPointerDown={beginDrag}
                    onPointerUp={endDrag}
                    onKeyUp={endDrag}
                    onChange={(e) => onPatch({ params: { ...adj.params, [p.key]: parseFloat(e.target.value) } }, `adj:${adj.id}:${p.key}`)}
                  />
                  <input type="number" min={p.min} max={p.max} step={p.step} value={value} aria-label={`${spec.label} ${p.section ? p.section + ' ' : ''}${p.label} value`} onChange={(e) => onPatch({ params: { ...adj.params, [p.key]: parseFloat(e.target.value) || 0 } }, `adj:${adj.id}:${p.key}`)} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** "New adjustment layer…" picker: adds a live layer above the active one (Adjust menu equivalents). */
function NewAdjustmentLayer() {
  return (
    <div className="row add-adjustment">
      <span className="select-icon" aria-hidden="true"><Icon name="adjust" size={16} /></span>
      <select aria-label="New adjustment layer" value="" onChange={(e) => e.target.value && addAdjustmentLayer(e.target.value as AdjustmentType)}>
        <option value="">New adjustment layer…</option>
        {ADJUSTMENT_LAYER_TYPES.map((t) => <option key={t} value={t}>{adjustmentSpec(t).label}</option>)}
      </select>
    </div>
  );
}

/** Editor for a selected adjustment layer: same controls as a live adjustment, plus its layer actions. */
function AdjustmentLayerPanel({ n }: { n: AdjustmentNode }) {
  const ed = useEditor();
  const adj = n.adjustment;
  const spec = adjustmentSpec(adj.type);
  const below = (ed.activeContainer?.nodes ?? []).slice(0, Math.max(0, (ed.activeContainer?.nodes ?? []).findIndex((x) => x.id === n.id))).reverse().find((x): x is RasterNode => x.type === 'raster');
  const histNode = below ?? ({ assetId: '' } as RasterNode);
  const patch = (p: Partial<Adjustment>, merge?: string) => editor.commit(`Edit ${spec.label.toLowerCase()}`, (d) => updateNode(d, n.id, { adjustment: { ...adj, ...p } } as Partial<SceneNode>), merge);
  const beginDrag = () => ed.setUi({ interacting: true });
  const endDrag = () => {
    ed.setUi({ interacting: false });
    ed.emitNow();
  };
  return (
    <div className="adjust-layer" data-adjustment-layer={n.id}>
      {below && <Histogram node={below} />}
      <NewAdjustmentLayer />
      <div className="adjust-item">
        <AdjustmentHeader
          label={spec.label}
          enabled={adj.enabled}
          curves={adj.type === 'curves'}
          onToggle={() => patch({ enabled: !adj.enabled })}
          onReset={() => patch({ params: defaultParams(adj.type), curves: undefined, stops: adj.type === 'gradient-map' ? DEFAULT_GRADIENT_MAP : undefined })}
          onDelete={() => runCommand('edit.delete')}
        />
        <AdjustmentControls adj={adj} histNode={histNode} onPatch={patch} beginDrag={beginDrag} endDrag={endDrag} />
      </div>
      <p className="empty-note">Adjusts every layer below it{n.clipped ? ' in its clip group' : ''}{n.pixelMask ? ', inside its mask' : ''}. Opacity and blend mode are in Design.</p>
      <div className="row">
        <button className="btn sm ghost" onClick={() => runCommand(n.pixelMask ? 'layer.mask-edit' : 'layer.mask-add')}><Icon name="mask" size={16} /> {n.pixelMask ? (ed.ui.maskEditId === n.id ? 'Stop editing mask' : 'Paint mask') : 'Add mask'}</button>
        <button className="btn sm ghost" onClick={() => runCommand('layer.clip')}><Icon name="clip" size={16} /> {n.clipped ? 'Release clip' : 'Clip to below'}</button>
      </div>
    </div>
  );
}

export function AdjustmentsPanel() {
  const ed = useEditor();
  const target = ed.selectedNodes()[0] ?? (ed.ui.selection.length ? null : ed.activeLayer());
  if (target?.type === 'adjustment') return <AdjustmentLayerPanel n={target} />;
  // the active layer when nothing is selected (CRITIQUE-4 R2), so Adjust never asks when one exists
  const n = activeRaster(ed) ?? undefined;
  if (!n) {
    // Photo keeps an active layer (CRITIQUE-4 R2), so this only shows while a
    // non-pixel object (a shape, text) is selected, or the page has no pixels yet.
    const top = topPixelLayer(ed.activeContainer?.nodes ?? []);
    if (top) {
      const name = layerDisplayName(top, ed.doc);
      return (
        <EmptyState
          icon="adjust"
          title={ed.ui.selection.length ? 'Adjustments work on pixel layers' : 'Select a layer to adjust'}
          className="adjust-empty"
          actions={<button className="btn ghost" onClick={() => editor.select([top.id])}><Icon name="layers" size={16} /> Select {name}</button>}
        >
          Adjustments and filters stay live on the layer you pick, until you apply them.
        </EmptyState>
      );
    }
    return (
      <EmptyState
        icon="adjust"
        title="No photo yet"
        className="adjust-empty"
        actions={<button className="btn ghost" onClick={() => runCommand('file.place')}><Icon name="image" size={16} /> Place a photo…</button>}
      >
        Place a photo to add live, non-destructive adjustments and filters.
      </EmptyState>
    );
  }
  const add = (type: AdjustmentType) => setAdjustments(n, [...n.adjustments, newAdjustment(type)]);
  const update = (id: string, patch: Partial<Adjustment>, merge?: string) =>
    setAdjustments(n, n.adjustments.map((a) => (a.id === id ? { ...a, ...patch } : a)), merge);
  const beginDrag = () => ed.setUi({ interacting: true });
  const endDrag = () => {
    ed.setUi({ interacting: false });
    ed.emitNow();
  };
  return (
    <div>
      <Histogram node={n} />
      <NewAdjustmentLayer />
      <div className="row add-adjustment">
        <span className="select-icon" aria-hidden="true"><Icon name="plus" size={16} /></span>
        <select aria-label="Add adjustment" value="" onChange={(e) => e.target.value && add(e.target.value as AdjustmentType)}>
          <option value="">Add adjustment or filter…</option>
          <optgroup label="Adjustments">
            {ADJUSTMENTS.filter((a) => !a.filter).map((a) => <option key={a.type} value={a.type}>{a.label}</option>)}
          </optgroup>
          <optgroup label="Filters">
            {ADJUSTMENTS.filter((a) => a.filter).map((a) => <option key={a.type} value={a.type}>{a.label}</option>)}
          </optgroup>
        </select>
      </div>
      {n.adjustments.length === 0 && <p className="empty-note">No adjustments yet. They stay editable until you choose “Apply”.</p>}
      {[...n.adjustments].reverse().map((a) => {
        const spec = adjustmentSpec(a.type);
        return (
          <div className="adjust-item" key={a.id}>
            <AdjustmentHeader
              label={spec.label}
              enabled={a.enabled}
              curves={a.type === 'curves'}
              onToggle={() => update(a.id, { enabled: !a.enabled })}
              onReset={() => update(a.id, { params: defaultParams(a.type), curves: undefined })}
              onDelete={() => setAdjustments(n, n.adjustments.filter((x) => x.id !== a.id))}
            />
            <AdjustmentControls adj={a} histNode={n} onPatch={(patch, merge) => update(a.id, patch, merge)} beginDrag={beginDrag} endDrag={endDrag} />
          </div>
        );
      })}
      {n.adjustments.length > 0 && (
        <button className="btn" onClick={() => runCommand('layer.rasterize')} data-tip="Bake adjustments into the pixels">Apply to pixels</button>
      )}
    </div>
  );
}
