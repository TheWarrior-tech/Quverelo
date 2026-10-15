import { useEffect, useState } from 'react';
import type { Paint } from '../../../core/types';
import { Icon } from '../Icons';
import { ColorChipButton, type ChipTarget } from './Chips';
import { parseCss, toHex } from './colorMath';

const firstColor = (p: Paint, fallback = '#8f959e') => (p.type === 'solid' ? p.color : p.type === 'none' ? fallback : p.stops[0]?.color ?? fallback);
const PAINT_NAME: Record<Paint['type'], string> = { none: 'None', solid: 'Solid', linear: 'Linear gradient', radial: 'Radial gradient' };

/** Hex text field for a solid paint: commits on Enter or blur, Esc reverts. */
function HexField({ value, label, onCommit }: { value: string; label: string; onCommit: (hex: string) => void }) {
  const shown = value.replace('#', '').toUpperCase().slice(0, 6);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const t = text.trim().replace(/^#/, '');
    const c = /^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(t) ? parseCss('#' + t) : null;
    if (c) onCommit(toHex(c));
    else setText(shown);
  };
  return (
    <span className="paint-hex">
      <span className="paint-hex-hash" aria-hidden="true">#</span>
      <input
        type="text"
        aria-label={`${label} hex`}
        spellCheck={false}
        maxLength={7}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(shown);
            e.stopPropagation();
          }
        }}
      />
    </span>
  );
}

/**
 * Inspector paint row (Figma-style, UX P1-2): chip · hex (or gradient name) ·
 * add/remove. The chip opens the full paint editor (solid + gradients) in a
 * popover, so Fill and Stroke stay one row each and above the fold.
 */
export function PaintRow({ kind, label, paint, onChange, allowNone = true, allowGradient = true, fallback }: { kind: ChipTarget; label: string; paint: Paint; onChange: (p: Paint) => void; allowNone?: boolean; allowGradient?: boolean; fallback?: string }) {
  const color = firstColor(paint, fallback);
  const on = paint.type !== 'none';
  return (
    <div className={`paint-row${on ? '' : ' off'}`} data-paint={kind}>
      <ColorChipButton
        kind={kind}
        label={label}
        value={paint}
        fallback={color}
        onChange={onChange}
        allowNone={allowNone}
        allowGradient={allowGradient}
        chevron={false}
        placement="left"
      />
      {paint.type === 'solid' ? (
        <HexField value={paint.color} label={label} onCommit={(hex) => onChange({ type: 'solid', color: hex })} />
      ) : (
        <span className="paint-name">{PAINT_NAME[paint.type]}</span>
      )}
      {allowNone &&
        (on ? (
          <button type="button" className="icon-btn xs" aria-label={`Remove ${label.toLowerCase()}`} data-tip={`Remove ${label.toLowerCase()}`} onClick={() => onChange({ type: 'none' })}>
            <Icon name="minus" size={16} />
          </button>
        ) : (
          <button type="button" className="icon-btn xs" aria-label={`Add ${label.toLowerCase()}`} data-tip={`Add ${label.toLowerCase()}`} onClick={() => onChange({ type: 'solid', color })}>
            <Icon name="plus" size={16} />
          </button>
        ))}
    </div>
  );
}
