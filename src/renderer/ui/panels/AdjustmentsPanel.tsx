import { useEffect, useRef } from 'react';
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

function Histogram({ node }: { node: RasterNode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const src = editor.assets.rendered(node.assetId, node.adjustments, true);
    if (!c || !src) return;
    // sample a downscaled copy for speed
    const s = Math.min(1, 256 / Math.max(src.width, src.height));
    const small = createCanvas(src.width * s, src.height * s);
    ctx2d(small).drawImage(src, 0, 0, small.width, small.height);
    const h = histogram(canvasToPixels(small));
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    const max = Math.max(1, ...h.l);
    const draw = (arr: Uint32Array, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, c.height);
      for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * c.width, c.height - (arr[i] / max) * c.height);
      ctx.lineTo(c.width, c.height);
      ctx.fill();
    };
    ctx.globalCompositeOperation = 'screen';
    draw(h.r, 'rgba(255,60,60,0.55)');
    draw(h.g, 'rgba(60,255,60,0.55)');
    draw(h.b, 'rgba(60,120,255,0.55)');
  }, [node.assetId, node.adjustments]);
  return <canvas ref={ref} width={276} height={60} style={{ width: '100%', height: 60, background: 'var(--bg)', borderRadius: 4 }} aria-label="Histogram" role="img" />;
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
      <div className="row" style={{ marginTop: 8 }}>
        <select aria-label="Add adjustment" value="" onChange={(e) => e.target.value && add(e.target.value as AdjustmentType)}>
          <option value="">+ Add adjustment or filter…</option>
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
              <button className="icon-btn sm" aria-label={`Reset ${spec.label}`} title="Reset" onClick={() => update(a.id, { params: defaultParams(a.type), curves: undefined })}><Icon name="undo" /></button>
              <button className="icon-btn sm" aria-label={`Remove ${spec.label}`} title="Remove" onClick={() => setAdjustments(n, n.adjustments.filter((x) => x.id !== a.id))}><Icon name="trash" /></button>
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
        <button className="btn" onClick={() => runCommand('layer.rasterize')} title="Bake adjustments into the pixels">Apply to pixels</button>
      )}
    </div>
  );
}
