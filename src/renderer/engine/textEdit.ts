/**
 * In-place text editing.
 *
 * - Artistic text: a transparent textarea is laid exactly over the text using
 *   the node's screen matrix and shows the text itself (one style), so editing
 *   is WYSIWYG at any zoom or rotation.
 * - Text frames and table cells (Layout): text can mix character styles, so
 *   the canvas keeps drawing the real layout and the textarea is an invisible
 *   input sink holding the whole story. The caret and selection are drawn on
 *   the viewport overlay from the flow layout; clicks, drags and Up/Down/Home/
 *   End are mapped through the layout, so the caret goes exactly where the
 *   text is drawn and can travel through every linked frame.
 */
import { findNode, getContainer } from '../../core/document';
import { removeNodes, setStoryText, updateNode } from '../../core/commands';
import { caretX, indexAtX, lineHeightPx, type LaidOutLine } from '../../core/textflow';
import { applyCharProps, sheetOf, styleAt } from '../../core/typography';
import { applyCellCharProps, cellRect, cellStory, cellTextStyle, layoutCell, resolveCell, setCellText } from '../../core/tables';
import { composeTransform, invert, multiply, type Matrix } from '../../core/geometry';
import type { Id, Paint, SceneNode, Story, TextStyle } from '../../core/types';
import { artisticTextSize, cssFont, measureText, storyFlow } from './draw';
import type { Viewport } from './Viewport';

function paintColor(p: Paint): string {
  if (p.type === 'solid') return p.color;
  if (p.type === 'linear' || p.type === 'radial' || p.type === 'conical') return p.stops[0]?.color ?? '#000';
  return '#000';
}

type FrameNode = Extract<SceneNode, { type: 'textframe' }>;
type Mode = 'text' | 'frame' | 'cell';

interface Hit {
  frame: FrameNode;
  line: LaidOutLine | null;
  index: number;
}

