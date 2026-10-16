import { describe, expect, it } from 'vitest';
import { importSvg } from '../../src/renderer/engine/svgImport';
import { createDocument } from '../../src/core/document';
import { addNodes } from '../../src/core/commands';
import { pageToSvg } from '../../src/core/svg';
import { isNonZeroFill } from '../../src/core/vectorExpand';
import type { PathNode, SceneNode } from '../../src/core/types';

// two same-direction squares, one inside the other: nonzero fills the middle, evenodd punches it out
const RINGS = 'M0 0 L100 0 L100 100 L0 100 Z M25 25 L75 25 L75 75 L25 75 Z';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">
  <path id="nz" d="${RINGS}" fill="#ff0000"/>
  <path id="eo" d="${RINGS}" fill="#00ff00" fill-rule="evenodd" transform="translate(150 0)"/>
  <g fill-rule="evenodd"><path id="inh" d="${RINGS}" fill="#0000ff" transform="translate(300 0)"/></g>
</svg>`;

function flat(nodes: SceneNode[]): SceneNode[] {
  return nodes.flatMap((n) => [n, ...(n.type === 'group' ? flat(n.children) : [])]);
}

describe('SVG import keeps fill-rule', () => {
  const paths = flat(importSvg(svg).nodes).filter((n): n is PathNode => n.type === 'path');
  const byColor = (c: string) => paths.find((p) => p.fill.type === 'solid' && p.fill.color.toLowerCase() === c)!;
  it('nonzero (the SVG default), evenodd, and evenodd inherited from a group', () => {
    expect(paths).toHaveLength(3);
    expect(byColor('#ff0000').fillRule).toBe('nonzero');
    expect(byColor('#00ff00').fillRule).toBe('evenodd');
    expect(byColor('#0000ff').fillRule).toBe('evenodd');
    expect(isNonZeroFill(byColor('#ff0000'))).toBe(true);
    expect(isNonZeroFill(byColor('#00ff00'))).toBe(false);
  });
  it('round-trips through SVG export', () => {
    let d = createDocument({ settings: { width: 400, height: 200 } });
    d = addNodes(d, d.pages[0].id, paths);
    const out = pageToSvg(d, d.pages[0]);
    expect(out.match(/fill="#ff0000"[^>]*fill-rule="nonzero"/)).toBeTruthy();
    expect(out.match(/fill="#00ff00"[^>]*fill-rule="evenodd"/)).toBeTruthy();
    // documents from before keep drawing even-odd
    expect(isNonZeroFill({ ...byColor('#ff0000'), fillRule: undefined })).toBe(false);
  });
});
