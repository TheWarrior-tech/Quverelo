import { useEffect, useRef, useState } from 'react';
import { updateNode } from '../../../core/commands';
import { newId } from '../../../core/ids';
import { ADJUSTMENTS, adjustmentSpec, defaultParams, histogram } from '../../../core/pixels';
import type { Adjustment, AdjustmentType, RasterNode, SceneNode } from '../../../core/types';
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
    const src = editor.assets.rendered(node.assetId, node.adjustments, true);
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

export function AdjustmentsPanel() {
  const ed = useEditor();
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
  const add = (type: AdjustmentType) => setAdjustments(n, [...n.adjustments, { id: newId('adj'), type, enabled: true, params: defaultParams(type) }]);
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
      <div className="row add-adjustment">
        <span className="select-icon" aria-hidden="true"><Icon name="plus" size={16} /></span>
        <select aria-label="Add adjustment" value="" onChange={(e) => e.target.value && add(e.target.value as AdjustmentType)}>
          <option value="">Add adjustment or filter…</option>
          <optgroup label="Adjustments">
            {ADJUSTMENTS.filter((a) => !['blur', 'sharpen', 'noise', 'vignette'].includes(a.type)).map((a) => <option key={a.type} value={a.type}>{a.label}</option>)}
          </optgroup>
          <optgroup label="Filters">
            {ADJUSTMENTS.filter((a) => ['blur', 'sharpen', 'noise', 'vignette'].includes(a.type)).map((a) => <option key={a.type} value={a.type}>{a.label}</option>)}
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
            {a.type === 'curves' && (
              <CurvesEditor node={n} adj={a} onChange={(curves, merge) => update(a.id, { curves }, merge)} onBegin={beginDrag} onEnd={endDrag} />
            )}
            {spec.params.length > 0 && (
              <div className="params">
                {spec.params.map((p) => (
                  <div className="slider-row" key={p.key}>
                    <label>{p.label}</label>
                    <input
                      type="range"
                      min={p.min}
                      max={p.max}
                      step={p.step}
                      value={a.params[p.key] ?? p.default}
                      aria-label={`${spec.label} ${p.label}`}
                      onPointerDown={beginDrag}
                      onPointerUp={endDrag}
                      onKeyUp={endDrag}
                      onChange={(e) => update(a.id, { params: { ...a.params, [p.key]: parseFloat(e.target.value) } }, `adj:${a.id}:${p.key}`)}
                    />
                    <input type="number" min={p.min} max={p.max} step={p.step} value={a.params[p.key] ?? p.default} aria-label={`${spec.label} ${p.label} value`} onChange={(e) => update(a.id, { params: { ...a.params, [p.key]: parseFloat(e.target.value) || 0 } }, `adj:${a.id}:${p.key}`)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {n.adjustments.length > 0 && (
        <button className="btn" onClick={() => runCommand('layer.rasterize')} data-tip="Bake adjustments into the pixels">Apply to pixels</button>
      )}
    </div>
  );
}
