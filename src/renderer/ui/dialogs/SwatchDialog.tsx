import { useEffect, useState } from 'react';
import { editor } from '../../state/editor';
import { closeDialog, toast } from '../../state/bus';
import { docColour, PROFILES } from '../../../core/colour/profiles';
import { addColourSwatch, cleanInkName, cmykFromPercent, formatCmyk, swatchProblem, type Cmyk } from '../../../core/colour/swatches';
import { colourEngine, whenColourReady } from '../../engine/colour';
import { cmykToRgb, parseCss, rgbToCmyk, toHex } from '../color/colorMath';
import { Dialog } from './DialogHost';
import { Field, NumberInput, Segmented } from './controls';

type Kind = 'cmyk' | 'spot';

/** CMYK values (0..1) → on-screen preview in the document's RGB space, through the press profile. */
function preview(c: Cmyk): string {
  const e = colourEngine();
  const col = docColour(editor.doc?.settings);
  if (e) {
    const [r, g, b] = e.cmykToRgb(c, col.cmykProfile, col.rgbProfile);
    return toHex({ r: r * 255, g: g * 255, b: b * 255 });
  }
  return toHex(cmykToRgb(c[0], c[1], c[2], c[3]));
}

/** Document › New CMYK or spot swatch. */
export function SwatchDialog({ kind: initial }: { kind?: Kind }) {
  const doc = editor.doc!;
  const col = docColour(doc.settings);
  const [kind, setKind] = useState<Kind>(initial ?? 'cmyk');
  const [name, setName] = useState('');
  const [ready, setReady] = useState(!!colourEngine());
  // start from the current fill colour, separated for the document's press
  const [vals, setVals] = useState<number[]>(() => {
    const e = colourEngine();
    const rgb = parseCss(editor.ui.fillColor);
    const c = e ? e.rgbToCmyk([rgb.r / 255, rgb.g / 255, rgb.b / 255], col.rgbProfile, col.cmykProfile) : rgbToCmyk(rgb);
    return c.map((v) => Math.round(v * 100));
  });
  useEffect(() => {
    if (!ready) whenColourReady(() => setReady(true));
  }, [ready]);
  const cmyk = cmykFromPercent(vals);
  const color = preview(cmyk);
  const input = { name, color, cmyk, spot: kind === 'spot' };
  const problem = swatchProblem(doc, input);
  const apply = () => {
    if (problem) return;
    editor.commit(kind === 'spot' ? 'Add spot colour' : 'Add CMYK swatch', (d) => addColourSwatch(d, input));
    toast(kind === 'spot' ? `Added spot colour “${cleanInkName(name)}”` : `Added ${formatCmyk(cmyk)}`, 'success');
    closeDialog();
  };
  return (
    <Dialog
      title={kind === 'spot' ? 'New spot colour' : 'New CMYK swatch'}
      size="sm"
      onSubmit={apply}
      footer={<><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" disabled={!!problem} onClick={apply} data-testid="swatch-add">Add swatch</button></>}
    >
      <div className="fgrid swatch-form">
        <Field label="Type" hint={kind === 'spot' ? 'Printed with its own ink. The CMYK values are used when the press prints it in process colours.' : 'Exact ink percentages, written as is to print PDFs.'}>
          <Segmented label="Swatch type" value={kind} onChange={(v) => setKind(v as Kind)} options={[{ value: 'cmyk', label: 'CMYK' }, { value: 'spot', label: 'Spot colour' }]} />
        </Field>
        <Field label={kind === 'spot' ? 'Ink name' : 'Name'} htmlFor="sw-name" hint={problem && (name || kind === 'spot') ? <span className="err">{problem}</span> : undefined}>
          <input id="sw-name" type="text" value={name} spellCheck={false} placeholder={kind === 'spot' ? 'PANTONE 185 C' : formatCmyk(cmyk)} onChange={(e) => setName(e.target.value)} data-testid="swatch-name" data-autofocus="" />
        </Field>
        <Field label="Inks">
          <div className="pair cmyk-pair">
            {(['C', 'M', 'Y', 'K'] as const).map((ch, i) => (
              <NumberInput key={ch} label={`${ch === 'C' ? 'Cyan' : ch === 'M' ? 'Magenta' : ch === 'Y' ? 'Yellow' : 'Black'} percent`} prefix={ch} unit="%" value={vals[i]} min={0} max={100} step={1} onChange={(v) => setVals(vals.map((x, j) => (j === i ? Math.round(Math.min(100, Math.max(0, v))) : x)))} />
            ))}
          </div>
        </Field>
        <Field label="Preview" hint={`On screen through ${PROFILES[col.cmykProfile].name}`}>
          <span className="swatch-preview" style={{ ['--sw' as string]: color }} data-testid="swatch-preview" data-color={color} role="img" aria-label={`Preview ${color}`} />
        </Field>
      </div>
    </Dialog>
  );
}
