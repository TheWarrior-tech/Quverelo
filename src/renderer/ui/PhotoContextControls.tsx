/**
 * Context-bar controls for the Photo parity tools. Plain functions (not
 * components) so the bar's priority+ overflow sees each group, like the
 * built-in tool blocks in ContextBar.tsx.
 */
import { LIQUIFY_MODES, type LiquifyMode } from '../../core/liquify';
import type { ToolId, ToolOptions } from '../state/editor';
import { editor } from '../state/editor';
import { runCommand } from '../state/commands';
import { Icon } from './Icons';
import { tip } from './tips';
import { Segmented } from './controls/Segmented';
import { CtxHint } from './controls/CtxHint';
import { Pri } from './controls/CtxOverflow';

function Slider({ label, value, min, max, step = 1, onChange, fmt }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="group">
      {label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} aria-label={label} />
      <span className="num ctx-value">{fmt ? fmt(value) : Math.round(value)}</span>
    </label>
  );
}

function Toggle({ label, checked, onChange, hint, ariaLabel }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; ariaLabel?: string }) {
  return (
    <label className="group check" data-tip={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={ariaLabel ?? label} /> {label}
    </label>
  );
}

const set = (p: Partial<ToolOptions>) => editor.setToolOptions(p);
const pct = (v: number) => `${Math.round(v)}%`;
const px = (v: number) => `${Math.round(v)}px`;

/** Flow and pen pressure, shared by every brush. */
export function brushDynamics() {
  const o = editor.ui.toolOptions;
  return (
    <>
      <Pri n={4}>
        <Slider label="Flow" value={o.brushFlow * 100} min={1} max={100} onChange={(v) => set({ brushFlow: v / 100 })} fmt={pct} />
      </Pri>
      <Pri n={2}>
        <div className="group" role="group" aria-label="Pen pressure">
          <span className="ctx-label">Pressure</span>
          <Toggle label="Size" ariaLabel="Pressure changes size" checked={o.pressureSize} onChange={(v) => set({ pressureSize: v })} hint="Pen pressure changes the brush size" />
          <Toggle label="Flow" ariaLabel="Pressure changes flow" checked={o.pressureFlow} onChange={(v) => set({ pressureFlow: v })} hint="Pen pressure changes the flow" />
        </div>
      </Pri>
    </>
  );
}

/** "Painting mask" chip while brushes target a layer's pixel mask. */
export function maskEditChip() {
  const id = editor.ui.maskEditId;
  const n = id ? editor.activeLayer() ?? editor.selectedNodes()[0] : null;
  if (!id || !n || n.id !== id || !n.pixelMask) return null;
  return (
    <div className="group">
      <span className="mask-edit-chip" data-mask-editing={id}><Icon name="mask" size={16} /> Painting mask · black hides, white reveals, grey part-shows</span>
      <button className="btn ghost sm" onClick={() => editor.setUi({ maskEditId: null })}>Paint pixels</button>
    </div>
  );
}

/** Magic wand options (after the shared selection-mode group). */
export function wandControls() {
  const o = editor.ui.toolOptions;
  return (
    <>
      <Pri n={7}>
        <Slider label="Tolerance" value={o.wandTolerance} min={0} max={255} onChange={(v) => set({ wandTolerance: v })} />
      </Pri>
      <Pri n={6}>
        <Toggle label="Contiguous" checked={o.wandContiguous} onChange={(v) => set({ wandContiguous: v })} hint="Only connected pixels of similar colour" />
      </Pri>
      <Pri n={2}>
        <Toggle label="All layers" checked={o.wandAllLayers} onChange={(v) => set({ wandAllLayers: v })} hint="Sample every visible layer, not just the active one" />
      </Pri>
    </>
  );
}

/** Feather and Refine edge, next to the selection actions. */
export function refineButtons() {
  const has = !!editor.ui.pixelSelection;
  const f = editor.ui.pixelSelectionFeather;
  return (
    <Pri n={4}>
      <div className="group" role="group" aria-label="Refine selection">
        <button className="btn ghost" {...tip('Feather', 'select.feather')} disabled={!has} onClick={() => runCommand('select.feather')}><Icon name="feather" /> {f > 0 ? `Feather ${Math.round(f)} px` : 'Feather'}</button>
        <button className="btn ghost" {...tip('Refine edge', 'select.refine')} disabled={!has} onClick={() => runCommand('select.refine')}>Refine…</button>
      </div>
    </Pri>
  );
}

const RETOUCH: ToolId[] = ['clone', 'heal', 'spot-heal', 'dodge', 'burn', 'smudge'];

export function isRetouchTool(t: ToolId): boolean {
  return RETOUCH.includes(t);
}

export function retouchControls(t: ToolId) {
  const o = editor.ui.toolOptions;
  return (
    <>
      <Pri n={7}>
        <Slider label="Size" value={o.retouchSize} min={1} max={500} onChange={(v) => set({ retouchSize: v })} fmt={px} />
      </Pri>
      <Pri n={3}>
        <Slider label="Hardness" value={o.brushHardness * 100} min={0} max={100} onChange={(v) => set({ brushHardness: v / 100 })} fmt={pct} />
      </Pri>
      {(t === 'clone' || t === 'heal') && (
        <>
          <Slider label="Opacity" value={o.brushOpacity * 100} min={1} max={100} onChange={(v) => set({ brushOpacity: v / 100 })} fmt={pct} />
          <Toggle label="Aligned" checked={o.cloneAligned} onChange={(v) => set({ cloneAligned: v })} hint="Keep the same source offset for every stroke" />
        </>
      )}
      {(t === 'dodge' || t === 'burn') && (
        <>
          <div className="group">
            <Segmented
              ariaLabel="Tonal range"
              value={o.toneRange}
              onChange={(v) => set({ toneRange: v })}
              options={[{ value: 'shadows', label: 'Shadows' }, { value: 'midtones', label: 'Midtones' }, { value: 'highlights', label: 'Highlights' }]}
            />
          </div>
          <Slider label="Exposure" value={o.toneExposure * 100} min={1} max={100} onChange={(v) => set({ toneExposure: v / 100 })} fmt={pct} />
        </>
      )}
      {t === 'smudge' && <Slider label="Strength" value={o.smudgeStrength * 100} min={1} max={100} onChange={(v) => set({ smudgeStrength: v / 100 })} fmt={pct} />}
      {brushDynamics()}
      <CtxHint>
        {t === 'clone' || t === 'heal'
          ? editor.ui.cloneSource ? 'Drag to paint from the source · Alt-click sets a new source' : 'Alt-click to set the source point'
          : t === 'spot-heal' ? 'Drag over spots and blemishes' : t === 'smudge' ? 'Drag to smear colour along the stroke' : 'Drag over the area to ' + (t === 'dodge' ? 'lighten' : 'darken')}
      </CtxHint>
    </>
  );
}

export function liquifyControls() {
  const o = editor.ui.toolOptions;
  return (
    <>
      <div className="group">
        <select aria-label="Liquify mode" value={o.liquifyMode} onChange={(e) => set({ liquifyMode: e.target.value as LiquifyMode })} style={{ width: 112 }}>
          {LIQUIFY_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      <Slider label="Size" value={o.liquifySize} min={4} max={800} onChange={(v) => set({ liquifySize: v })} fmt={px} />
      <Slider label="Strength" value={o.liquifyStrength * 100} min={1} max={100} onChange={(v) => set({ liquifyStrength: v / 100 })} fmt={pct} />
      <Pri n={Infinity}>
        <div className="ctx-spacer" />
        <div className="group ctx-commit">
          <button className="btn" data-action="liquify-cancel" onClick={() => runCommand('liquify.cancel')} {...tip('Cancel', 'Escape')}>Cancel</button>
          <button className="btn primary" data-action="liquify-apply" onClick={() => runCommand('liquify.apply')} {...tip('Apply', 'Enter')}><Icon name="check" /> Apply</button>
        </div>
      </Pri>
    </>
  );
}
