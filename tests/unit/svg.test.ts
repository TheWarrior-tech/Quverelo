import { describe, expect, it } from 'vitest';
import { createDocument, make, solid } from '../../src/core/document';
import { addNodes, addTextFrame } from '../../src/core/commands';
import { imageFrameContentRect, pageToSvg } from '../../src/core/svg';

describe('svg export', () => {
  it('exports shapes, gradients, masks and text', () => {
    let d = createDocument({ settings: { width: 200, height: 100 } });
    d = addNodes(d, d.pages[0].id, [
      make.rect({ x: 50, y: 50, fill: { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] } }),
      make.ellipse({ x: 150, y: 50, opacity: 0.5, blend: 'multiply', mask: { d: [['M', 0, 0], ['L', 10, 0], ['L', 10, 10], ['Z']], inverted: false, enabled: true } }),
      make.text({ text: 'Hi <there>', style: { ...make.text().style, fill: solid('#f00') } }),
    ]);
    d = addTextFrame(d, d.pages[0].id, { x: 100, y: 50, w: 100, h: 50 }, 'Frame text').doc;
    const svg = pageToSvg(d, d.pages[0]);
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('clip-path=');
    expect(svg).toContain('mix-blend-mode:multiply');
    expect(svg).toContain('Hi &lt;there&gt;');
    expect(svg).toContain('Frame text');
    expect(svg).toContain('viewBox="0 0 200 100"');
  });
  it('computes picture frame fit', () => {
    const base = { w: 100, h: 100, contentX: 0, contentY: 0, contentScale: 1 };
    expect(imageFrameContentRect({ ...base, fit: 'fill' }, 200, 100).h).toBe(100);
    expect(imageFrameContentRect({ ...base, fit: 'fill' }, 200, 100).w).toBe(200);
    expect(imageFrameContentRect({ ...base, fit: 'fit' }, 200, 100).w).toBe(100);
    expect(imageFrameContentRect({ ...base, fit: 'stretch' }, 200, 50).h).toBe(100);
  });
});