export class TextEditOverlay {
  private ta: HTMLTextAreaElement | null = null;
  private nodeId: Id | null = null;
  private mode: Mode = 'text';
  private cell: { r: number; c: number } | null = null;
  private composing = false;
  private dragAnchor: number | null = null;
  private blinkOn = true;
  private blinkTimer: number | null = null;
  /** sticky x for Up/Down (frame-local of the caret's frame) */
  private goalX: number | null = null;
  /** character formatting chosen with a collapsed caret: applied to the next typed text */
  pendingProps: Partial<TextStyle> | null = null;
  private onSelChange = () => this.selectionChanged();
  /** last input modality: panel controls hand focus back to the text only after a pointer interaction */
  private pointerLast = false;
  private onModality = (e: Event) => (this.pointerLast = e.type === 'pointerdown');
  /**
   * Formatting from the inspector / context bar (data-keep-text-edit) keeps the
   * editing session; after a pointer click on a button or a pointer-chosen
   * select/checkbox, focus returns to the text so typing continues where the
   * caret was (as in InDesign / Affinity). Keyboard users keep focus in the panel.
   */
  private onPanelCommit = (e: Event) => {
    const ta = this.ta;
    const t = e.target as HTMLElement | null;
    if (!ta || !t || !t.closest('[data-keep-text-edit]') || t.closest('.text-edit-overlay')) return;
    if (e.type === 'click') {
      const btn = t.closest('button');
      if (!btn || (e as MouseEvent).detail === 0 || btn.hasAttribute('aria-haspopup')) return;
    } else {
      const el = t as HTMLInputElement;
      const pickable = el.tagName === 'SELECT' || (el.tagName === 'INPUT' && ['checkbox', 'radio'].includes(el.type));
      if (!pickable || !this.pointerLast) return;
    }
    window.setTimeout(() => {
      if (this.ta !== ta) return;
      const a = document.activeElement as HTMLElement | null;
      // a control that opened a popover / text field keeps focus
      if (a && a !== document.body && a.closest('.popover, input[type="text"], input:not([type])') && !a.closest('.more-type-options')) return;
      const { selectionStart: s0, selectionEnd: s1, selectionDirection: dir } = ta;
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(s0, s1, dir);
    }, 0);
  };
  /** focus leaving the panel controls for anything outside the session ends it */
  private onFocusOut = (e: FocusEvent) => {
    const from = e.target as HTMLElement | null;
    if (!this.ta || !from?.closest?.('[data-keep-text-edit]')) return;
    window.setTimeout(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!this.ta || a === this.ta || a?.closest('[data-keep-text-edit]')) return;
      if (!a || a === document.body) return; // clicks on panel chrome without focus targets keep the session
      this.end();
    }, 120);
  };

  constructor(private vp: Viewport) {}

  get active(): boolean {
    return !!this.ta;
  }

  /** Rich (layout) editing: the canvas keeps drawing the frame / cell and the caret comes from the layout. */
  get rich(): boolean {
    return !!this.ta && this.isRich();
  }

  private isRich(): boolean {
    return this.mode === 'frame' || this.mode === 'cell';
  }

  get editingCell(): { r: number; c: number } | null {
    return this.mode === 'cell' ? this.cell : null;
  }

  /** Start editing a text node, text frame, or (with `cell`) a table cell. `at` is a scene point to put the caret at. */
  begin(id: Id, caret: 'end' | 'all' = 'end', at?: { x: number; y: number } | null, cell?: { r: number; c: number }): void {
    const ed = this.vp.editor;
    const doc = ed.doc;
    if (!doc) return;
    const loc = findNode(doc, id);
    if (!loc || !['text', 'textframe', 'table'].includes(loc.node.type)) return;
    if (loc.node.type === 'table' && !cell) return;
    if (this.nodeId && (this.nodeId !== id || this.mode === 'cell')) this.end(false);
    this.nodeId = id;
    this.mode = loc.node.type === 'textframe' ? 'frame' : loc.node.type === 'table' ? 'cell' : 'text';
    this.cell = cell ?? null;
    const ta = this.ta ?? document.createElement('textarea');
    ta.className = `text-edit-overlay${this.isRich() ? ' rich' : ''}`;
    ta.spellcheck = true;
    ta.setAttribute('aria-label', this.mode === 'cell' ? 'Edit table cell' : 'Edit text');
    if (!this.ta) {
      ta.addEventListener('input', () => !this.composing && this.onInput());
      ta.addEventListener('compositionstart', () => (this.composing = true));
      ta.addEventListener('compositionend', () => {
        this.composing = false;
        this.onInput();
      });
      ta.addEventListener('keydown', (e) => this.onKey(e));
      ta.addEventListener('pointerdown', (e) => this.onPointerDown(e));
      ta.addEventListener('pointermove', (e) => this.onPointerMove(e));
      ta.addEventListener('pointerup', (e) => {
        this.dragAnchor = null;
        try {
          ta.releasePointerCapture(e.pointerId);
        } catch {
          /* not captured */
        }
      });
      ta.addEventListener('dblclick', (e) => this.isRich() && this.selectWordAt(e));
      ta.addEventListener('click', (e) => {
        if (!this.isRich() || e.detail < 3 || !this.ta) return;
        // triple click: the paragraph
        const p = this.scenePoint(e);
        const h = this.hitScene(p.x, p.y);
        if (!h) return;
        const text = this.ta.value;
        const a = text.lastIndexOf('\n', h.index - 1) + 1;
        let b = text.indexOf('\n', h.index);
        if (b < 0) b = text.length;
        this.ta.setSelectionRange(a, b);
        this.selectionChanged();
      });
      ta.addEventListener('blur', (e) => {
        // focus moving to formatting controls (font pickers, styles panel) keeps the session;
        // onFocusOut follows focus from there (a control re-rendered away leaves focus on <body>)
        const to = e.relatedTarget as HTMLElement | null;
        if (to?.closest?.('[data-keep-text-edit]')) return;
        window.setTimeout(() => {
          if (this.ta && document.activeElement !== this.ta && !document.activeElement?.closest('[data-keep-text-edit]')) this.end();
        }, 120);
      });
      document.addEventListener('selectionchange', this.onSelChange);
      document.addEventListener('pointerdown', this.onModality, true);
      document.addEventListener('keydown', this.onModality, true);
      document.addEventListener('click', this.onPanelCommit);
      document.addEventListener('change', this.onPanelCommit);
      document.addEventListener('focusout', this.onFocusOut);
      this.vp.host.appendChild(ta);
      this.ta = ta;
    }
    ed.select([id]);
    ed.setUi({ editingTextId: id, tableCell: this.mode === 'cell' && cell ? { nodeId: id, r: cell.r, c: cell.c } : ed.ui.tableCell?.nodeId === id ? ed.ui.tableCell : null });
    this.vp.discardActiveQuietly();
    this.loadValue();
    this.position();
    let start = ta.value.length;
    if (this.isRich() && at) {
      const h = this.hitScene(at.x, at.y);
      if (h) start = h.index;
    }
    const focus = () => {
      if (this.ta !== ta) return;
      ta.focus();
      if (caret === 'all') ta.select();
      else if (document.activeElement === ta && ta.selectionStart === ta.selectionEnd && ta.selectionStart === start) return;
      else ta.setSelectionRange(start, start);
      this.selectionChanged();
    };
    focus();
    // a mousedown on the canvas moves focus after this handler runs; focus again afterwards
    window.setTimeout(focus, 0);
    this.startBlink();
  }

  private loadValue(): void {
    const doc = this.vp.editor.doc!;
    const n = this.node();
    if (!n || !this.ta) return;
    if (n.type === 'text') this.ta.value = n.text;
    else if (n.type === 'textframe') this.ta.value = doc.stories[n.storyId]?.text ?? '';
    else if (n.type === 'table' && this.cell) this.ta.value = n.cells[this.cell.r]?.[this.cell.c]?.text ?? '';
  }

  private node(): SceneNode | null {
    const doc = this.vp.editor.doc;
    if (!doc || !this.nodeId) return null;
    return findNode(doc, this.nodeId)?.node ?? null;
  }

  private story(): Story | null {
    const n = this.node();
    return n?.type === 'textframe' ? this.vp.editor.doc!.stories[n.storyId] ?? null : null;
  }

  private onInput(): void {
    const ed = this.vp.editor;
    const n = this.node();
    if (!n || !this.ta) return;
    const value = this.ta.value;
    if (n.type === 'text') {
      ed.commit('Type text', (d) => updateNode(d, n.id, { text: value } as Partial<SceneNode>), 'type:' + n.id);
    } else if (n.type === 'textframe') {
      const story = ed.doc!.stories[n.storyId];
      if (!story) return;
      const before = story.text;
      const pending = this.pendingProps;
      ed.commit('Type text', (d) => {
        let out = setStoryText(d, n.storyId, value);
        if (pending && value.length > before.length) {
          // the inserted range: caret end minus inserted length
          const end = this.ta?.selectionEnd ?? value.length;
          const start = Math.max(0, end - (value.length - before.length));
          out = { ...out, stories: { ...out.stories, [n.storyId]: applyCharProps(out.stories[n.storyId], start, end, pending) } };
        }
        return out;
      }, 'type:' + n.storyId);
      if (pending && value.length > before.length) this.pendingProps = null;
      this.goalX = null;
      this.followCaret();
    } else if (n.type === 'table' && this.cell) {
      const { r, c } = this.cell;
      const before = n.cells[r]?.[c]?.text ?? '';
      const pending = this.pendingProps;
      const grew = value.length > before.length;
      ed.commit('Type in cell', (d) => updateNode(d, n.id, (x: SceneNode) => {
        if (x.type !== 'table') return x;
        let t = setCellText(x, r, c, value);
        if (pending && grew) {
          const end = this.ta?.selectionEnd ?? value.length;
          t = applyCellCharProps(t, r, c, Math.max(0, end - (value.length - before.length)), end, pending);
        }
        return t;
      }), `cell:${n.id}:${r}:${c}`);
      if (pending && grew) this.pendingProps = null;
      this.goalX = null;
      this.followCaret();
    }
    this.position();
    this.selectionChanged();
  }

  /** Reposition and restyle (called on every viewport sync). */
  sync(): void {
    if (!this.ta || !this.nodeId) return;
    const n = this.node();
    if (!n || this.vp.editor.ui.editingTextId !== this.nodeId) {
      this.end(false);
      return;
    }
    // the story may have changed underneath (undo, styles panel): keep the textarea in step
    if (this.isRich()) {
      const s = this.richStory();
      if (s && this.ta.value !== s.text && !this.composing) {
        const a = Math.min(this.ta.selectionStart, s.text.length);
        const b = Math.min(this.ta.selectionEnd, s.text.length);
        this.ta.value = s.text;
        this.ta.setSelectionRange(a, b);
      }
    }
    this.position();
  }

  private position(): void {
    const ta = this.ta;
    const n = this.node();
    if (!ta || !n) return;
    const m = this.vp.screenMatrixFor(n.id);
    if (!m) return;
    let style: TextStyle;
    let x: number;
    let y: number;
    let w: number;
    let h: number;
    let pad = 0;
    if (n.type === 'text') {
      style = n.style;
      const size = artisticTextSize(ta.value || ' ', style);
      w = Math.max(size.w + style.fontSize, style.fontSize * 2);
      h = size.h + 2;
      x = style.align === 'center' ? -w / 2 : style.align === 'right' ? size.w / 2 - w : -size.w / 2;
      y = -size.h / 2;
      ta.style.whiteSpace = 'pre';
    } else if (n.type === 'textframe') {
      // invisible input sink over the whole frame (pointer events map through the layout)
      const doc = this.vp.editor.doc!;
      style = doc.stories[n.storyId]?.style ?? ({} as TextStyle);
      w = n.w;
      h = n.h;
      x = -n.w / 2;
      y = -n.h / 2;
      ta.style.whiteSpace = 'pre-wrap';
    } else if (n.type === 'table' && this.cell) {
      const props = resolveCell(n, sheetOf(this.vp.editor.doc!), this.cell.r, this.cell.c);
      style = cellTextStyle(props);
      const rc = cellRect(n, this.cell.r, this.cell.c);
      w = rc.w;
      h = rc.h;
      x = -n.w / 2 + rc.x;
      y = -n.h / 2 + rc.y;
      pad = props.padding;
      ta.style.whiteSpace = 'pre-wrap';
    } else return;
    const lh = lineHeightPx(style);
    ta.style.font = cssFont(style);
    ta.style.lineHeight = `${lh}px`;
    ta.style.letterSpacing = `${(style.letterSpacing / 1000) * style.fontSize}px`;
    ta.style.textAlign = style.align;
    ta.style.fontKerning = style.kerning === false ? 'none' : 'normal';
    ta.style.fontVariantCaps = style.caps ?? 'normal';
    ta.style.textDecoration = style.underline ? 'underline' : 'none';
    if (this.isRich()) {
      ta.style.color = 'transparent';
      ta.style.caretColor = 'transparent';
    } else {
      ta.style.color = paintColor(style.fill);
      ta.style.caretColor = paintColor(style.fill) === '#ffffff' ? '#ffffff' : '#2fb8a6';
    }
    ta.style.width = `${w}px`;
    ta.style.height = `${h}px`;
    ta.style.padding = `${pad}px`;
    const t = [m[0], m[1], m[2], m[3], m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    ta.style.transform = `matrix(${t.join(',')})`;
  }

  // -------------------------------------------------------------------------
  // Rich (frame) editing: hit testing, caret geometry, keyboard

  /** Frames of the edited story with their scene matrices (frame-local origin = top-left). */
  private frames(): { frame: FrameNode; m: Matrix; inView: boolean }[] {
    const ed = this.vp.editor;
    const doc = ed.doc;
    if (this.mode === 'cell') return this.cellFrame();
    const story = this.story();
    if (!doc || !story) return [];
    const active = ed.ui.activeContainerId;
    const out: { frame: FrameNode; m: Matrix; inView: boolean }[] = [];
    for (const id of story.chain) {
      const loc = findNode(doc, id);
      if (!loc || loc.node.type !== 'textframe') continue;
      let m: Matrix = [1, 0, 0, 1, 0, 0];
      for (const g of loc.ancestors) m = multiply(m, composeTransform(g));
      m = multiply(m, composeTransform(loc.node));
      m = multiply(m, [1, 0, 0, 1, -loc.node.w / 2, -loc.node.h / 2]);
      out.push({ frame: loc.node, m, inView: loc.container.id === active });
    }
    return out;
  }

  /** The edited cell as a one-frame "chain" (cell-local origin = its top-left corner). */
  private cellFrame(): { frame: FrameNode; m: Matrix; inView: boolean }[] {
    const doc = this.vp.editor.doc;
    if (!doc || !this.cell || !this.nodeId) return [];
    const loc = findNode(doc, this.nodeId);
    if (!loc || loc.node.type !== 'table') return [];
    const t = loc.node;
    const rc = cellRect(t, this.cell.r, this.cell.c);
    const props = resolveCell(t, sheetOf(doc), this.cell.r, this.cell.c);
    let m: Matrix = [1, 0, 0, 1, 0, 0];
    for (const g of loc.ancestors) m = multiply(m, composeTransform(g));
    m = multiply(m, composeTransform(t));
    m = multiply(m, [1, 0, 0, 1, -t.w / 2 + rc.x, -t.h / 2 + rc.y]);
    const frame = { id: 'cell', type: 'textframe', w: rc.w, h: rc.h, padding: props.padding } as unknown as FrameNode;
    return [{ frame, m, inView: loc.container.id === this.vp.editor.ui.activeContainerId }];
  }

  /** The text being edited richly: the frame's story, or the cell's text as a story. */
  private richStory(): Story | null {
    if (this.mode === 'frame') return this.story();
    const n = this.node();
    if (this.mode !== 'cell' || !n || n.type !== 'table' || !this.cell || !n.cells[this.cell.r]?.[this.cell.c]) return null;
    return cellStory(n, sheetOf(this.vp.editor.doc!), this.cell.r, this.cell.c);
  }

  private flow() {
    if (this.mode === 'cell') {
      const n = this.node();
      if (!n || n.type !== 'table' || !this.cell || !n.cells[this.cell.r]?.[this.cell.c]) return null;
      return layoutCell(n, sheetOf(this.vp.editor.doc!), this.cell.r, this.cell.c, measureText).flow;
    }
    const s = this.story();
    const doc = this.vp.editor.doc;
    if (!s || !doc) return null;
    const pi = this.vp.editor.activePageIndex;
    return storyFlow(doc, s.id, pi >= 0 ? pi : undefined);
  }

  /** Story index under a scene point (nearest line of the nearest visible frame). */
  hitScene(sx: number, sy: number): Hit | null {
    const flow = this.flow();
    if (!flow) return null;
    let best: (Hit & { d: number }) | null = null;
    for (const { frame, m, inView } of this.frames()) {
      if (!inView) continue;
      const inv = invert(m);
      const x = inv[0] * sx + inv[2] * sy + inv[4];
      const y = inv[1] * sx + inv[3] * sy + inv[5];
      const lay = flow.frames[frame.id];
      if (!lay) continue;
      const inside = x >= 0 && y >= 0 && x <= frame.w && y <= frame.h;
      const dFrame = inside ? 0 : Math.hypot(Math.max(0, -x, x - frame.w), Math.max(0, -y, y - frame.h));
      if (!lay.lines.length) {
        const cand = { frame, line: null, index: lay.start, d: dFrame + 1 };
        if (!best || cand.d < best.d) best = cand;
        continue;
      }
      // the line band containing y (or nearest), then x within it
      let line = lay.lines[0];
      let ld = Infinity;
      for (const l of lay.lines) {
        const top = l.y;
        const bot = l.y + (l.height ?? 0);
        const d = y < top ? top - y : y > bot ? y - bot : 0;
        const dx = x < l.x ? l.x - x : x > l.x + Math.max(l.width, 1) ? x - l.x - l.width : 0;
        const score = d * 1000 + (d === 0 ? dx : 0);
        if (score < ld) {
          ld = score;
          line = l;
        }
      }
      const index = indexAtX(line, x, measureText);
      const cand = { frame, line, index, d: dFrame };
      if (!best || cand.d < best.d) best = cand;
    }
    return best;
  }

  /** Line holding a story index (and its frame), preferring the line that starts at it. */
  private locate(index: number): { frame: FrameNode; m: Matrix; line: LaidOutLine; inView: boolean } | null {
    const flow = this.flow();
    if (!flow) return null;
    let fallback: { frame: FrameNode; m: Matrix; line: LaidOutLine; inView: boolean } | null = null;
    for (const f of this.frames()) {
      const lay = flow.frames[f.frame.id];
      if (!lay) continue;
      for (let i = 0; i < lay.lines.length; i++) {
        const l = lay.lines[i];
        const next = lay.lines[i + 1];
        if (index >= l.start && index <= l.end) {
          // at a soft wrap the caret belongs to the start of the next line
          if (index === l.end && next && next.start === index && !l.paragraphEnd) continue;
          return { ...f, line: l };
        }
        if (index < l.start && !fallback) return { ...f, line: l };
        fallback = { ...f, line: l };
      }
    }
    return fallback;
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.isRich() || !this.ta) return;
    if (e.button !== 0) return;
    e.preventDefault();
    this.ta.focus();
    const p = this.scenePoint(e);
    const h = this.hitScene(p.x, p.y);
    if (!h) return;
    if (e.shiftKey) {
      const anchor = this.ta.selectionDirection === 'backward' ? this.ta.selectionEnd : this.ta.selectionStart;
      this.setRange(anchor, h.index);
    } else {
      this.ta.setSelectionRange(h.index, h.index);
      this.dragAnchor = h.index;
      this.ta.setPointerCapture(e.pointerId);
    }
    this.goalX = null;
    this.selectionChanged();
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isRich() || this.dragAnchor === null || !this.ta || !(e.buttons & 1)) return;
    const p = this.scenePoint(e);
    const h = this.hitScene(p.x, p.y);
    if (h) this.setRange(this.dragAnchor, h.index);
  }

  private selectWordAt(e: MouseEvent): void {
    if (!this.ta) return;
    const p = this.scenePoint(e);
    const h = this.hitScene(p.x, p.y);
    if (!h) return;
    const t = this.ta.value;
    let a = h.index;
    let b = h.index;
    while (a > 0 && /[\p{L}\p{N}'’_-]/u.test(t[a - 1])) a--;
    while (b < t.length && /[\p{L}\p{N}'’_-]/u.test(t[b])) b++;
    this.ta.setSelectionRange(a, b);
    this.selectionChanged();
  }

  private setRange(anchor: number, focus: number): void {
    if (!this.ta) return;
    if (focus >= anchor) this.ta.setSelectionRange(anchor, focus, 'forward');
    else this.ta.setSelectionRange(focus, anchor, 'backward');
    this.selectionChanged();
  }

  private scenePoint(e: MouseEvent): { x: number; y: number } {
    const r = this.vp.host.getBoundingClientRect();
    const v = this.vp.vpt;
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const inv = invert(v);
    return { x: inv[0] * sx + inv[2] * sy + inv[4], y: inv[1] * sx + inv[3] * sy + inv[5] };
  }

  private onKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      this.end();
      return;
    }
    if (this.mode === 'cell' && e.key === 'Tab') {
      e.preventDefault();
      this.moveCell(e.shiftKey ? -1 : 1);
      return;
    }
    if (this.mode === 'frame' && e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      // a tab character moves the text to the next tab stop (Esc leaves the frame)
      e.preventDefault();
      this.insert('\t');
      return;
    }
    if (!this.isRich() || !this.ta) return;
    const ta = this.ta;
    const focus = ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd;
    const anchor = ta.selectionDirection === 'backward' ? ta.selectionEnd : ta.selectionStart;
    const move = (to: number) => {
      e.preventDefault();
      if (e.shiftKey) this.setRange(anchor, to);
      else {
        ta.setSelectionRange(to, to);
        this.selectionChanged();
      }
    };
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const loc = this.locate(focus);
      const flow = this.flow();
      if (!loc || !flow) return;
      const x = this.goalX ?? caretX(loc.line, focus, measureText);
      this.goalX = x;
      const all: { line: LaidOutLine; frame: FrameNode }[] = [];
      for (const f of this.frames()) for (const l of flow.frames[f.frame.id]?.lines ?? []) all.push({ line: l, frame: f.frame });
      const i = all.findIndex((a) => a.line === loc.line);
      const j = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (j < 0) return move(0);
      if (j >= all.length) return move(ta.value.length);
      const keep = this.goalX;
      move(indexAtX(all[j].line, x, measureText));
      this.goalX = keep;
      return;
    }
    if ((e.key === 'Home' || e.key === 'End') && !e.ctrlKey && !e.metaKey) {
      const loc = this.locate(focus);
      if (!loc) return;
      move(e.key === 'Home' ? loc.line.start : loc.line.end);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') this.goalX = null;
  }

  private moveCell(d: number): void {
    const n = this.node();
    if (!n || n.type !== 'table' || !this.cell) return;
    const cols = n.colWidths.length;
    const total = n.rowHeights.length * cols;
    let i = this.cell.r * cols + this.cell.c;
    for (let k = 0; k < total; k++) {
      i = (i + d + total) % total;
      const r = Math.floor(i / cols);
      const c = i % cols;
      const cell = n.cells[r][c];
      // skip cells covered by a merge
      let covered = false;
      for (let rr = 0; rr <= r && !covered; rr++) for (let cc = 0; cc <= c; cc++) {
        const a = n.cells[rr][cc];
        if ((rr !== r || cc !== c) && r < rr + (a.rowSpan ?? 1) && c < cc + (a.colSpan ?? 1) && ((a.rowSpan ?? 1) > 1 || (a.colSpan ?? 1) > 1)) covered = true;
      }
      if (!covered && cell) {
        this.begin(n.id, 'all', null, { r, c });
        return;
      }
    }
  }

  /** Selection (story indices) changed: publish it for the inspector and redraw the caret. */
  private selectionChanged(): void {
    if (!this.ta || !this.isRich()) return;
    const s = this.richStory();
    if (!s) return;
    const start = this.ta.selectionStart;
    const end = this.ta.selectionEnd;
    const cur = this.vp.editor.ui.textSel;
    if (!cur || cur.storyId !== s.id || cur.start !== start || cur.end !== end) {
      if (cur && (cur.start !== start || cur.end !== end)) this.pendingProps = null;
      this.vp.editor.setUi({ textSel: { storyId: s.id, start, end } });
    }
    this.blinkOn = true;
    this.followCaret();
    this.vp.drawOverlay();
  }

  /** Keep the (invisible) textarea's caret near the drawn caret so IME popups appear in the right place. */
  private followCaret(): void {
    if (!this.isRich() || !this.ta) return;
    const loc = this.locate(this.ta.selectionEnd);
    if (!loc) return;
    const doc = this.vp.editor.doc!;
    const story = this.richStory();
    if (!story) return;
    const st = styleAt(story, sheetOf(doc), Math.max(0, this.ta.selectionEnd - 1));
    this.ta.style.fontSize = `${st.fontSize}px`;
  }

  /** Caret / selection chrome on the viewport overlay (scene-space context). */
  drawChrome(ctx: CanvasRenderingContext2D, px: number): void {
    if (!this.isRich() || !this.ta) return;
    const flow = this.flow();
    if (!flow) return;
    const a = this.ta.selectionStart;
    const b = this.ta.selectionEnd;
    const frames = this.frames();
    ctx.save();
    for (const f of frames) {
      if (!f.inView) continue;
      const lay = flow.frames[f.frame.id];
      ctx.save();
      ctx.transform(f.m[0], f.m[1], f.m[2], f.m[3], f.m[4], f.m[5]);
      // frame outline while editing (a cell already has its selection outline)
      if (this.mode === 'frame') {
        ctx.strokeStyle = 'rgba(47,184,166,0.9)';
        ctx.lineWidth = px;
        ctx.setLineDash([4 * px, 3 * px]);
        ctx.strokeRect(0, 0, f.frame.w, f.frame.h);
        ctx.setLineDash([]);
      }
      if (lay && a !== b) {
        ctx.fillStyle = 'rgba(47,184,166,0.28)';
        for (const l of lay.lines) {
          const s = Math.max(a, l.start);
          const e = Math.min(b, l.end);
          const nl = l.paragraphEnd && b > l.end && a <= l.end;
          if (s > e || (s === e && !nl)) continue;
          const x0 = caretX(l, s, measureText);
          const x1 = caretX(l, e, measureText) + (nl ? Math.max(4, (l.height ?? 10) * 0.25) : 0);
          ctx.fillRect(x0, l.y, Math.max(x1 - x0, 1 * px), l.height ?? 10);
        }
      }
      ctx.restore();
    }
    if (a === b && this.blinkOn) {
      const loc = this.locate(b);
      if (loc && loc.inView) {
        ctx.save();
        ctx.transform(loc.m[0], loc.m[1], loc.m[2], loc.m[3], loc.m[4], loc.m[5]);
        const x = caretX(loc.line, b, measureText);
        ctx.fillStyle = '#2fb8a6';
        ctx.fillRect(x - px, loc.line.y, 2 * px, loc.line.height ?? 12);
        ctx.restore();
      } else if (!loc) {
        // empty story: caret at the first frame's content origin
        const f = frames.find((x) => x.inView);
        if (f) {
          const story = this.richStory();
          const st = story ? story.style : null;
          ctx.save();
          ctx.transform(f.m[0], f.m[1], f.m[2], f.m[3], f.m[4], f.m[5]);
          ctx.fillStyle = '#2fb8a6';
          const h = st ? lineHeightPx(st) : 16;
          ctx.fillRect(f.frame.padding - px, f.frame.padding, 2 * px, h);
          ctx.restore();
        }
      }
    }
    ctx.restore();
  }

  private startBlink(): void {
    if (this.blinkTimer !== null) return;
    this.blinkTimer = window.setInterval(() => {
      if (!this.ta || !this.isRich()) return;
      if (this.ta.selectionStart !== this.ta.selectionEnd) return;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        if (!this.blinkOn) {
          this.blinkOn = true;
          this.vp.drawOverlay();
        }
        return;
      }
      this.blinkOn = !this.blinkOn;
      this.vp.drawOverlay();
    }, 530);
  }

  /** Current selection in story indices while editing a frame (null otherwise). */
  selection(): { storyId: Id; start: number; end: number } | null {
    const s = this.richStory();
    if (!s || !this.ta || !this.isRich()) return null;
    return { storyId: s.id, start: this.ta.selectionStart, end: this.ta.selectionEnd };
  }

  /** Select a story range programmatically (tests, find). */
  select(start: number, end: number): void {
    if (!this.ta) return;
    this.ta.focus();
    this.ta.setSelectionRange(start, end);
    this.selectionChanged();
  }

  /** Insert text at the caret (e.g. a page-number field). */
  insert(text: string): void {
    const ta = this.ta;
    if (!ta) return;
    ta.focus();
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    this.onInput();
  }

  end(clearUi = true): void {
    const ed = this.vp.editor;
    const id = this.nodeId;
    const mode = this.mode;
    this.nodeId = null;
    this.cell = null;
    this.dragAnchor = null;
    this.pendingProps = null;
    if (this.blinkTimer !== null) {
      window.clearInterval(this.blinkTimer);
      this.blinkTimer = null;
    }
    if (this.ta) {
      const ta = this.ta;
      this.ta = null;
      ta.remove();
      document.removeEventListener('selectionchange', this.onSelChange);
      document.removeEventListener('pointerdown', this.onModality, true);
      document.removeEventListener('keydown', this.onModality, true);
      document.removeEventListener('click', this.onPanelCommit);
      document.removeEventListener('change', this.onPanelCommit);
      document.removeEventListener('focusout', this.onFocusOut);
    }
    if (id && mode === 'text') {
      const n = ed.doc ? findNode(ed.doc, id)?.node : null;
      if (n && n.type === 'text' && !n.text.trim()) {
        ed.commit('Delete empty text', (d) => removeNodes(d, [id]));
      }
    }
    if (clearUi && (ed.ui.editingTextId || ed.ui.textSel)) ed.setUi({ editingTextId: null, textSel: null });
    this.vp.render();
    this.vp.drawOverlay();
  }

  destroy(): void {
    this.end(false);
  }
}

/** Whether a container is shown in the viewport (for callers outside the overlay). */
export function containerShown(vp: Viewport, id: Id): boolean {
  const doc = vp.editor.doc;
  return !!doc && !!getContainer(doc, id) && vp.editor.ui.activeContainerId === id;
}
