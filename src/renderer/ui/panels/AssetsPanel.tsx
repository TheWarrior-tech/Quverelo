import { addNodes } from '../../../core/commands';
import { make, makeStroke, solid } from '../../../core/document';
import { centrePath, parsePath, transformPath } from '../../../core/path';
import type { SceneNode } from '../../../core/types';
import { editor } from '../../state/editor';
import { useEditor } from '../hooks';
import { Section } from '../controls/Panel';
import { EmptyState } from '../controls/EmptyState';
import { runCommand } from '../../state/commands';

/** Built-in shape library (100×100 artboard). */
export const SHAPES: { name: string; d: string; stroke?: boolean }[] = [
  { name: 'Arrow right', d: 'M5 38h55V18l35 32-35 32V62H5z' },
  { name: 'Arrow up', d: 'M38 95V40H18L50 5l32 35H62v55z' },
  { name: 'Double arrow', d: 'M5 50l22-25v15h46V25l22 25-22 25V60H27v15z' },
  { name: 'Speech bubble', d: 'M10 10h80a6 6 0 016 6v48a6 6 0 01-6 6H40L20 90V70H10a6 6 0 01-6-6V16a6 6 0 016-6z' },
  { name: 'Thought bubble', d: 'M30 20a20 15 0 0140 0 18 15 0 0118 25 15 14 0 01-15 25H28a17 15 0 01-14-27 15 13 0 0116-23zM22 82a6 6 0 1112 0 6 6 0 01-12 0zM10 94a4 4 0 118 0 4 4 0 01-8 0z' },
  { name: 'Heart', d: 'M50 90L12 52A22 22 0 0150 22a22 22 0 0138 30z' },
  { name: 'Tick', d: 'M8 52l14-14 18 18L80 16l14 14-54 54z' },
  { name: 'Cross', d: 'M20 6l30 30L80 6l14 14-30 30 30 30-14 14-30-30-30 30L6 80l30-30L6 20z' },
  { name: 'Lightning', d: 'M58 4L18 56h26l-8 40 46-56H54z' },
  { name: 'Cloud', d: 'M28 80a20 20 0 01-2-40 26 26 0 0150-6 20 20 0 01-2 46z' },
  { name: 'Banner', d: 'M4 30h14V20h64v10h14l-10 15 10 15H82v10H18V60H4l10-15z' },
  { name: 'Badge', d: 'M50 4l11 10 15-3 4 15 14 6-5 14 8 13-12 9 1 15-15 1-7 13-14-6-14 6-7-13-15-1 1-15-12-9 8-13-5-14 14-6 4-15 15 3z' },
  { name: 'Puzzle', d: 'M10 30h20a10 10 0 1120 0h20v20a10 10 0 110 20v20H50a10 10 0 10-20 0H10V70a10 10 0 100-20z' },
  { name: 'Light bulb', d: 'M50 5a30 30 0 0118 54v14H32V59A30 30 0 0150 5zM34 78h32v7H34zM38 89h24a12 12 0 01-24 0z' },
  { name: 'Pencil', d: 'M70 8l22 22-58 58H12V66zM62 16l22 22' },
  { name: 'Book', d: 'M8 18c14-6 28-6 42 4 14-10 28-10 42-4v66c-14-6-28-6-42 4-14-10-28-10-42-4zM50 22v66', stroke: true },
];

function insertShape(s: (typeof SHAPES)[number]) {
  const doc = editor.doc;
  const c = editor.activeContainer;
  if (!doc || !c) return;
  const size = Math.min(doc.settings.width, doc.settings.height) * 0.25;
  const k = size / 100;
  const d = transformPath(parsePath(s.d), [k, 0, 0, k, 0, 0]);
  const centred = centrePath(d);
  const node: SceneNode = make.path({
    name: s.name,
    d: centred.d,
    closed: true,
    x: doc.settings.width / 2,
    y: doc.settings.height / 2,
    fill: s.stroke ? solid('#ffffff') : solid(editor.ui.fillColor),
    stroke: s.stroke ? makeStroke('#1b1b1f', Math.max(1, size / 50)) : editor.ui.strokeEnabled ? makeStroke(editor.ui.strokeColor, editor.ui.toolOptions.strokeWidth) : makeStroke(),
  });
  editor.commit(`Insert ${s.name}`, (dd) => addNodes(dd, c.id, [node]));
  editor.select([node.id]);
}

function placeAsset(id: string) {
  const doc = editor.doc;
  const c = editor.activeContainer;
  const canvas = editor.assets.get(id);
  if (!doc || !c || !canvas) return;
  const W = doc.settings.width;
  const H = doc.settings.height;
  const fit = Math.min(1, (W * 0.6) / canvas.width, (H * 0.6) / canvas.height);
  const node = editor.ui.studio === 'layout'
    ? make.imageframe({ assetId: id, w: canvas.width * fit, h: canvas.height * fit, x: W / 2, y: H / 2, name: doc.assets[id]?.name ?? 'Image' })
    : make.raster({ assetId: id, w: canvas.width, h: canvas.height, scaleX: fit, scaleY: fit, x: W / 2, y: H / 2, name: doc.assets[id]?.name ?? 'Image' });
  editor.commit('Place asset', (d) => addNodes(d, c.id, [node]));
  editor.select([node.id]);
}

export function AssetsPanel() {
  const ed = useEditor();
  const doc = ed.doc!;
  const images = Object.values(doc.assets).filter((a) => ed.assets.has(a.id));
  return (
    <>
      <Section id="lib-shapes" title="Shapes & symbols">
        <div className="asset-grid">
          {SHAPES.map((s) => (
            <button key={s.name} className="asset-tile" title={s.name} aria-label={`Insert ${s.name}`} onClick={() => insertShape(s)}>
              <svg viewBox="-4 -4 108 108"><path d={s.d} fill={s.stroke ? 'none' : 'currentColor'} stroke="currentColor" strokeWidth={s.stroke ? 6 : 0} /></svg>
            </button>
          ))}
        </div>
      </Section>
      <Section id="lib-images" title={<>Images <span className="count num">{images.length}</span></>}>
        {images.length === 0 ? (
          <EmptyState icon="image" title="No images yet" actions={<button type="button" className="btn ghost sm" onClick={() => runCommand('file.place')}>Place image…</button>}>
            Images you place or drop on the canvas collect here so you can reuse them.
          </EmptyState>
        ) : (
          <div className="asset-grid">
            {images.map((a) => {
              const c = ed.assets.get(a.id)!;
              return (
                <button key={a.id} className="asset-tile" title={a.name} aria-label={`Place ${a.name}`} onClick={() => placeAsset(a.id)}>
                  <img src={c.toDataURL('image/jpeg', 0.6)} alt="" />
                </button>
              );
            })}
          </div>
        )}
      </Section>
    </>
  );
}
