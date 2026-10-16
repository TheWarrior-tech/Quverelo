/**
 * PDF/X-1a:2003 (ISO 15930-4) and PDF/X-4 (ISO 15930-7) identification:
 * OutputIntent with the embedded press profile, Info keys (GTS_PDFXVersion,
 * Trapped), XMP metadata with matching dates and title, and the file ID.
 *
 * The page content rules (CMYK only, no transparency in X-1a, fonts embedded,
 * TrimBox/BleedBox) are the vector writer's job (core/pdfVector.ts).
 */
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFString } from 'pdf-lib';
import type { PdfxCondition } from './profiles';

export type PdfxStandard = 'x1a' | 'x4';

export interface PdfxOutput {
  standard: PdfxStandard;
  /** the press profile (ICC, CMYK output class) for the OutputIntent */
  profile: Uint8Array;
  condition: PdfxCondition;
}

export const PDFX_VERSION: Record<PdfxStandard, string> = { x1a: 'PDF/X-1a:2003', x4: 'PDF/X-4' };
/** PDF version each standard is based on */
export const PDFX_PDF_VERSION: Record<PdfxStandard, [number, number]> = { x1a: [1, 4], x4: [1, 6] };

/** PDF dates and XMP dates must say the same instant; both are written in UTC to whole seconds. */
export function pdfDate(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

export function xmpDate(d: Date): string {
  return new Date(Math.floor(d.getTime() / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface XmpFields {
  standard: PdfxStandard;
  title: string;
  creatorTool: string;
  producer: string;
  created: Date;
  modified: Date;
  documentId: string;
  instanceId: string;
}

/** The XMP packet (UTF-8, uncompressed) with the PDF/X identification schema. */
export function buildXmp(f: XmpFields): string {
  const ver = PDFX_VERSION[f.standard];
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
    xmlns:pdfx="http://ns.adobe.com/pdfx/1.3/"
    xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/">
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(f.title)}</rdf:li></rdf:Alt></dc:title>
   <xmp:CreateDate>${xmpDate(f.created)}</xmp:CreateDate>
   <xmp:ModifyDate>${xmpDate(f.modified)}</xmp:ModifyDate>
   <xmp:MetadataDate>${xmpDate(f.modified)}</xmp:MetadataDate>
   <xmp:CreatorTool>${esc(f.creatorTool)}</xmp:CreatorTool>
   <pdf:Producer>${esc(f.producer)}</pdf:Producer>
   <pdf:Trapped>False</pdf:Trapped>
   <xmpMM:DocumentID>uuid:${f.documentId}</xmpMM:DocumentID>
   <xmpMM:InstanceID>uuid:${f.instanceId}</xmpMM:InstanceID>
   <xmpMM:VersionID>1</xmpMM:VersionID>
   <xmpMM:RenditionClass>default</xmpMM:RenditionClass>
   <pdfx:GTS_PDFXVersion>${ver}</pdfx:GTS_PDFXVersion>
   <pdfxid:GTS_PDFXVersion>${ver}</pdfxid:GTS_PDFXVersion>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function uuid(bytes: Uint8Array): string {
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}

/**
 * pdf-lib always writes "%PDF-1.7"; PDF/X-1a:2003 is PDF 1.4 and PDF/X-4 is PDF 1.6.
 * The header has the same length either way, so the byte offsets in the xref stay valid.
 */
export function setHeaderVersion(bytes: Uint8Array, standard: PdfxStandard): void {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 8));
  if (!/^%PDF-1\.\d$/.test(head)) throw new Error('Not a PDF header');
  const [maj, min] = PDFX_PDF_VERSION[standard];
  bytes[5] = 48 + maj;
  bytes[7] = 48 + min;
}

/**
 * Turn a finished pdf-lib document into a PDF/X file: header version, file ID,
 * OutputIntent, Info keys and XMP. Call after the pages are written, before save
 * (save without object streams).
 */
export function applyPdfx(pdf: PDFDocument, o: PdfxOutput & { title: string; creator: string; producer: string; date: Date }): void {
  const ctx = pdf.context;

  // dates and identity (whole seconds so Info and XMP agree exactly)
  const date = new Date(Math.floor(o.date.getTime() / 1000) * 1000);
  pdf.setTitle(o.title, { showInWindowTitleBar: true });
  pdf.setCreator(o.creator);
  pdf.setProducer(o.producer);
  pdf.setCreationDate(date);
  pdf.setModificationDate(date);
  const infoRef = ctx.trailerInfo.Info as PDFRef;
  const info = ctx.lookup(infoRef, PDFDict);
  info.set(PDFName.of('CreationDate'), PDFString.of(pdfDate(date)));
  info.set(PDFName.of('ModDate'), PDFString.of(pdfDate(date)));
  info.set(PDFName.of('GTS_PDFXVersion'), PDFString.of(PDFX_VERSION[o.standard]));
  info.set(PDFName.of('Trapped'), PDFName.of('False'));
  // pdf-lib writes the title in UTF-16 only when it has to; keep the plain form for PDFDocEncoding readers
  const id = randomBytes(16);
  const hex = Array.from(id, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(hex), PDFHexString.of(hex)]);

  // OutputIntent with the embedded press profile
  const icc = ctx.flateStream(o.profile, { N: 4 });
  const iccRef = ctx.register(icc);
  const intent = ctx.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFX',
    OutputConditionIdentifier: PDFString.of(o.condition.identifier),
    OutputCondition: PDFString.of(o.condition.condition),
    RegistryName: PDFString.of(o.condition.registry),
    Info: PDFString.of(o.condition.info),
    DestOutputProfile: iccRef,
  });
  pdf.catalog.set(PDFName.of('OutputIntents'), ctx.obj([ctx.register(intent)]));

  // XMP metadata, uncompressed
  const xmp = buildXmp({
    standard: o.standard, title: o.title, creatorTool: o.creator, producer: o.producer,
    created: date, modified: date, documentId: uuid(id), instanceId: uuid(randomBytes(16)),
  });
  const xmpBytes = new TextEncoder().encode(xmp);
  const meta = PDFRawStream.of(ctx.obj({ Type: 'Metadata', Subtype: 'XML', Length: xmpBytes.length }) as PDFDict, xmpBytes);
  pdf.catalog.set(PDFName.of('Metadata'), ctx.register(meta));
}
