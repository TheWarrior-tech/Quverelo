/**
 * Where a text style change goes in the Layout studio (inspector › Text and
 * the context bar). While editing a text frame:
 *   - with a selection, character attributes go to the selected characters
 *     and paragraph attributes to the paragraphs it touches;
 *   - with a collapsed caret, paragraph attributes go to the caret's paragraph
 *     and character attributes are held for the next typed text.
 * With the frame selected (not editing), the change applies to all its text,
 * as in InDesign / Affinity Publisher.
 */
import { applyTextPatch, pickChar, pickPara, rangeValue, sheetOf, styleAt } from '../../core/typography';
import type { Id, QuvreloDocument, TextStyle } from '../../core/types';
import { editor } from './editor';
import { getViewport } from './commands';

export interface FrameTextTarget {
  storyId: Id;
  style: TextStyle;
  /** true when the key has different values across the selection */
  mixed: (key: keyof TextStyle) => boolean;
  apply: (patch: Partial<TextStyle>) => void;
  /** the story range the change applies to */
  range: { start: number; end: number };
  scope: 'selection' | 'caret' | 'story';
}

export function frameTextTarget(doc: QuvreloDocument, storyId: Id): FrameTextTarget | null {
  const story = doc.stories[storyId];
  if (!story) return null;
  const sheet = sheetOf(doc);
  const sel = editor.ui.textSel && editor.ui.textSel.storyId === storyId && editor.ui.editingTextId ? editor.ui.textSel : null;
  const len = story.text.length;
  const scope: FrameTextTarget['scope'] = sel ? (sel.end > sel.start ? 'selection' : 'caret') : 'story';
  const range = sel ? { start: Math.min(sel.start, len), end: Math.min(sel.end, len) } : { start: 0, end: len };
  const pending = scope === 'caret' ? getViewport()?.textEdit.pendingProps ?? null : null;
  const at = scope === 'caret' ? Math.max(0, range.start - 1) : range.start;
  const style = { ...styleAt(story, sheet, at), ...(pending ?? {}) };
  const mixed = (key: keyof TextStyle) => range.end > range.start && rangeValue(story, sheet, range.start, range.end, key) === undefined;
  const apply = (patch: Partial<TextStyle>) => {
    const merge = `style:${storyId}:${range.start}:${range.end}`;
    if (scope === 'caret') {
      const para = pickPara(patch);
      const chr = pickChar(patch);
      if (Object.keys(para).length) editor.commit('Paragraph format', (d) => withStory(d, storyId, (s) => applyTextPatch(s, range.start, range.end, para)), merge);
      const vp = getViewport();
      if (Object.keys(chr).length && vp) {
        vp.textEdit.pendingProps = { ...(vp.textEdit.pendingProps ?? {}), ...chr };
        editor.emit();
      }
      return;
    }
    editor.commit(scope === 'selection' ? 'Character format' : 'Text style', (d) => withStory(d, storyId, (s) => {
      let next = applyTextPatch(s, range.start, range.end, patch);
      // the whole story: also its base style, so new and empty text follows
      if (scope === 'story') next = { ...next, style: { ...next.style, ...patch } };
      return next;
    }), merge);
  };
  return { storyId, style, mixed, apply, range, scope };
}

function withStory(doc: QuvreloDocument, id: Id, fn: (s: QuvreloDocument['stories'][string]) => QuvreloDocument['stories'][string]): QuvreloDocument {
  const s = doc.stories[id];
  return s ? { ...doc, stories: { ...doc.stories, [id]: fn(s) } } : doc;
}
