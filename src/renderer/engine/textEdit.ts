/**
 * In-place text editing. A transparent textarea is laid exactly over the text
 * node (or the visible slice of a linked story inside a text frame) using the
 * node's screen matrix, so editing is WYSIWYG at any zoom or rotation.
 */
import { findNode } from '../../core/document';
import { removeNodes, setStoryText, updateNode } from '../../core/commands';
import { lineHeightPx } from '../../core/textflow';
import type { Id, Paint, SceneNode, TextStyle } from '../../core/types';
import { artisticTextSize, cssFont, storyFlow } from './draw';
import type { Viewport } from './Viewport';

function paintColor(p: Paint): string {
  if (p.type === 'solid') return p.color;
  if (p.type === 'linear' || p.type === 'radial') return p.stops[0]?.color ?? '#000';
  return '#000';
}

export class TextEditOverlay {
  private ta: HTMLTextAreaElement | null = null;
  private nodeId: Id | null = null;
  /** for frames: slice of the story shown in this frame */
  private sliceStart = 0;
  private sliceEnd = 0;
  private composing = false;

  constructor(private vp: Viewport) {}

  get active(): boolean {
    return !!this.ta;
  }

  begin(id: Id, caret: 'end' | 'all' = 'end'): void {
    const ed = this.vp.editor;
    const doc = ed.doc;
    if (!doc) return;
    const loc = findNode(doc, id);
    if (!loc || (loc.node.type !== 'text' && loc.node.type !== 'textframe')) return;
    if (this.nodeId && this.nodeId !== id) this.end();
    this.nodeId = id;
    const ta = this.ta ?? document.createElement('textarea');
    ta.className = 'text-edit-overlay';
    ta.spellcheck = true;
    ta.setAttribute('aria-label', 'Edit text');
    if (!this.ta) {
      ta.addEventListener('input', () => !this.composing && this.onInput());
      ta.addEventListener('compositionstart', () => (this.composing = true));
      ta.addEventListener('compositionend', () => {
        this.composing = false;
        this.onInput();
      });
      ta.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          this.end();
        }
      });
      ta.addEventListener('blur', () => {
        // allow toolbar interactions (font pickers) to keep the session alive briefly
        window.setTimeout(() => {
          if (this.ta && document.activeElement !== this.ta && !document.activeElement?.closest('[data-keep-text-edit]')) this.end();
        }, 120);
      });
      this.vp.host.appendChild(ta);
      this.ta = ta;
    }
    ed.select([id]);
    ed.setUi({ editingTextId: id });
    this.vp.canvas.discardActiveObject();
    this.loadValue();
    this.position();
    const focus = () => {
      if (this.ta !== ta) return;
      ta.focus();
      if (caret === 'all') ta.select();
      else ta.setSelectionRange(ta.value.length, ta.value.length);
    };
    focus();
    // a mousedown on the canvas moves focus after this handler runs; focus again afterwards
    window.setTimeout(focus, 0);
  }

  private loadValue(): void {
    const doc = this.vp.editor.doc!;
    const n = this.node();
    if (!n || !this.ta) return;
    if (n.type === 'text') {
      this.ta.value = n.text;
    } else if (n.type === 'textframe') {
      const story = doc.stories[n.storyId];
      const flow = storyFlow(doc, n.storyId);
      const layout = flow?.frames[n.id];
      const isLast = story?.chain[story.chain.length - 1] === n.id;
      this.sliceStart = layout?.start ?? 0;
      this.sliceEnd = isLast ? (story?.text.length ?? 0) : layout?.end ?? 0;
      this.ta.value = story ? story.text.slice(this.sliceStart, this.sliceEnd) : '';
    }
  }

  private node(): SceneNode | null {
    const doc = this.vp.editor.doc;
    if (!doc || !this.nodeId) return null;
    return findNode(doc, this.nodeId)?.node ?? null;
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
      const text = story.text.slice(0, this.sliceStart) + value + story.text.slice(this.sliceEnd);
      ed.commit('Type text', (d) => setStoryText(d, n.storyId, text), 'type:' + n.id);
      // keep the textarea mirroring exactly what this frame shows
      const flow = storyFlow(ed.doc!, n.storyId);
      const layout = flow?.frames[n.id];
      const isLast = story.chain[story.chain.length - 1] === n.id;
      const newEnd = isLast ? text.length : layout?.end ?? text.length;
      const caret = this.ta.selectionStart;
      const visible = text.slice(this.sliceStart, newEnd);
      this.sliceEnd = newEnd;
      if (visible !== value) {
        const idx = story.chain.indexOf(n.id);
        if (caret > visible.length && idx >= 0 && idx < story.chain.length - 1) {
          // caret moved into the next frame: continue editing there
          const nextId = story.chain[idx + 1];
          const offset = caret - visible.length;
          this.end(false);
          this.begin(nextId);
          this.ta?.setSelectionRange(offset, offset);
          return;
        }
        this.ta.value = visible;
        this.ta.setSelectionRange(Math.min(caret, visible.length), Math.min(caret, visible.length));
      }
    }
    this.position();
  }

  /** Reposition and restyle (called on every viewport sync). */
  sync(): void {
    if (!this.ta || !this.nodeId) return;
    const n = this.node();
    if (!n || this.vp.editor.ui.editingTextId !== this.nodeId) {
      this.end(false);
      return;
    }
    this.position();
  }

  private position(): void {
    const ta = this.ta;
    const n = this.node();
    if (!ta || !n) return;
    const doc = this.vp.editor.doc!;
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
      style = doc.stories[n.storyId]?.style ?? ({} as TextStyle);
      w = n.w;
      h = n.h;
      x = -n.w / 2;
      y = -n.h / 2;
      pad = n.padding;
      ta.style.whiteSpace = 'pre-wrap';
    } else return;
    const lh = lineHeightPx(style);
    ta.style.font = cssFont(style);
    ta.style.lineHeight = `${lh}px`;
    ta.style.letterSpacing = `${(style.letterSpacing / 1000) * style.fontSize}px`;
    ta.style.textAlign = style.align;
    ta.style.textDecoration = style.underline ? 'underline' : 'none';
    ta.style.color = paintColor(style.fill);
    ta.style.caretColor = paintColor(style.fill) === '#ffffff' ? '#ffffff' : '#2fb8a6';
    ta.style.width = `${w}px`;
    ta.style.height = `${h}px`;
    ta.style.padding = `${pad}px`;
    const t = [m[0], m[1], m[2], m[3], m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    ta.style.transform = `matrix(${t.join(',')})`;
  }

  end(clearUi = true): void {
    const ed = this.vp.editor;
    const id = this.nodeId;
    this.nodeId = null;
    if (this.ta) {
      const ta = this.ta;
      this.ta = null;
      ta.remove();
    }
    if (id) {
      const n = ed.doc ? findNode(ed.doc, id)?.node : null;
      if (n && n.type === 'text' && !n.text.trim()) {
        ed.commit('Delete empty text', (d) => removeNodes(d, [id]));
      }
    }
    if (clearUi && ed.ui.editingTextId) ed.setUi({ editingTextId: null });
    this.vp.render();
  }

  destroy(): void {
    this.end(false);
  }
}
