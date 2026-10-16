/**
 * Histogram panel (Photo inspector tab): the active layer or the whole
 * document, per channel, with mean / standard deviation / median / pixel count
 * and clipped shadows and highlights. Recomputed shortly after each edit.
 */
import { useEffect, useRef, useState } from 'react';
import { histogram } from '../../../core/pixels';
import { histStats, type HistStats } from '../../../core/histogramStats';
import { editor } from '../../state/editor';
import { useEditor } from '../hooks';
import { canvasToPixels, createCanvas, ctx2d } from '../../engine/assets';
import { activeRaster } from '../../engine/pixelOps';
import { drawPage } from '../../engine/draw';
import { Segmented } from '../controls/Segmented';
import { EmptyState } from '../controls/EmptyState';
import '../photo.css';

type Channel = 'rgb' | 'l' | 'r' | 'g' | 'b';
const CHANNELS: { v: Channel; label: string }[] = [
  { v: 'rgb', label: 'Colours' }, { v: 'l', label: 'Luminance' }, { v: 'r', label: 'Red' }, { v: 'g', label: 'Green' }, { v: 'b', label: 'Blue' },
];
const LINE: Record<'r' | 'g' | 'b', string> = { r: '#ff6b6b', g: '#5fd47c', b: '#6ba4ff' };
const SAMPLE = 512;

type Hist = ReturnType<typeof histogram>;

/** Pixels of the active layer (adjustments applied) or the composited page, downsampled for speed. */
function sample(source: 'layer' | 'document'): HTMLCanvasElement | null {
  const doc = editor.doc;
  if (!doc) return null;
  if (source === 'layer') {
    const r = activeRaster(editor);
    const src = r ? editor.assets.rendered(r.assetId, r.adjustments, true) : null;
    if (!src) return null;
    const k = Math.min(1, SAMPLE / Math.max(src.width, src.height));
    const c = createCanvas(src.width * k, src.height * k);
    ctx2d(c).drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  const W = doc.settings.width;
  const H = doc.settings.height;
  const k = Math.min(1, SAMPLE / Math.max(W, H));
  const c = createCanvas(W * k, H * k);
  const x = ctx2d(c);
  x.scale(c.width / W, c.height / H);
  drawPage(x, doc, Math.max(0, editor.activePageIndex), { doc, assets: editor.assets, editor: false, preview: true, zoom: k });
  return c;
}

export function computeHistogram(source: 'layer' | 'document'): Hist | null {
  const c = sample(source);
  return c ? histogram(canvasToPixels(c)) : null;
}

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function HistogramPanel() {
  const ed = useEditor();
  const ref = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<'layer' | 'document'>(() => (activeRaster(editor) ? 'layer' : 'document'));
  const [channel, setChannel] = useState<Channel>('rgb');
  const [hist, setHist] = useState<Hist | null>(null);
  const doc = ed.doc;
  const layer = activeRaster(ed);
  useEffect(() => {
    const t = window.setTimeout(() => setHist(computeHistogram(source)), 120);
    return () => window.clearTimeout(t);
  }, [doc, source, layer?.id, layer?.assetId, layer?.adjustments]);
  useEffect(() => {
    const c = ref.current;
    if (!c || !hist) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = c.clientWidth || 256;
    const ch = c.clientHeight || 120;
    c.width = Math.round(cw * dpr);
    c.height = Math.round(ch * dpr);
    const x = c.getContext('2d')!;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, cw, ch);
    const hc = document.documentElement.dataset.theme === 'high-contrast';
    const chans = channel === 'rgb' ? (['l', 'r', 'g', 'b'] as const) : ([channel] as const);
    let max = 1;
    for (const k of chans) for (let i = 1; i < 255; i++) max = Math.max(max, hist[k][i]);
    const yOf = (v: number) => ch - Math.min(1, v / max) * (ch - 2);
    const trace = (a: Uint32Array) => {
      x.beginPath();
      for (let i = 0; i < 256; i++) {
        const px = (i / 255) * cw;
        if (i === 0) x.moveTo(px, yOf(a[i]));
        else x.lineTo(px, yOf(a[i]));
      }
    };
    const area = channel === 'rgb' ? 'l' : channel;
    trace(hist[area]);
    x.lineTo(cw, ch);
    x.lineTo(0, ch);
    x.closePath();
    x.globalAlpha = hc ? 0.6 : 0.4;
    x.fillStyle = hc ? '#ffffff' : area === 'l' ? cssVar('--c-text-3', '#8b8d93') : LINE[area as 'r'];
    x.fill();
    if (channel === 'rgb') {
      x.globalAlpha = hc ? 1 : 0.7;
      x.lineWidth = 1;
      for (const k of ['r', 'g', 'b'] as const) {
        trace(hist[k]);
        x.strokeStyle = LINE[k];
        x.stroke();
      }
    }
    x.globalAlpha = 1;
  }, [hist, channel, ed.settings]);
  if (!doc || !doc.pages[0]?.nodes.length) {
    return <EmptyState icon="histogram" title="No pixels yet" className="adjust-empty">Place a photo to see its tonal range.</EmptyState>;
  }
  const st: HistStats | null = hist ? histStats(hist[channel === 'rgb' ? 'l' : channel]) : null;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  return (
    <section className="histo-panel" aria-label="Histogram">
      <div className="row">
        <Segmented ariaLabel="Histogram source" value={source} onChange={setSource} options={[{ value: 'layer', label: 'Layer', disabled: !layer }, { value: 'document', label: 'Document' }]} />
        <span className="row-spacer" />
        <select aria-label="Histogram channel" value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
          {CHANNELS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>
      </div>
      <canvas ref={ref} className="histogram-large" role="img" aria-label={`Histogram of the ${source === 'layer' ? 'layer' : 'document'}, ${CHANNELS.find((c) => c.v === channel)!.label.toLowerCase()}`} />
      {st && (
        <dl className="histo-stats" data-mean={st.mean.toFixed(2)} data-pixels={st.pixels}>
          <dt>Mean</dt><dd>{st.mean.toFixed(1)}</dd>
          <dt>Std dev</dt><dd>{st.stdDev.toFixed(1)}</dd>
          <dt>Median</dt><dd>{st.median}</dd>
          <dt>Pixels</dt><dd>{st.pixels.toLocaleString('en-GB')}</dd>
          <dt>Min</dt><dd>{st.min}</dd>
          <dt>Max</dt><dd>{st.max}</dd>
        </dl>
      )}
      {st && (st.clippedShadows > 0.005 || st.clippedHighlights > 0.005) && (
        <p className="histo-warn">Clipped: {pct(st.clippedShadows)} shadows · {pct(st.clippedHighlights)} highlights</p>
      )}
      <p className="histo-warn">Sampled at up to {SAMPLE} px a side.</p>
    </section>
  );
}
