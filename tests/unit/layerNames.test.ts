import { describe, expect, it } from 'vitest';
import { createStory, hasAutoName, layerDisplayName, make, textSnippet } from '../../src/core/document';
import { frameGuideVisible } from '../../src/renderer/engine/draw';
import { indexAbove } from '../../src/core/commands';

describe('text layer auto-names (critique 2 P1-7)', () => {
  it('collapses whitespace and cuts at a word boundary', () => {
    expect(textSnippet('Open Evening')).toBe('Open Evening');
    expect(textSnippet('  Open\n\nEvening  ')).toBe('Open Evening');
    expect(textSnippet('Thursday 2 October, 6–8pm in the main hall')).toBe('Thursday 2 October…');
    expect(textSnippet('Supercalifragilisticexpialidocious-ish')).toBe('Supercalifragilisticexpi…');
    expect(textSnippet('')).toBe('');
  });

  it('names an unrenamed text frame by its story text', () => {
    const story = createStory('Open Evening\nAll welcome');
    const f = make.textframe({ storyId: story.id });
    const doc = { stories: { [story.id]: story } };
    expect(hasAutoName(f)).toBe(true);
    expect(layerDisplayName(f, doc)).toBe('Open Evening All welcome');
  });

  it('keeps "Text Frame" for an empty frame', () => {
    const story = createStory('   ');
    const f = make.textframe({ storyId: story.id });
    expect(layerDisplayName(f, { stories: { [story.id]: story } })).toBe('Text Frame');
  });

  it('names artistic text by its content', () => {
    expect(layerDisplayName(make.text({ text: 'Science Fair 2026' }), null)).toBe('Science Fair 2026');
  });

  it('a renamed layer keeps its name whatever its text says', () => {
    const t = make.text({ text: 'Science Fair', name: 'Title' });
    expect(hasAutoName(t)).toBe(false);
    expect(layerDisplayName(t, null)).toBe('Title');
    expect(layerDisplayName(make.rect(), null)).toBe('Rectangle');
  });
});

describe('text frame guide (critique 2 P1-7)', () => {
  const story = createStory('Hello');
  const empty = createStory('');
  const doc = { stories: { [story.id]: story, [empty.id]: empty } } as never;
  const f = make.textframe({ storyId: story.id });

  it('is hidden at rest on a frame that holds text', () => {
    expect(frameGuideVisible(f, { doc, hiddenNodeId: null })).toBe(false);
  });
  it('shows while the frame is being edited', () => {
    expect(frameGuideVisible(f, { doc, hiddenNodeId: f.id })).toBe(true);
  });
  it('shows on an empty frame so it never becomes invisible', () => {
    expect(frameGuideVisible(make.textframe({ storyId: empty.id }), { doc, hiddenNodeId: null })).toBe(true);
  });
  it('image frames keep their placeholder boundary', () => {
    expect(frameGuideVisible(make.imageframe(), { doc, hiddenNodeId: null })).toBe(true);
  });
});

describe('Photo shapes insert above the active layer', () => {
  const a = make.rect(), b = make.rect(), c = make.rect();
  it('goes directly above the topmost selected top-level layer', () => {
    expect(indexAbove([a, b, c], [a.id])).toBe(1);
    expect(indexAbove([a, b, c], [a.id, b.id])).toBe(2);
  });
  it('goes on top when nothing top-level is selected', () => {
    expect(indexAbove([a, b, c], [])).toBeUndefined();
    expect(indexAbove([a, b, c], ['nope'])).toBeUndefined();
  });
});
