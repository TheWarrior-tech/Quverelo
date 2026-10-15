import { tip } from '../tooltip';
import { useRef, useState } from 'react';
import { Icon } from '../Icons';
import { Popover } from '../controls/Panel';
import { ColorPicker } from './ColorPicker';

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

/** Context-bar colour control: chip + chevron, opens a picker popover. */
export function ColorChipButton({ kind, label, color, enabled, onChange, onCommit, onToggle }: {
  kind: ChipTarget;
  label: string;
  color: string;
  enabled: boolean;
  onChange: (c: string) => void;
  onCommit?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button type="button" className={`chip-select${anchor ? ' open' : ''}`} aria-label={`${label} colour`} aria-haspopup="dialog" aria-expanded={!!anchor} data-tip={`${label}: ${enabled ? color.toUpperCase() : 'none'}`} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        <Chip kind={kind} color={color} enabled={enabled} />
        <Icon name="chevron-down" size={16} />
      </button>
      {anchor && (
        <Popover anchor={anchor} label={`${label} colour`} onClose={() => setAnchor(null)}>
          <ColorPopoverBody label={label} color={color} enabled={enabled} onChange={onChange} onCommit={onCommit} onToggle={onToggle} />
        </Popover>
      )}
    </>
  );
}

export function ColorPopoverBody({ label, color, enabled, onChange, onCommit, onToggle }: { label: string; color: string; enabled: boolean; onChange: (c: string) => void; onCommit?: () => void; onToggle?: (enabled: boolean) => void }) {
  return (
    <div className="color-popover">
      <div className="popover-head">
        <span className="popover-title">{label}</span>
        {onToggle && (
          <label className="check">
            <input type="checkbox" checked={!enabled} onChange={(e) => onToggle(!e.target.checked)} />
            None
          </label>
        )}
      </div>
      <ColorPicker value={color} onChange={(c) => { onChange(c); if (!enabled) onToggle?.(true); }} onCommit={onCommit} />
    </div>
  );
}
