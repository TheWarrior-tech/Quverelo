import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { editor, type ToolId } from '../state/editor';
import { visibleTool, type ToolGroup } from '../state/toolGroups';
import { useEditor } from './hooks';
import { Icon } from './Icons';
import { formatAccel, tip } from './tips';

const TOOL_LABELS: Record<ToolId, string> = {
  move: 'Move (V)', node: 'Node (A)', hand: 'Hand (H)', zoom: 'Zoom (Z)',
  'marquee-rect': 'Rectangle Marquee (M)', 'marquee-ellipse': 'Ellipse Marquee', lasso: 'Freehand Selection (L)', 'object-select': 'Object Select (W)',
  brush: 'Paint Brush (B)', eraser: 'Eraser (E)', fill: 'Flood Fill (G)', eyedropper: 'Colour Picker (I)', crop: 'Crop (C)',
  pen: 'Pen (P)', pencil: 'Pencil (N)', rect: 'Rectangle (M)', ellipse: 'Ellipse (E)', polygon: 'Polygon (Y)', star: 'Star (S)', line: 'Line (L)',
  text: 'Artistic Text (T)', textframe: 'Frame Text (X)', imageframe: 'Picture Frame (F)',
};

/** Second tooltip line: how to use the tool (≤ 60 characters, "Drag to … · Shift …"). */
export const TOOL_HINTS: Partial<Record<ToolId, string>> = {
  move: 'Click to select · Drag to move', node: 'Drag points and handles to reshape',
  hand: 'Drag to pan · Or hold Space', zoom: 'Click to zoom in · Alt-click to zoom out',
  'marquee-rect': 'Drag to select · Shift for a square', 'marquee-ellipse': 'Drag to select · Shift for a circle',
  lasso: 'Drag around an area to select it', 'object-select': 'Click an object to select it · Alt-click removes',
  crop: 'Drag the area to keep · Enter to apply',
  brush: 'Drag to paint · [ and ] change the size', eraser: 'Drag to erase pixels', fill: 'Click to fill an area of similar colour',
  eyedropper: 'Click to pick a colour', pen: 'Click for corners · Drag for curves', pencil: 'Drag to draw freehand',
  rect: 'Drag to draw · Shift for a square', ellipse: 'Drag to draw · Shift for a circle', polygon: 'Drag to draw · Shift to keep it upright',
  star: 'Drag to draw · Shift to keep it upright', line: 'Drag to draw · Shift snaps to 45°', text: 'Click to type a heading or label',
  textframe: 'Drag a box for flowing text', imageframe: 'Drag a frame, then place an image in it',
};

export function toolLabel(t: ToolId): string {
  return TOOL_LABELS[t];
}

/**
 * Tool name and its shortcut as an accelerator ('V', or 'Shift+M' for a
 * flyout member without a key of its own, which is reached by cycling).
 */
export function toolParts(t: ToolId, group?: ToolGroup | null): [string, string | undefined] {
  const m = /^(.*) \((.+)\)$/.exec(TOOL_LABELS[t]);
  if (m) return [m[1], m[2]];
  return [TOOL_LABELS[t], group ? `Shift+${group.key}` : undefined];
}

/** Hold this long on a group button to open its flyout. */
export const LONG_PRESS_MS = 350;

/**
 * A rail button standing in for a group of related tools (CRITIQUE #21).
 * Shows the active / last-used member with a 4px corner triangle. Click uses
 * the shown tool; right-click, long-press, →, Alt+↓, Shift+F10 or the context
 * menu key open the flyout.
 */
export function RailGroup({ group }: { group: ToolGroup }) {
  const ed = useEditor();
  const shown = visibleTool(group, ed.ui.tool, ed.ui.railTools);
  const active = group.tools.includes(ed.ui.tool);
  const [open, setOpen] = useState<null | 'pointer' | 'keyboard'>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const suppressClick = useRef(false);
  const menuId = useId();
  const [name, key] = toolParts(shown, group);

  const clearTimer = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => clearTimer, []);

  const close = (refocus: boolean) => {
    setOpen(null);
    if (refocus) btn.current?.focus();
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`icon-btn has-flyout ${active ? 'active' : ''}`}
        {...tip(name, key)}
        data-tip-hint={TOOL_HINTS[shown]}
        aria-pressed={active}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-controls={open ? menuId : undefined}
        data-tool={shown}
        data-group={group.id}
        data-group-tools={group.tools.join(' ')}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          suppressClick.current = false;
          clearTimer();
          timer.current = window.setTimeout(() => {
            timer.current = undefined;
            suppressClick.current = true;
            setOpen('pointer');
          }, LONG_PRESS_MS);
        }}
        onPointerUp={clearTimer}
        onPointerLeave={clearTimer}
        onPointerCancel={clearTimer}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (open) setOpen(null);
          ed.setTool(shown);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          clearTimer();
          setOpen(open ? null : 'pointer');
        }}
        onKeyDown={(e) => {
          const opens = e.key === 'ArrowRight' || e.key === 'ContextMenu' || (e.key === 'ArrowDown' && e.altKey) || (e.key === 'F10' && e.shiftKey);
          if (!opens) return;
          e.preventDefault();
          e.stopPropagation();
          setOpen('keyboard');
        }}
      >
        <Icon name={shown} />
        <span className="flyout-mark" aria-hidden="true" />
      </button>
      {open && btn.current && <ToolFlyout id={menuId} group={group} anchor={btn.current} checked={shown} fromPointer={open === 'pointer'} onClose={close} />}
    </>
  );
}

