/**
 * Photo parity dialogs: filters with live on-canvas preview, Feather, Refine
 * edge, Select colour range and Canvas size. The live dialogs sit at the top
 * right over a clear backdrop (photo.css) so the canvas stays visible.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { scale } from '../../../core/geometry';
import { solid } from '../../../core/document';
import { adjustmentSpec, applyAdjustment, applyAdjustments, defaultParams } from '../../../core/pixels';
import { colorRangeMask, combineMasks, effectiveFeather, refineMask, type ColorRangeMode, type RefineEdge } from '../../../core/selectionMask';
import { ANCHORS, type Anchor } from '../../../core/resample';
import { updateNode } from '../../../core/commands';
import type { AdjustmentType, PathCommand, SceneNode } from '../../../core/types';
import { editor } from '../../state/editor';
import { closeDialog } from '../../state/bus';
import { getViewport } from '../../state/commands';
import { canvasSize } from '../../state/photoCommands';
import { canvasToPixels, createCanvas, ctx2d, pixelsToCanvas } from '../../engine/assets';
import { activeRaster, commitRasterCanvas, parseColor } from '../../engine/pixelOps';
import {
  blendThroughSelection, layerSample, maskToWorldPath, pageSample, selectionCanvasFor, selectionToMask,
  type SampleView, type SelectionMode,
} from '../../engine/selectionPixels';
import { newId } from '../../../core/ids';
import { SliderField } from '../controls/NumberField';
import { ColorChipButton } from '../color/Chips';
import { firstColorOf } from '../../state/uiPaint';
import { Dialog } from './DialogHost';
import { Check, Field, NumberInput, Segmented } from './controls';
import '../photo.css';

const PREVIEW_MAX = 1400;

function useDebounced(fn: () => void, deps: unknown[], ms = 40) {
  const t = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(t.current);
    t.current = window.setTimeout(fn, ms);
    return () => window.clearTimeout(t.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function ParamSliders({ type, params, onChange }: { type: AdjustmentType; params: Record<string, number>; onChange: (p: Record<string, number>) => void }) {
  const spec = adjustmentSpec(type);
  return (
    <div className="photo-params">
      {spec.params.map((p) =>
        p.toggle ? (
          <Check key={p.key} checked={(params[p.key] ?? p.default) >= 0.5} onChange={(v) => onChange({ ...params, [p.key]: v ? 1 : 0 })}>{p.label}</Check>
        ) : (
          <SliderField
            key={p.key}
            label={p.label.replace(/ \((px|%|°)\)$/, '')}
            ariaLabel={`${spec.label} ${p.label}`}
            unit={/\(px\)/.test(p.label) ? 'px' : /\(%\)/.test(p.label) ? '%' : /\(°\)/.test(p.label) ? '°' : undefined}
            min={p.min}
            max={p.max}
            step={p.step}
            digits={p.step < 1 ? 1 : 0}
            origin={p.min < 0 ? 0 : p.min}
            value={params[p.key] ?? p.default}
            onChange={(v) => onChange({ ...params, [p.key]: v })}
          />
        ),
      )}
    </div>
  );
}

/**
 * Filter with live preview. The preview runs on a reduced copy (spatial radii
 * scaled to match) inside the selection; Apply renders full resolution.
 * "Keep as live filter" adds it to the layer's adjustment stack instead.
 */
