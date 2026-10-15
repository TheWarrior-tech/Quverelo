import { tip } from '../tooltip';
import { useRef, useState } from 'react';
import { Icon } from '../Icons';
import { Popover } from '../controls/Panel';
import type { Paint } from '../../../core/types';
import { PaintEditor, paintCss } from '../ColorControls';
import { firstColorOf } from '../../state/uiPaint';

export type ChipTarget = 'fill' | 'stroke';

/** One colour chip: a filled tile (fill) or a ring (stroke), with a "none" slash when disabled. */
export function Chip({ kind, color, enabled }: { kind: ChipTarget; color: string; enabled: boolean }) {
  return (
    <span className={`chip ${kind}${enabled ? '' : ' none'}`} style={{ ['--chip' as string]: color }} aria-hidden="true">
      <span className="chip-paint" />
    </span>
  );
}

/**
 * Affinity / Figma-style overlapping fill + stroke chips. The active target sits on top;
 * the pair is a radio group (arrow keys switch), with a swap button.
 */
export function FillStrokeChips({ fill, stroke, target, onTarget, onSwap, size = 'md', onOpen }: {
  fill: { color: string; enabled: boolean };
  stroke: { color: string; enabled: boolean };
  target: ChipTarget;
  onTarget: (t: ChipTarget) => void;
  onSwap?: () => void;
  size?: 'sm' | 'md';
  /** called with the chip element when a chip is activated (opens a picker popover in the tool rail) */
  onOpen?: (t: ChipTarget, el: HTMLElement) => void;
}) {
  const refs = { fill: useRef<HTMLButtonElement>(null), stroke: useRef<HTMLButtonElement>(null) };
  const btn = (t: ChipTarget) => {
    const v = t === 'fill' ? fill : stroke;
    return (
      <button
        ref={refs[t]}
        type="button"
        role="radio"
        aria-checked={target === t}
        tabIndex={target === t ? 0 : -1}
        className={`chip-btn ${t}${target === t ? ' on' : ''}`}
        aria-label={`${t === 'fill' ? 'Fill' : 'Stroke'}: ${v.enabled ? v.color.toUpperCase() : 'none'}`}
        data-tip={`${t === 'fill' ? 'Fill' : 'Stroke'}: ${v.enabled ? v.color.toUpperCase() : 'none'}`}
        onClick={(e) => {
          onTarget(t);
          onOpen?.(t, e.currentTarget);
        }}
        onKeyDown={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            e.preventDefault();
            const n = t === 'fill' ? 'stroke' : 'fill';
            onTarget(n);
            refs[n].current?.focus();
          }
        }}
      >
        <Chip kind={t} color={v.color} enabled={v.enabled} />
      </button>
    );
  };
  return (
    <div className={`fs-chips ${size}`} data-target={target}>
      <div className="fs-pair" role="radiogroup" aria-label="Colour target">
        {btn('stroke')}
        {btn('fill')}
      </div>
      {onSwap && (
        <button type="button" className="icon-btn xs fs-swap" {...tip('Swap fill and stroke colours')} onClick={onSwap}>
          <Icon name="swap" size={16} />
        </button>
      )}
    </div>
  );
}

/**
 * The colour control (DESIGN.md §8, UX P1-3, critique 2 P1-3). Every colour in
 * the chrome is edited through this one trigger: a chip (optionally with a
 * chevron) that opens `ColorPopoverBody` in a popover. Context bar, selection
 * toolbar, tool rail, inspector paint rows and document background all use it,
 * with the same body: paint-type tabs (None · Solid · Linear · Radial) first,
 * then the picker or gradient editor. Types a target can't take (a brush can't
 * paint a gradient) are shown disabled, never hidden, so the row never changes
 * shape between places. There are no native colour inputs in the shell.
 */
export function ColorChipButton({ kind, label, value, onChange, onCommit, allowNone = true, allowGradient = true, fallback, chevron = true, className, disabled, placement = 'below' }: {
  kind: ChipTarget;
  label: string;
  value: Paint;
  onChange: (p: Paint) => void;
  onCommit?: () => void;
  allowNone?: boolean;
  allowGradient?: boolean;
  /** colour a None paint returns to when Solid is chosen */
  fallback?: string;
  chevron?: boolean;
  className?: string;
  disabled?: boolean;
  /** 'left' opens beside the inspector instead of over it */
  placement?: 'below' | 'left' | 'right';
  }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const color = firstColorOf(value, fallback ?? '#8f959e');
  const grad = value.type === 'linear' || value.type === 'radial';
  const enabled = value.type !== 'none';
  const desc = !enabled ? 'none' : grad ? (value.type === 'linear' ? 'linear gradient' : 'radial gradient') : color.toUpperCase();
  return (
    <>
      <button type="button" className={`chip-select${chevron ? '' : ' bare'}${anchor ? ' open' : ''}${className ? ' ' + className : ''}`} aria-label={`${label} colour`} aria-haspopup="dialog" aria-expanded={!!anchor} data-tip={`${label}: ${desc}`} disabled={disabled} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        <Chip kind={kind} color={grad && kind === 'fill' ? paintCss(value) : color} enabled={enabled} />
        {chevron && <Icon name="chevron-down" size={16} />}
      </button>
      {anchor && (
        <Popover anchor={anchor} label={`${label} colour`} placement={placement} onClose={() => setAnchor(null)}>
          <ColorPopoverBody label={label} value={value} onChange={onChange} onCommit={onCommit} allowNone={allowNone} allowGradient={allowGradient} fallback={fallback} />
        </Popover>
      )}
    </>
  );
}

/** The one colour popover body: title, then the paint editor (type tabs first). */
export function ColorPopoverBody({ label, value, onChange, onCommit, allowNone = true, allowGradient = true, fallback }: { label: string; value: Paint; onChange: (p: Paint) => void; onCommit?: () => void; allowNone?: boolean; allowGradient?: boolean; fallback?: string }) {
  return (
    <div className="color-popover" data-testid="color-popover">
      <div className="popover-head">
        <span className="popover-title">{label}</span>
      </div>
      <PaintEditor paint={value} onChange={onChange} onCommit={onCommit} allowNone={allowNone} allowGradient={allowGradient} fallback={fallback} />
    </div>
  );
}
