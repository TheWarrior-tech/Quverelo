import { useEffect, useRef, useState } from 'react';
import { updateNode } from '../../../core/commands';
import { newId } from '../../../core/ids';
import { ADJUSTMENTS, adjustmentSpec, defaultParams, histogram } from '../../../core/pixels';
import type { Adjustment, AdjustmentType, RasterNode, SceneNode } from '../../../core/types';
import { editor } from '../../state/editor';
import { runCommand } from '../../state/commands';
import { canvasToPixels, createCanvas, ctx2d } from '../../engine/assets';
import { useEditor } from '../hooks';
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

export function AdjustmentsPanel() {
  const ed = useEditor();
  const n = ed.selectedNodes().find((x): x is RasterNode => x.type === 'raster');
  if (!n) {
    return (
      <div className="empty-note">
        Select a pixel layer to add live, non-destructive adjustments and filters.
        <br />
        <br />
        <button className="btn" onClick={() => runCommand('file.place')}><Icon name="image" /> Place a photo…</button>
      </div>
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
            <header>
              <input type="checkbox" checked={a.enabled} aria-label={`Enable ${spec.label}`} onChange={(e) => update(a.id, { enabled: e.target.checked })} />
              <span>{spec.label}</span>
              {/* Curves keeps its reset beside the channel switch, so there is one reset per scope */}
              {a.type !== 'curves' && <button className="icon-btn sm" aria-label={`Reset ${spec.label}`} data-tip="Reset" onClick={() => update(a.id, { params: defaultParams(a.type), curves: undefined })}><Icon name="undo" /></button>}
              <button className="icon-btn sm" aria-label={`Remove ${spec.label}`} data-tip="Remove" onClick={() => setAdjustments(n, n.adjustments.filter((x) => x.id !== a.id))}><Icon name="trash" /></button>
            </header>
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