export function FilterDialog({ type }: { type: AdjustmentType }) {
  const node = useMemo(() => activeRaster(editor), []);
  const spec = adjustmentSpec(type);
  const [params, setParams] = useState<Record<string, number>>(() => defaultParams(type));
  const [preview, setPreview] = useState(true);
  const hasSelection = !!editor.ui.pixelSelection;
  const [live, setLive] = useState(false);
  const small = useMemo(() => {
    const base = node ? editor.assets.get(node.assetId) : null;
    if (!base || !node) return null;
    const k = Math.min(1, PREVIEW_MAX / Math.max(base.width, base.height));
    const c = createCanvas(base.width * k, base.height * k);
    const x = ctx2d(c);
    x.imageSmoothingQuality = 'high';
    x.drawImage(base, 0, 0, c.width, c.height);
    const cover = selectionCanvasFor(editor, node.id, c.width, c.height);
    return { canvas: c, k: c.width / base.width, cover };
  }, [node]);

  useDebounced(() => {
    const vp = getViewport();
    if (!vp || !node || !small) return;
    if (!preview) {
      vp.livePaint = null;
      vp.render();
      return;
    }
    const t0 = performance.now();
    const filtered = pixelsToCanvas(applyAdjustment(canvasToPixels(small.canvas), { type, params }, small.k));
    let shown = blendThroughSelection(small.canvas, filtered, small.cover);
    if (node.adjustments.some((a) => a.enabled)) shown = pixelsToCanvas(applyAdjustments(canvasToPixels(shown), node.adjustments, small.k));
    vp.livePaint = { nodeId: node.id, canvas: shown };
    vp.render();
    editor.setUi({ status: `${spec.label} preview · ${Math.round(performance.now() - t0)} ms` });
  }, [params, preview]);

  useEffect(() => () => {
    const vp = getViewport();
    if (vp) {
      vp.livePaint = null;
      vp.render();
    }
  }, []);

  const apply = () => {
    if (!node) return closeDialog();
    const vp = getViewport();
    if (vp) vp.livePaint = null;
    if (live && !hasSelection) {
      editor.commit(spec.label, (d) => updateNode(d, node.id, { adjustments: [...node.adjustments, { id: newId('adj'), type, enabled: true, params }] } as Partial<SceneNode>));
    } else {
      const base = editor.assets.get(node.assetId);
      if (base) {
        const filtered = pixelsToCanvas(applyAdjustment(canvasToPixels(base), { type, params }, 1));
        const cover = selectionCanvasFor(editor, node.id, base.width, base.height);
        commitRasterCanvas(editor, node.id, blendThroughSelection(base, filtered, cover), spec.label);
      }
    }
    closeDialog();
  };
  if (!node) return null;
  return (
    <Dialog
      title={spec.label.charAt(0) + spec.label.slice(1).toLowerCase()}
      size="sm"
      className="photo-live"
      onSubmit={apply}
      footerStart={<Check checked={preview} onChange={setPreview}>Preview</Check>}
      footer={<><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" data-action="filter-apply" onClick={apply}>Apply</button></>}
    >
      <ParamSliders type={type} params={params} onChange={setParams} />
      <div className="photo-dialog-foot">
        <Check checked={live && !hasSelection} disabled={hasSelection} onChange={setLive}>Keep as live filter</Check>
        <p className="fhint">{hasSelection ? 'Applies inside the selection (soft edges blend).' : live ? 'Stays editable in Adjust until you apply it to the pixels.' : 'Changes the pixels of the layer. Undo restores them.'}</p>
      </div>
    </Dialog>
  );
}

export function FeatherDialog() {
  const [r, setR] = useState(editor.ui.pixelSelectionFeather || 4);
  const apply = () => {
    editor.setUi({ pixelSelectionFeather: Math.max(0, r) });
    closeDialog();
  };
  return (
    <Dialog title="Feather selection" size="sm" onSubmit={apply} footer={<><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" onClick={apply}>Feather</button></>}>
      <SliderField label="Radius" ariaLabel="Feather radius" unit="px" min={0} max={250} step={0.5} digits={1} value={r} onChange={setR} />
      <p className="fhint">Painting, fills, filters and masks fade out over this distance at the selection edge.</p>
    </Dialog>
  );
}

/** Page grid used to rasterise selections for refining (document pixels, capped). */
function pageGrid(): SampleView | null {
  const doc = editor.doc;
  if (!doc) return null;
  const k = Math.min(1, 2048 / Math.max(doc.settings.width, doc.settings.height));
  const width = Math.max(1, Math.round(doc.settings.width * k));
  const height = Math.max(1, Math.round(doc.settings.height * k));
  return { width, height, data: new Uint8ClampedArray(0), toPixel: scale(k, k), toWorld: scale(1 / k, 1 / k) };
}

export function RefineEdgeDialog() {
  const original = useRef<{ sel: PathCommand[] | null; feather: number }>({ sel: editor.ui.pixelSelection, feather: editor.ui.pixelSelectionFeather });
  const [o, setO] = useState<RefineEdge>({ smooth: 0, feather: editor.ui.pixelSelectionFeather, contrast: 0, shift: 0 });
  const [output, setOutput] = useState<'selection' | 'mask'>('selection');
  const done = useRef(false);
  const grid = useMemo(pageGrid, []);
  const baseMask = useMemo(() => (grid && original.current.sel ? selectionToMask(original.current.sel, grid) : null), [grid]);

  useDebounced(() => {
    if (!grid || !baseMask) return;
    const k = grid.toPixel[0];
    const shaped = refineMask(baseMask, grid.width, grid.height, { smooth: o.smooth * k, shift: o.shift * k, feather: 0, contrast: 0 });
    const d = maskToWorldPath(shaped, grid);
    editor.setUi({ pixelSelection: d, pixelSelectionFeather: effectiveFeather(o) });
  }, [o.smooth, o.shift, o.feather, o.contrast], 60);

  useEffect(() => () => {
    if (!done.current) editor.setUi({ pixelSelection: original.current.sel, pixelSelectionFeather: original.current.feather });
  }, []);

  const apply = () => {
    done.current = true;
    window.setTimeout(() => {
      if (output === 'mask') void import('../../state/commands').then((m) => m.runCommand('select.save-to-mask'));
    }, 80);
    closeDialog();
  };
  const set = (k: keyof RefineEdge) => (v: number) => setO((x) => ({ ...x, [k]: v }));
  return (
    <Dialog title="Refine edge" size="sm" className="photo-live" onSubmit={apply} footer={<><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" data-action="refine-apply" onClick={apply}>Apply</button></>}>
      <div className="photo-params">
        <SliderField label="Smooth" ariaLabel="Smooth" unit="px" min={0} max={50} value={o.smooth} onChange={set('smooth')} />
        <SliderField label="Feather" ariaLabel="Feather" unit="px" min={0} max={100} step={0.5} digits={1} value={o.feather} onChange={set('feather')} />
        <SliderField label="Contrast" ariaLabel="Contrast" unit="%" min={0} max={100} value={o.contrast} onChange={set('contrast')} />
        <SliderField label="Shift edge" ariaLabel="Shift edge" unit="px" min={-50} max={50} origin={0} value={o.shift} onChange={set('shift')} />
      </div>
      <Field label="Output">
        <Segmented label="Refine output" full value={output} onChange={setOutput} options={[{ value: 'selection', label: 'Selection' }, { value: 'mask', label: 'Layer mask' }]} />
      </Field>
    </Dialog>
  );
}

const RANGE_MODES: { value: ColorRangeMode; label: string }[] = [
  { value: 'sampled', label: 'Sampled colour' }, { value: 'highlights', label: 'Highlights' }, { value: 'midtones', label: 'Midtones' },
  { value: 'shadows', label: 'Shadows' }, { value: 'reds', label: 'Reds' }, { value: 'greens', label: 'Greens' }, { value: 'blues', label: 'Blues' },
];

export function ColorRangeDialog() {
  const original = useRef<{ sel: PathCommand[] | null; feather: number }>({ sel: editor.ui.pixelSelection, feather: editor.ui.pixelSelectionFeather });
  const done = useRef(false);
  const [mode, setMode] = useState<ColorRangeMode>('sampled');
  const [color, setColor] = useState(editor.ui.fillColor);
  const [fuzz, setFuzz] = useState(40);
  const [allLayers, setAllLayers] = useState(!activeRaster(editor));
  const [combine, setCombine] = useState<SelectionMode>('new');
  const [share, setShare] = useState(0);
  const view = useMemo(() => {
    const r = activeRaster(editor);
    return allLayers || !r ? pageSample(editor) : layerSample(editor, r);
  }, [allLayers]);
  const base = useMemo(() => (view && original.current.sel ? selectionToMask(original.current.sel, view) : null), [view]);

  useDebounced(() => {
    if (!view) return;
    const c = parseColor(color);
    const m = colorRangeMask({ width: view.width, height: view.height, data: view.data }, mode, [c.r, c.g, c.b], fuzz);
    const comb = combineMasks(base, m, combine);
    let n = 0;
    for (let i = 0; i < comb.length; i++) if (comb[i] >= 128) n++;
    setShare(n / comb.length);
    editor.setUi({ pixelSelection: maskToWorldPath(comb, view), pixelSelectionFeather: 0 });
  }, [mode, color, fuzz, view, combine], 80);

  useEffect(() => () => {
    if (!done.current) editor.setUi({ pixelSelection: original.current.sel, pixelSelectionFeather: original.current.feather });
  }, []);
  const apply = () => {
    done.current = true;
    closeDialog();
  };
  return (
    <Dialog title="Select colour range" size="sm" className="photo-live" onSubmit={apply} footer={<><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" data-action="color-range-apply" onClick={apply}>Select</button></>}>
      <Field label="Select" htmlFor="cr-mode">
        <select id="cr-mode" value={mode} onChange={(e) => setMode(e.target.value as ColorRangeMode)}>
          {RANGE_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </Field>
      {mode === 'sampled' && (
        <Field label="Colour" hint="Pick one with the Colour picker (I) first, or choose it here.">
          <ColorChipButton kind="fill" label="Sampled colour" value={solid(color)} allowNone={false} allowGradient={false} onChange={(p) => setColor(firstColorOf(p, color))} />
        </Field>
      )}
      {mode === 'sampled' && <SliderField label="Fuzziness" ariaLabel="Fuzziness" min={1} max={200} value={fuzz} onChange={setFuzz} />}
      <Field label="Sample">
        <Segmented label="Sample from" full value={allLayers ? 'all' : 'layer'} onChange={(v) => setAllLayers(v === 'all')} options={[{ value: 'layer', label: 'Active layer' }, { value: 'all', label: 'All layers' }]} />
      </Field>
      <Field label="Mode">
        <Segmented label="Combine with the selection" full value={combine} onChange={setCombine} options={(['new', 'add', 'subtract', 'intersect'] as const).map((m) => ({ value: m, label: m[0].toUpperCase() + m.slice(1) }))} />
      </Field>
      <p className="fhint num" data-share={share.toFixed(4)}>{(share * 100).toFixed(1)}% of the image selected</p>
    </Dialog>
  );
}

function AnchorGrid({ value, onChange }: { value: Anchor; onChange: (a: Anchor) => void }) {
  const names: Record<Anchor, string> = { tl: 'Top left', t: 'Top', tr: 'Top right', l: 'Left', c: 'Centre', r: 'Right', bl: 'Bottom left', b: 'Bottom', br: 'Bottom right' };
  return (
    <div className="anchor-grid" role="radiogroup" aria-label="Anchor">
      {ANCHORS.map((a) => (
        <button key={a} type="button" role="radio" aria-checked={value === a} aria-label={names[a]} data-anchor={a} className={value === a ? 'on' : ''} onClick={() => onChange(a)}>
          <span />
        </button>
      ))}
    </div>
  );
}

export function CanvasSizeDialog() {
  const doc = editor.doc!;
  const [w, setW] = useState(Math.round(doc.settings.width));
  const [h, setH] = useState(Math.round(doc.settings.height));
  const [anchor, setAnchor] = useState<Anchor>('c');
  const apply = () => {
    editor.commit('Canvas size', (d) => canvasSize(d, Math.max(1, w), Math.max(1, h), anchor));
    getViewport()?.zoomToFit();
    closeDialog();
  };
  return (
    <Dialog title="Canvas size" size="sm" onSubmit={apply} footer={<><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" onClick={apply}>Resize canvas</button></>}>
      <div className="fgrid">
        <Field label="Size" hint={`Now ${Math.round(doc.settings.width)} × ${Math.round(doc.settings.height)} px. Content is not scaled.`}>
          <div className="pair">
            <NumberInput label="Canvas width in pixels" prefix="W" unit="px" value={w} min={1} step={1} onChange={(v) => setW(Math.round(v))} />
            <NumberInput label="Canvas height in pixels" prefix="H" unit="px" value={h} min={1} step={1} onChange={(v) => setH(Math.round(v))} />
          </div>
        </Field>
        <Field label="Anchor">
          <AnchorGrid value={anchor} onChange={setAnchor} />
        </Field>
      </div>
    </Dialog>
  );
}
