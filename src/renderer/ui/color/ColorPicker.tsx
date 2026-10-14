import { useEffect, useRef, useState } from 'react';
import { addSwatch } from '../../../core/commands';
import { editor } from '../../state/editor';
import { useEditor } from '../hooks';
import { Icon } from '../Icons';
import { NumberField } from '../controls/NumberField';
import { Segmented } from '../controls/Panel';
import { clamp } from '../controls/numeric';
import { channels, fromChannels, hsvToRgb, MODEL_CHANNELS, parseCss, parseHex, rgbToHsv, sameRgb, toCss, toHex, type ColorModel, type RGB } from './colorMath';
import { addRecentColour, useRecentColours } from './recent';

type View = 'square' | 'wheel';
let lastModel: ColorModel = 'hex';
let lastView: View = 'square';

interface EyeDropperCtor {
  new (): { open: () => Promise<{ sRGBHex: string }> };
}

/** Pointer drag over an element, reporting 0..1 coordinates; `end` fires once on release. */
function useDrag(fn: (x: number, y: number) => void, end: () => void) {
  return (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    el.focus();
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const move = (ev: { clientX: number; clientY: number }) => fn(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
    move(e);
    const mv = (ev: PointerEvent) => move(ev);
    const up = () => {
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      end();
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Colour picker: saturation/value square (or hue wheel), hue + alpha strips,
 * Hex / RGB / HSL / CMYK fields, eyedropper, document palette and recent colours.
 * `onChange` streams values during gestures; `onCommit` marks the end of one.
 */
export function ColorPicker({ value, onChange, onCommit, showPalette = true }: { value: string; onChange: (c: string) => void; onCommit?: () => void; showPalette?: boolean }) {
  useEditor();
  const c = parseCss(value);
  const [hsv, setHsv] = useState<[number, number, number]>(() => rgbToHsv(c));
  const [alpha, setAlpha] = useState(c.a);
  const [model, setModelState] = useState<ColorModel>(lastModel);
  const [view, setViewState] = useState<View>(lastView);
  const [hexText, setHexText] = useState(toHex(c).slice(1).toUpperCase());
  const lastOut = useRef(value);
  const recent = useRecentColours();
  const swatches = editor.doc?.swatches ?? [];
  const setModel = (m: ColorModel) => setModelState((lastModel = m));
  const setView = (v: View) => setViewState((lastView = v));

  // follow external changes (selection change, undo) without losing hue on greys
  useEffect(() => {
    if (value === lastOut.current) return;
    lastOut.current = value;
    const p = parseCss(value);
    const next = rgbToHsv(p);
    setHsv((prev) => [next[1] > 0 && next[2] > 0 ? next[0] : prev[0], next[2] > 0 ? next[1] : prev[1], next[2]]);
    setAlpha(p.a);
    setHexText(toHex(p).slice(1).toUpperCase());
  }, [value]);

  const rgb = hsvToRgb(hsv[0], hsv[1], hsv[2]);
  const out = (h: number, s: number, v: number, a = alpha) => {
    setHsv([h, s, v]);
    setAlpha(a);
    const col = hsvToRgb(h, s, v);
    setHexText(toHex(col).slice(1).toUpperCase());
    const css = toCss(col, a);
    lastOut.current = css;
    onChange(css);
  };
  const outRgb = (col: RGB, a = alpha, commit = true) => {
    const next = rgbToHsv(col);
    out(next[1] > 0 && next[2] > 0 ? next[0] : hsv[0], next[2] > 0 ? next[1] : hsv[1], next[2], a);
    if (commit) done(toCss(col, a));
  };
  const done = (css = lastOut.current) => {
    addRecentColour(css);
    onCommit?.();
  };

  const svDown = useDrag((x, y) => out(hsv[0], x, 1 - y, alpha), () => done());
  const wheelDown = useDrag((x, y) => {
    const dx = x - 0.5;
    const dy = y - 0.5;
    const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 450) % 360;
    out(h, clamp(Math.hypot(dx, dy) * 2, 0, 1), hsv[2]);
  }, () => done());
  const hueDown = useDrag((x) => out(x * 359.99, hsv[1], hsv[2]), () => done());
  const valDown = useDrag((x) => out(hsv[0], hsv[1], x), () => done());
  const alphaDown = useDrag((x) => out(hsv[0], hsv[1], hsv[2], Math.round(x * 100) / 100), () => done());

  const keyStep = (e: React.KeyboardEvent, fn: (dx: number, dy: number, big: boolean) => void) => {
    const big = e.shiftKey;
    const map: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const d = map[e.key];
    if (!d) return;
    e.preventDefault();
    fn(d[0], d[1], big);
  };
  const keyEnd = (e: React.KeyboardEvent) => e.key.startsWith('Arrow') && done();

  const [hr, hg, hb] = (() => {
    const p = hsvToRgb(hsv[0], 1, 1);
    return [Math.round(p.r), Math.round(p.g), Math.round(p.b)];
  })();
  const solidCss = toHex(rgb);
  const eyedropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  const pickScreen = async () => {
    if (eyedropper) {
      try {
        const r = await new eyedropper().open();
        const p = parseHex(r.sRGBHex);
        if (p) outRgb(p, alpha);
      } catch {
        /* cancelled */
      }
    } else editor.setTool('eyedropper');
  };

  const chans = model === 'hex' ? null : MODEL_CHANNELS[model];
  const chanVals = model === 'hex' ? [] : channels(model, rgb);
  const isCurrent = (col: string) => sameRgb(col, solidCss);

  return (
    <div className="color-picker" data-view={view}>
      {view === 'square' ? (
        <div
          className="cp-area cp-square"
          role="slider"
          tabIndex={0}
          aria-label="Saturation and brightness"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(hsv[2] * 100)}
          aria-valuetext={`Saturation ${pct(hsv[1])}, brightness ${pct(hsv[2])}`}
          style={{ ['--hue' as string]: `rgb(${hr},${hg},${hb})` }}
          onPointerDown={svDown}
          onKeyDown={(e) => keyStep(e, (dx, dy, big) => out(hsv[0], clamp(hsv[1] + dx * (big ? 0.1 : 0.01), 0, 1), clamp(hsv[2] + dy * (big ? 0.1 : 0.01), 0, 1)))}
          onKeyUp={keyEnd}
        >
          <span className="cp-knob" style={{ left: pct(hsv[1]), top: pct(1 - hsv[2]), background: solidCss }} />
        </div>
      ) : (
        <div className="cp-wheel-wrap">
          <div
            className="cp-area cp-wheel"
            role="slider"
            tabIndex={0}
            aria-label="Hue and saturation"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsv[0])}
            aria-valuetext={`Hue ${Math.round(hsv[0])} degrees, saturation ${pct(hsv[1])}`}
            style={{ ['--dim' as string]: String(1 - hsv[2]) }}
            onPointerDown={wheelDown}
            onKeyDown={(e) => keyStep(e, (dx, dy, big) => out((hsv[0] + dx * (big ? 10 : 1) + 360) % 360, clamp(hsv[1] + dy * (big ? 0.1 : 0.01), 0, 1), hsv[2]))}
            onKeyUp={keyEnd}
          >
            <span
              className="cp-knob"
              style={{
                left: `${50 + Math.sin((hsv[0] * Math.PI) / 180) * hsv[1] * 50}%`,
                top: `${50 - Math.cos((hsv[0] * Math.PI) / 180) * hsv[1] * 50}%`,
                background: solidCss,
              }}
            />
          </div>
        </div>
      )}

      <div className="cp-strips-row">
        <div className="cp-preview" aria-hidden="true">
          <span style={{ background: toCss(rgb, alpha) }} />
        </div>
        <div className="cp-strips">
          {view === 'square' ? (
            <div
              className="cp-strip cp-hue"
              role="slider"
              tabIndex={0}
              aria-label="Hue"
              aria-valuemin={0}
              aria-valuemax={359}
              aria-valuenow={Math.round(hsv[0])}
              aria-valuetext={`${Math.round(hsv[0])} degrees`}
              onPointerDown={hueDown}
              onKeyDown={(e) => keyStep(e, (dx, dy, big) => out((hsv[0] + (dx || dy) * (big ? 10 : 1) + 360) % 360, hsv[1], hsv[2]))}
              onKeyUp={keyEnd}
            >
              <span className="cp-knob" style={{ left: `${(hsv[0] / 360) * 100}%`, background: `rgb(${hr},${hg},${hb})` }} />
            </div>
          ) : (
            <div
              className="cp-strip cp-value"
              role="slider"
              tabIndex={0}
              aria-label="Brightness"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(hsv[2] * 100)}
              style={{ ['--full' as string]: toHex(hsvToRgb(hsv[0], hsv[1], 1)) }}
              onPointerDown={valDown}
              onKeyDown={(e) => keyStep(e, (dx, dy, big) => out(hsv[0], hsv[1], clamp(hsv[2] + (dx || dy) * (big ? 0.1 : 0.01), 0, 1)))}
              onKeyUp={keyEnd}
            >
              <span className="cp-knob" style={{ left: pct(hsv[2]), background: solidCss }} />
            </div>
          )}
          <div
            className="cp-strip cp-alpha"
            role="slider"
            tabIndex={0}
            aria-label="Opacity"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(alpha * 100)}
            aria-valuetext={pct(alpha)}
            style={{ ['--solid' as string]: solidCss }}
            onPointerDown={alphaDown}
            onKeyDown={(e) => keyStep(e, (dx, dy, big) => out(hsv[0], hsv[1], hsv[2], clamp(Math.round((alpha + (dx || dy) * (big ? 0.1 : 0.01)) * 100) / 100, 0, 1)))}
            onKeyUp={keyEnd}
          >
            <span className="cp-knob" style={{ left: pct(alpha) }}><i style={{ background: toCss(rgb, alpha) }} /></span>
          </div>
        </div>
        <button type="button" className="icon-btn sm" aria-label={eyedropper ? 'Pick a colour from the screen' : 'Pick a colour from the canvas'} title={eyedropper ? 'Pick from screen' : 'Pick from canvas (I)'} onClick={pickScreen}>
          <Icon name="eyedropper" />
        </button>
      </div>

      <div className="cp-mode-row">
        <Segmented
          ariaLabel="Colour model"
          value={model}
          onChange={setModel}
          options={[
            { value: 'hex', label: 'Hex' },
            { value: 'rgb', label: 'RGB' },
            { value: 'hsl', label: 'HSL' },
            { value: 'cmyk', label: 'CMYK', title: 'Device CMYK (uncalibrated preview)' },
          ]}
        />
        <Segmented
          ariaLabel="Picker layout"
          value={view}
          onChange={setView}
          options={[
            { value: 'square', label: 'Box', title: 'Saturation / brightness box' },
            { value: 'wheel', label: 'Wheel', title: 'Hue wheel' },
          ]}
        />
      </div>

      <div className={`cp-fields cols-${chans ? chans.length + 1 : 2}`}>
        {chans ? (
          chans.map((ch, i) => (
            <NumberField
              key={model + ch.key}
              label={ch.label}
              ariaLabel={`${model.toUpperCase()} ${ch.label}${ch.unit === '%' ? ' percent' : ch.unit === '°' ? ' degrees' : ''}`}
              value={chanVals[i]}
              min={0}
              max={ch.max}
              digits={0}
              onChange={(v) => {
                const vals = [...chanVals];
                vals[i] = v;
                outRgb(fromChannels(model as Exclude<ColorModel, 'hex'>, vals), alpha, false);
              }}
              onCommit={(v) => {
                const vals = [...chanVals];
                vals[i] = v;
                outRgb(fromChannels(model as Exclude<ColorModel, 'hex'>, vals), alpha);
              }}
            />
          ))
        ) : (
          <div className="nf cp-hex">
            <span className="nf-label static" aria-hidden="true">#</span>
            <input
              type="text"
              value={hexText}
              aria-label="Hex colour"
              spellCheck={false}
              maxLength={9}
              onChange={(e) => setHexText(e.target.value.toUpperCase())}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => {
                const p = parseHex(hexText);
                if (p) outRgb(p, hexText.replace('#', '').length === 8 ? p.a : alpha);
                else setHexText(toHex(rgb).slice(1).toUpperCase());
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  setHexText(toHex(rgb).slice(1).toUpperCase());
                  e.stopPropagation();
                }
              }}
            />
          </div>
        )}
        <NumberField
          label="A"
          ariaLabel="Colour opacity percent"
          value={Math.round(alpha * 100)}
          min={0}
          max={100}
          digits={0}
          unit={chans ? undefined : '%'}
          onChange={(v) => out(hsv[0], hsv[1], hsv[2], v / 100)}
          onCommit={(v) => {
            out(hsv[0], hsv[1], hsv[2], v / 100);
            done(toCss(rgb, v / 100));
          }}
        />
      </div>

      {showPalette && (
        <div className="cp-palettes">
          <div className="cp-palette-head">
            <span className="micro">Document</span>
            <button type="button" className="icon-btn xs" aria-label="Add this colour to the document palette" title="Add to document palette" onClick={() => editor.commit('Add swatch', (d) => addSwatch(d, solidCss))}>
              <Icon name="plus" size={16} />
            </button>
          </div>
          <div className="cp-swatches" role="listbox" aria-label="Document palette">
            {swatches.map((s) => (
              <button
                type="button"
                key={s.id}
                role="option"
                aria-selected={isCurrent(s.color)}
                className={`swatch${isCurrent(s.color) ? ' on' : ''}`}
                style={{ ['--sw' as string]: s.color }}
                title={s.name}
                aria-label={s.name}
                onClick={() => outRgb(parseCss(s.color), alpha)}
              />
            ))}
          </div>
          {recent.length > 0 && (
            <>
              <div className="cp-palette-head"><span className="micro">Recent</span></div>
              <div className="cp-swatches" role="listbox" aria-label="Recent colours">
                {recent.map((col) => (
                  <button
                    type="button"
                    key={col}
                    role="option"
                    aria-selected={isCurrent(col)}
                    className={`swatch${isCurrent(col) ? ' on' : ''}`}
                    style={{ ['--sw' as string]: col }}
                    title={col}
                    aria-label={`Recent colour ${col}`}
                    onClick={() => {
                      const p = parseCss(col);
                      outRgb(p, p.a);
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
