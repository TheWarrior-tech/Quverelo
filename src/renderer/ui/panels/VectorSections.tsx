/**
 * Inspector sections for Vector features: stroke arrowheads / width profile /
 * dash pattern, live compounds, artboards, symbols and text on a path. Kept
 * out of PropertiesPanel.tsx so that file stays about the common sections.
 */
import type { ArrowHead, CompoundOp, GroupNode, SceneNode, Stroke, TextNode } from '../../../core/types';
import { updateNode } from '../../../core/commands';
import { ARROW_HEADS, WIDTH_PROFILES, profileId } from '../../../core/strokeFx';
import { ARTBOARD_PRESETS, setArtboardBackground, setArtboardOrientation, setArtboardSize } from '../../../core/artboards';
import { renameSymbol, symbolInstances } from '../../../core/symbols';
import { editor } from '../../state/editor';
import { runCommand } from '../../state/commands';
import { useEditor } from '../hooks';
import { NumberField, SliderField } from '../controls/NumberField';
import { Section } from '../controls/Panel';
import { Segmented } from '../controls/Segmented';
import { ColorChipButton } from '../color/Chips';
import { PaintRow } from '../color/PaintRow';
import { Icon } from '../Icons';
import { tip } from '../tips';
import { ProfileEditor } from './ProfileEditor';

const ARROW_LABEL: Record<ArrowHead, string> = { none: 'None', triangle: 'Triangle', open: 'Open', circle: 'Circle', square: 'Square', diamond: 'Diamond', bar: 'Bar' };

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="row insp-row">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

/**
 * Stroke extras under width · dash · cap · join: a custom dash pattern,
 * mitre limit, arrowheads (open curves) and the width profile.
 */
