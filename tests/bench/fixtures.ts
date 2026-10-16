/** Generated bench documents (no large binaries in the repo). */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createDocument, createStory, make } from '../../src/core/document';
import { addNodes } from '../../src/core/commands';
import { packQuvrelo } from '../../src/core/serialization';
import type { QuvreloDocument } from '../../src/core/types';

/** 50 A4 pages: one story threaded through 50 two-column frames, a photo, a title and 10 shapes per page. */
export async function fiftyPageDoc(dir: string): Promise<string> {
  let doc: QuvreloDocument = createDocument({ title: 'Fifty pages', studio: 'layout', pages: 50, settings: { width: 794, height: 1123, unit: 'mm', margins: { top: 57, right: 57, bottom: 57, left: 57 } } });
  const png = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample-photo.jpg'));
  const assetId = 'a_bench_photo';
  doc = { ...doc, assets: { [assetId]: { id: assetId, name: 'photo', mime: 'image/jpeg', width: 640, height: 427 } } };
  const para = 'Quvrelo lays out long documents offline. '.repeat(40);
  const story = createStory(Array.from({ length: 120 }, (_, i) => `${i + 1}. ${para}`).join('\n'), { fontSize: 13 });
  const frames: string[] = [];
  for (const [i, pg] of doc.pages.entries()) {
    const tf = make.textframe({ storyId: story.id, x: 397, y: 700, w: 680, h: 700, columns: 2, columnGap: 20, name: `Body ${i + 1}` });
    frames.push(tf.id);
    const img = make.imageframe({ assetId, x: 397, y: 220, w: 680, h: 300, name: `Photo ${i + 1}` });
    const shapes = Array.from({ length: 10 }, (_, k) => make.rect({ x: 80 + k * 70, y: 1080, w: 50, h: 20, name: `Bar ${k}` }));
    const title = make.text({ text: `Chapter ${i + 1}`, x: 397, y: 40, name: 'Title' });
    doc = addNodes(doc, pg.id, [img, tf, title, ...shapes]);
  }
  story.chain = frames;
  doc = { ...doc, stories: { [story.id]: story } };
  const bytes = await packQuvrelo(doc, async (id) => (id === assetId ? { bytes: new Uint8Array(png), mime: 'image/jpeg' } : null));
  const p = path.join(dir, 'Fifty pages.quvrelo');
  fs.writeFileSync(p, bytes);
  return p;
}

