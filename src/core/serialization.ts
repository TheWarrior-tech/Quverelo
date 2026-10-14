/**
 * Native .quvrelo file format: a zip container.
 *
 *   mimetype            "application/vnd.quvrelo+zip" (stored first, uncompressed)
 *   document.json       the QuvreloDocument (pixels referenced by asset id)
 *   assets/<id>.<ext>   binary asset data (PNG/JPEG/WebP)
 *   thumbnail.png       optional preview of the first page
 */
import JSZip from 'jszip';
import { referencedAssets } from './document';
import type { QuvreloDocument, Id } from './types';
import { migrateDocument } from './migrate';

export const QUVRELO_MIME = 'application/vnd.quvrelo+zip';
/** Mimetype written by pre-release builds (when the app was called Easel Studio); still readable. */
export const LEGACY_MIME = 'application/vnd.easel-studio+zip';

export interface AssetBlob {
  bytes: Uint8Array;
  mime: string;
}

export function extForMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/svg+xml') return 'svg';
  return 'png';
}

export async function packQuvrelo(
  doc: QuvreloDocument,
  getAsset: (id: Id) => Promise<AssetBlob | null>,
  thumbnail?: Uint8Array,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', QUVRELO_MIME, { compression: 'STORE' });
  const used = referencedAssets(doc);
  const assets: QuvreloDocument['assets'] = {};
  for (const id of used) {
    const blob = await getAsset(id);
    if (!blob) continue;
    const meta = doc.assets[id] ?? { id, name: id, mime: blob.mime, width: 0, height: 0 };
    assets[id] = { ...meta, mime: blob.mime };
    zip.file(`assets/${id}.${extForMime(blob.mime)}`, blob.bytes, { compression: 'STORE' });
  }
  const out: QuvreloDocument = { ...doc, assets };
  zip.file('document.json', JSON.stringify(out));
  if (thumbnail) zip.file('thumbnail.png', thumbnail, { compression: 'STORE' });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export interface UnpackedQuvrelo {
  doc: QuvreloDocument;
  assets: Map<Id, AssetBlob>;
  thumbnail?: Uint8Array;
}

export async function unpackQuvrelo(data: Uint8Array | ArrayBuffer): Promise<UnpackedQuvrelo> {
  const zip = await JSZip.loadAsync(data);
  const mime = await zip.file('mimetype')?.async('string');
  if (mime && mime.trim() !== QUVRELO_MIME && mime.trim() !== LEGACY_MIME) throw new Error('Not a Quvrelo document');
  const json = await zip.file('document.json')?.async('string');
  if (!json) throw new Error('Damaged file: document.json is missing');
  const doc = migrateDocument(JSON.parse(json));
  const assets = new Map<Id, AssetBlob>();
  const files = zip.file(/^assets\//);
  for (const f of files) {
    const name = f.name.slice('assets/'.length);
    const id = name.replace(/\.[a-z0-9]+$/i, '');
    const bytes = await f.async('uint8array');
    assets.set(id, { bytes, mime: doc.assets[id]?.mime ?? 'image/png' });
  }
  const thumbnail = await zip.file('thumbnail.png')?.async('uint8array');
  return { doc, assets, thumbnail };
}
