import { describe, expect, it } from 'vitest';
import { DocumentHistory } from '../../src/core/history';
import { createDocument, make } from '../../src/core/document';
import { addNodes } from '../../src/core/commands';

describe('history', () => {
  it('undoes and redoes', () => {
    const d0 = createDocument();
    const h = new DocumentHistory(d0);
    const d1 = addNodes(d0, d0.pages[0].id, [make.rect()]);
    h.push('Add rect', d1);
    expect(h.doc.pages[0].nodes).toHaveLength(1);
    expect(h.dirty).toBe(true);
    h.undo();
    expect(h.doc.pages[0].nodes).toHaveLength(0);
    expect(h.dirty).toBe(false);
    h.redo();
    expect(h.doc.pages[0].nodes).toHaveLength(1);
  });
  it('merges rapid edits with the same key', () => {
    let t = 0;
    const d0 = createDocument();
    const h = new DocumentHistory(d0, { now: () => t });
    const rect = make.rect();
    let d = addNodes(d0, d0.pages[0].id, [rect]);
    h.push('Add', d);
    for (let i = 0; i < 5; i++) {
      t += 100;
      d = { ...d, title: 'T' + i };
      h.push('Rename', d, 'title');
    }
    expect(h.list).toHaveLength(3);
    expect(h.doc.title).toBe('T4');
  });
  it('truncates redo on new edit and respects the limit', () => {
    const d0 = createDocument();
    const h = new DocumentHistory(d0, { limit: 5 });
    let d = d0;
    for (let i = 0; i < 10; i++) {
      d = { ...d, title: String(i) };
      h.push('Edit ' + i, d);
    }
    expect(h.list.length).toBe(5);
    h.undo();
    h.push('New', { ...h.doc, title: 'x' });
    expect(h.canRedo).toBe(false);
  });
});