export function StrokeExtras({ stroke, onChange, openPath }: { stroke: Stroke; onChange: (s: Stroke) => void; openPath: boolean }) {
  const dashed = stroke.dash.length > 0;
  const prof = profileId(stroke.profile);
  return (
    <div className="stroke-extras">
      {dashed && (
        <div className="grid2" role="group" aria-label="Dash pattern">
          <NumberField label="Dash" ariaLabel="Dash length" unit="px" min={0} max={500} step={0.5} value={stroke.dash[0] ?? 0} onCommit={(v) => onChange({ ...stroke, dash: [Math.max(0.1, v), stroke.dash[1] ?? v] })} onChange={(v) => onChange({ ...stroke, dash: [Math.max(0.1, v), stroke.dash[1] ?? v] })} />
          <NumberField label="Gap" ariaLabel="Gap length" unit="px" min={0} max={500} step={0.5} value={stroke.dash[1] ?? stroke.dash[0] ?? 0} onCommit={(v) => onChange({ ...stroke, dash: [stroke.dash[0] ?? 1, Math.max(0, v)] })} onChange={(v) => onChange({ ...stroke, dash: [stroke.dash[0] ?? 1, Math.max(0, v)] })} />
        </div>
      )}
      {(dashed || stroke.join === 'miter') && (
        <div className="grid2">
          {dashed && (
            <NumberField label="Offset" ariaLabel="Dash offset" unit="px" min={-500} max={500} step={0.5} value={stroke.dashOffset ?? 0} onCommit={(v) => onChange({ ...stroke, dashOffset: v })} onChange={(v) => onChange({ ...stroke, dashOffset: v })} />
          )}
          {stroke.join === 'miter' && (
            <NumberField label="Mitre" ariaLabel="Mitre limit" min={1} max={100} step={0.5} digits={1} value={stroke.miter ?? 10} onCommit={(v) => onChange({ ...stroke, miter: v })} onChange={(v) => onChange({ ...stroke, miter: v })} />
          )}
        </div>
      )}
      {openPath && (
        <>
          <Row label="Arrows">
            <div className="arrow-selects">
              <select {...tip('Start arrowhead')} value={stroke.startArrow ?? 'none'} onChange={(e) => onChange({ ...stroke, startArrow: e.target.value as ArrowHead })}>
                {ARROW_HEADS.map((h) => <option key={h} value={h}>{h === 'none' ? 'No start' : ARROW_LABEL[h]}</option>)}
              </select>
              <select {...tip('End arrowhead')} value={stroke.endArrow ?? 'none'} onChange={(e) => onChange({ ...stroke, endArrow: e.target.value as ArrowHead })}>
                {ARROW_HEADS.map((h) => <option key={h} value={h}>{h === 'none' ? 'No end' : ARROW_LABEL[h]}</option>)}
              </select>
            </div>
          </Row>
          {((stroke.startArrow ?? 'none') !== 'none' || (stroke.endArrow ?? 'none') !== 'none') && (
            <SliderField label="Size" ariaLabel="Arrowhead size" unit="%" min={25} max={400} value={Math.round((stroke.arrowScale ?? 1) * 100)} onChange={(v) => onChange({ ...stroke, arrowScale: v / 100 })} />
          )}
        </>
      )}
      <Row label="Profile" htmlFor="stroke-profile">
        <select id="stroke-profile" aria-label="Width profile" value={prof} onChange={(e) => {
          const p = WIDTH_PROFILES.find((x) => x.id === e.target.value);
          if (p) onChange({ ...stroke, profile: p.profile.length ? p.profile.map((x) => ({ ...x })) : undefined });
        }}>
          {WIDTH_PROFILES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          {prof === 'custom' && <option value="custom">Custom</option>}
        </select>
      </Row>
      <ProfileEditor profile={stroke.profile} onChange={(profile) => onChange({ ...stroke, profile })} />
    </div>
  );
}

const OPS: { value: CompoundOp; label: string; icon: string }[] = [
  { value: 'add', label: 'Add', icon: 'bool-add' },
  { value: 'subtract', label: 'Subtract', icon: 'bool-subtract' },
  { value: 'intersect', label: 'Intersect', icon: 'bool-intersect' },
  { value: 'exclude', label: 'Exclude', icon: 'bool-exclude' },
  { value: 'divide', label: 'Divide', icon: 'bool-divide' },
];

/** Live compound: operation, its own fill and stroke, release / expand. */
export function CompoundSection({ n }: { n: GroupNode }) {
  const c = n.compound!;
  const set = (patch: Partial<typeof c>, label: string, merge?: string) => editor.commit(label, (d) => updateNode<GroupNode>(d, n.id, (g) => ({ ...g, compound: { ...g.compound!, ...patch } })), merge);
  return (
    <Section id="compound" title="Compound">
      <Segmented ariaLabel="Compound operation" className="compound-ops" full value={c.op} onChange={(op: CompoundOp) => set({ op }, 'Compound operation')} options={OPS.map((o) => ({ value: o.value, label: o.label }))} />
      <Row label="Fill"><PaintRow kind="fill" label="Compound fill" paint={c.fill} onChange={(p) => set({ fill: p }, 'Fill', 'cfill')} /></Row>
      <Row label="Stroke"><PaintRow kind="stroke" label="Compound stroke" paint={c.stroke.paint} fallback="#1b1b1f" onChange={(p) => set({ stroke: { ...c.stroke, paint: p, width: p.type !== 'none' && !c.stroke.width ? 2 : c.stroke.width } }, 'Stroke', 'cstroke')} /></Row>
      {c.stroke.paint.type !== 'none' && (
        <div className="grid2">
          <NumberField label="W" ariaLabel="Compound stroke width" unit="px" min={0} max={500} step={0.5} value={c.stroke.width} onCommit={(v) => set({ stroke: { ...c.stroke, width: v } }, 'Stroke width', 'cw')} onChange={(v) => set({ stroke: { ...c.stroke, width: v } }, 'Stroke width', 'cw')} />
        </div>
      )}
      <p className="hint">The shapes inside stay editable: select one in Layers or with the Node tool.</p>
      <div className="row">
        <button className="btn sm ghost" onClick={() => runCommand('layer.release-compound')} {...tip('Release compound', 'layer.release-compound')} data-tip-hint="Back to separate shapes">Release</button>
        <button className="btn sm ghost" onClick={() => runCommand('layer.expand-compound')} {...tip('Expand compound', 'layer.expand-compound')} data-tip-hint={c.op === 'divide' ? 'Bake into separate pieces' : 'Bake into one curve'}>Expand</button>
      </div>
    </Section>
  );
}

/** Artboard: size, preset and background. */
export function ArtboardSection({ n }: { n: GroupNode }) {
  const a = n.artboard!;
  const size = (w: number, h: number, merge?: string) => editor.commit('Artboard size', (d) => setArtboardSize(d, n.id, w, h), merge);
  return (
    <Section id="artboard" title="Artboard">
      <div className="grid2">
        <NumberField label="W" ariaLabel="Artboard width (px)" unit="px" min={1} max={100000} digits={0} value={a.w} onCommit={(v) => size(v, a.h, 'abw')} onChange={(v) => size(v, a.h, 'abw')} />
        <NumberField label="H" ariaLabel="Artboard height (px)" unit="px" min={1} max={100000} digits={0} value={a.h} onCommit={(v) => size(a.w, v, 'abh')} onChange={(v) => size(a.w, v, 'abh')} />
      </div>
      <Row label="Orientation">
        <Segmented ariaLabel="Artboard orientation" className="full" value={a.h > a.w ? 'portrait' : 'landscape'} onChange={(o: 'portrait' | 'landscape') => editor.commit('Artboard orientation', (d) => setArtboardOrientation(d, n.id, o))} options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
      </Row>
      <Row label="Preset" htmlFor="ab-preset">
        <select id="ab-preset" value="" onChange={(e) => {
          const p = ARTBOARD_PRESETS.find((x) => x.id === e.target.value);
          if (p) size(p.w, p.h);
        }}>
          <option value="" disabled>Choose a size…</option>
          {ARTBOARD_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </Row>
      <Row label="Background">
        <ColorChipButton kind="fill" label="Artboard background" placement="left" value={a.background ? { type: 'solid', color: a.background } : { type: 'none' }} fallback="#ffffff" allowGradient={false} transparent
          onChange={(p) => editor.commit('Artboard background', (d) => setArtboardBackground(d, n.id, p.type === 'solid' ? p.color : null), p.type === 'solid' ? 'abbg' : undefined)} />
      </Row>
      <div className="row">
        <button className="btn sm ghost" onClick={() => runCommand('slice.add')}><Icon name="slice" /> Add export slice</button>
      </div>
    </Section>
  );
}

/** Symbol instance: the symbol's name, how many instances share it, detach. */
export function SymbolSection({ n }: { n: GroupNode }) {
  const ed = useEditor();
  const doc = ed.doc!;
  const def = doc.symbols?.find((s) => s.id === n.symbolId);
  const count = symbolInstances(doc).get(n.symbolId!)?.length ?? 1;
  return (
    <Section id="symbol" title="Symbol">
      <Row label="Name" htmlFor="sym-name">
        <input id="sym-name" type="text" value={def?.name ?? n.name} onChange={(e) => editor.commit('Rename symbol', (d) => renameSymbol(d, n.symbolId!, e.target.value), 'symname')} />
      </Row>
      <Row label="Used"><span className="value num" data-testid="symbol-count">{count === 1 ? '1 instance' : `${count} instances`}</span></Row>
      <p className="hint">Edit anything inside this instance and every instance updates.</p>
      <div className="row">
        <button className="btn sm ghost" onClick={() => runCommand('symbol.detach')}>Detach</button>
      </div>
    </Section>
  );
}

/** Text on a path: where it starts, which side, whether the path shows. */
export function TextPathSection({ n }: { n: TextNode }) {
  const tp = n.onPath!;
  const set = (patch: Partial<typeof tp>, label: string, merge?: string) => editor.commit(label, (d) => updateNode<TextNode>(d, n.id, (x) => ({ ...x, onPath: { ...x.onPath!, ...patch } })), merge);
  return (
    <Section id="text-path" title="Text on path">
      <SliderField label="Start" ariaLabel="Start along the path" unit="%" min={0} max={100} value={Math.round(tp.start * 100)} onChange={(v) => set({ start: v / 100 }, 'Path text start', 'tpstart')} />
      <div className="row">
        <label className="check"><input type="checkbox" checked={!!tp.flip} onChange={(e) => set({ flip: e.target.checked }, 'Flip path text')} /> Other side</label>
        <label className="check"><input type="checkbox" checked={!!tp.showPath} onChange={(e) => set({ showPath: e.target.checked }, 'Show path')} /> Show path</label>
      </div>
      <Row label="Text" htmlFor="tp-text">
        <input id="tp-text" type="text" value={n.text} onChange={(e) => editor.commit('Path text', (d) => updateNode<TextNode>(d, n.id, { text: e.target.value }), 'tptext')} />
      </Row>
      <div className="row">
        <button className="btn sm ghost" onClick={() => runCommand('text.off-path')}>Remove from path</button>
      </div>
    </Section>
  );
}

/** Appearance rows for a compound (its own fill / stroke) are in CompoundSection; this says which vector section a node has. */
export function vectorSectionFor(n: SceneNode): 'compound' | 'artboard' | 'symbol' | 'text-path' | null {
  if (n.type === 'group' && n.compound) return 'compound';
  if (n.type === 'group' && n.artboard) return 'artboard';
  if (n.type === 'group' && n.symbolId) return 'symbol';
  if (n.type === 'text' && n.onPath) return 'text-path';
  return null;
}