/**
 * The flyout menu: one menuitemradio per tool (icon, name, shortcut keycap),
 * the shown tool checked. ↑/↓/Home/End move, Enter/Space pick, a tool's own
 * letter picks it, Esc/←/Tab close and return focus to the rail button.
 * When opened by a long-press, releasing the pointer over an item picks it.
 */
function ToolFlyout({ id, group, anchor, checked, fromPointer, onClose }: { id: string; group: ToolGroup; anchor: HTMLElement; checked: ToolId; fromPointer: boolean; onClose: (refocus: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [focus, setFocus] = useState(() => Math.max(0, group.tools.indexOf(checked)));

  const pick = (t: ToolId) => {
    editor.setTool(t);
    onClose(true);
  };

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const el = ref.current;
    const w = el?.offsetWidth ?? 220;
    const h = el?.offsetHeight ?? 160;
    // 4px right of the rail button, first row level with it (menu has 4px padding)
    const left = Math.min(r.right + 4, window.innerWidth - w - 8);
    const top = Math.max(8, Math.min(r.top - 4, window.innerHeight - h - 8));
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    items.current[focus]?.focus();
  }, [focus, pos]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose(false);
    };
    const up = (e: PointerEvent) => {
      if (!fromPointer) return;
      // elementFromPoint, not e.target: touch pointers are implicitly captured by the rail button
      const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const item = hit?.closest('[data-flyout-tool]') as HTMLElement | null;
      if (item && ref.current?.contains(item)) pick(item.dataset.flyoutTool as ToolId);
    };
    const blur = () => onClose(false);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', blur);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', blur);
    };
  }, [anchor, fromPointer]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = group.tools.length;
    let handled = true;
    switch (e.key) {
      case 'ArrowDown': setFocus((focus + 1) % n); break;
      case 'ArrowUp': setFocus((focus - 1 + n) % n); break;
      case 'Home': setFocus(0); break;
      case 'End': setFocus(n - 1); break;
      case 'Escape':
      case 'ArrowLeft':
      case 'Tab':
        onClose(true);
        break;
      default: {
        // a tool's own shortcut letter picks it
        const t = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey ? group.tools.find((x) => toolParts(x)[1]?.toLowerCase() === e.key.toLowerCase()) : undefined;
        if (t) pick(t);
        else handled = e.key !== 'Enter' && e.key !== ' ';
      }
    }
    // keep every key away from the global tool/nudge shortcuts while the menu is open;
    // Enter/Space fall through to the focused item's native click
    e.stopPropagation();
    if (handled) e.preventDefault();
  };

  return createPortal(
    <div
      ref={ref}
      id={id}
      className="tool-flyout"
      role="menu"
      aria-label={group.label}
      aria-orientation="vertical"
      data-flyout={group.id}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}
    >
      {group.tools.map((t, i) => {
        const [name, key] = toolParts(t, group);
        const on = t === checked;
        return (
          <button
            key={t}
            ref={(el) => (items.current[i] = el)}
            type="button"
            role="menuitemradio"
            aria-checked={on}
            aria-keyshortcuts={key ? tip(name, key)['aria-keyshortcuts'] : undefined}
            tabIndex={i === focus ? 0 : -1}
            className={`flyout-item${on ? ' on' : ''}`}
            data-flyout-tool={t}
            onClick={() => pick(t)}
            onFocus={() => i !== focus && setFocus(i)}
          >
            <span className="flyout-check" aria-hidden="true">{on && <Icon name="check" size={16} />}</span>
            <Icon name={t} size={16} />
            <span className="flyout-name">{name}</span>
            {key && <kbd aria-hidden="true">{key.includes('+') ? formatAccel(key) : key}</kbd>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
