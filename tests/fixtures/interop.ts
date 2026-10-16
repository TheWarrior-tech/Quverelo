/**
 * Builders for interop test files (PSD, PDF/AI, IDML), shared by the unit tests
 * and the e2e specs. Written at test time so no binary fixtures are committed.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import JSZip from 'jszip';
import { writePsdUint8Array, type Psd } from 'ag-psd';
import { PDFDocument, PDFName, PDFOperator, PDFString, StandardFonts, rgb, cmyk } from 'pdf-lib';

const FIXTURES = path.resolve(__dirname);

export function img(w: number, h: number, rgba: [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width: w, height: h, data };
}

/** A small layered PSD written with ag-psd: background, group with two layers, shape and text. */
export function samplePsd(): Uint8Array {
  const psd: Psd = {
    width: 200,
    height: 100,
    imageData: img(200, 100, [255, 255, 255, 255]),
    children: [
      { name: 'Background', left: 0, top: 0, right: 200, bottom: 100, imageData: img(200, 100, [250, 250, 250, 255]) },
      {
        name: 'Stuff',
        opened: true,
        opacity: 0.5,
        blendMode: 'pass through',
        children: [
          { name: 'Red', left: 10, top: 10, right: 50, bottom: 30, blendMode: 'multiply', opacity: 0.75, imageData: img(40, 20, [255, 0, 0, 255]) },
          { name: 'Hidden', left: 60, top: 10, right: 70, bottom: 20, hidden: true, blendMode: 'linear burn', imageData: img(10, 10, [0, 0, 255, 255]) },
        ],
      },
      {
        name: 'Masked', left: 100, top: 0, right: 140, bottom: 40, imageData: img(40, 40, [0, 255, 0, 255]),
        mask: { left: 100, top: 0, right: 120, bottom: 40, defaultColor: 0, imageData: img(20, 40, [255, 255, 255, 255]) },
      },
      {
        name: 'Box', left: 150, top: 50, right: 190, bottom: 90, imageData: img(40, 40, [0, 0, 0, 255]),
        vectorFill: { type: 'color', color: { r: 10, g: 20, b: 30 } },
        vectorMask: {
          paths: [{
            open: false, fillRule: 'non-zero',
            knots: [
              { linked: false, points: [150, 50, 150, 50, 150, 50] },
              { linked: false, points: [190, 50, 190, 50, 190, 50] },
              { linked: false, points: [190, 90, 190, 90, 190, 90] },
              { linked: false, points: [150, 90, 150, 90, 150, 90] },
            ],
          }],
        },
      },
    ],
  };
  return writePsdUint8Array(psd, { generateThumbnail: false });
}

export async function samplePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 100]);
  page.drawRectangle({ x: 10, y: 10, width: 50, height: 30, color: rgb(1, 0, 0), borderColor: cmyk(0, 0, 0, 1), borderWidth: 2, opacity: 0.5 });
  page.drawSvgPath('M 0 0 L 40 0 L 20 -30 Z', { x: 100, y: 80, color: rgb(0, 0, 1) });
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText('Hello PDF', { x: 20, y: 70, size: 12, font, color: rgb(0, 0.5, 0) });
  const png = await pdf.embedPng(fs.readFileSync(path.join(FIXTURES, 'gradient.png')));
  page.drawImage(png, { x: 150, y: 10, width: 40, height: 20 });

  // Illustrator-style layers: optional content groups, one hidden
  const ctx = pdf.context;
  const ocgOn = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Artwork') }));
  const ocgOff = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Sketch') }));
  pdf.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: [ocgOn, ocgOff], D: ctx.obj({ OFF: [ocgOff] }) }));
  const res = page.node.Resources()!;
  res.set(PDFName.of('Properties'), ctx.obj({ L1: ocgOn, L2: ocgOff }));
  const op = (o: string, ...args: unknown[]) => PDFOperator.of(o as never, args as never);
  page.pushOperators(
    op('BDC', PDFName.of('OC'), PDFName.of('L1')),
    op('q'), op('rg', ctx.obj(0), ctx.obj(1), ctx.obj(0)), op('re', ctx.obj(0), ctx.obj(0), ctx.obj(10), ctx.obj(10)), op('f'), op('Q'),
    op('EMC'),
    op('BDC', PDFName.of('OC'), PDFName.of('L2')),
    op('q'), op('re', ctx.obj(20), ctx.obj(0), ctx.obj(10), ctx.obj(10)), op('W'), op('n'),
    op('rg', ctx.obj(1), ctx.obj(1), ctx.obj(0)), op('re', ctx.obj(15), ctx.obj(0), ctx.obj(30), ctx.obj(10)), op('f'), op('Q'),
    op('EMC'),
  );
  return pdf.save({ useObjectStreams: false });
}

export const png = fs.readFileSync(path.join(FIXTURES, 'gradient.png'));

const pathGeo = (pts: [number, number][], open = false) =>
  `<Properties><PathGeometry><GeometryPathType PathOpen="${open}"><PathPointArray>${pts
    .map(([x, y]) => `<PathPointType Anchor="${x} ${y}" LeftDirection="${x} ${y}" RightDirection="${x} ${y}"/>`)
    .join('')}</PathPointArray></GeometryPathType></PathGeometry></Properties>`;
const box = (x0: number, y0: number, x1: number, y1: number) => pathGeo([[x0, y0], [x0, y1], [x1, y1], [x1, y0]]);

/** Two single-page spreads (Letter, 612x792pt), a master, a threaded story, shapes and an embedded image. */
export async function sampleIdml(opts: { linked?: boolean } = {}): Promise<Uint8Array> {
  const z = new JSZip();
  z.file('mimetype', 'application/vnd.adobe.indesign-idml-package');
  z.file('designmap.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<?aid style="50" type="document" readerVersion="6.0" featureSet="257"?>
<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0" Self="d">
  <idPkg:Graphic src="Resources/Graphic.xml"/>
  <idPkg:Styles src="Resources/Styles.xml"/>
  <idPkg:Preferences src="Resources/Preferences.xml"/>
  <idPkg:MasterSpread src="MasterSpreads/MasterSpread_um.xml"/>
  <idPkg:Spread src="Spreads/Spread_u1.xml"/>
  <idPkg:Spread src="Spreads/Spread_u2.xml"/>
  <idPkg:Story src="Stories/Story_us1.xml"/>
</Document>`);
  z.file('Resources/Graphic.xml', `<idPkg:Graphic xmlns:idPkg="x">
  <Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" Name="Black"/>
  <Color Self="Color/u7" Model="Process" Space="RGB" ColorValue="255 0 0" Name="Brand Red"/>
  <Color Self="Color/u8" Model="Process" Space="CMYK" ColorValue="100 0 0 0" Name="Cyan"/>
  <Tint Self="Tint/u9" BaseColor="Color/u7" TintValue="50"/>
  <Swatch Self="Swatch/None" Name="None"/>
</idPkg:Graphic>`);
  z.file('Resources/Styles.xml', `<idPkg:Styles xmlns:idPkg="x"><RootParagraphStyleGroup>
  <ParagraphStyle Self="ParagraphStyle/Base" Name="Base" PointSize="10" FontStyle="Regular"><Properties><AppliedFont type="string">Minion Pro</AppliedFont><Leading type="unit">14</Leading></Properties></ParagraphStyle>
  <ParagraphStyle Self="ParagraphStyle/Body" Name="Body" FontStyle="Bold Italic" Justification="CenterAlign" FillColor="Color/u8" Tracking="20"><Properties><BasedOn type="object">ParagraphStyle/Base</BasedOn></Properties></ParagraphStyle>
</RootParagraphStyleGroup><RootCharacterStyleGroup><CharacterStyle Self="CharacterStyle/Em" Name="Em" FontStyle="Italic"/></RootCharacterStyleGroup></idPkg:Styles>`);
  z.file('Resources/Preferences.xml', `<idPkg:Preferences xmlns:idPkg="x"><DocumentPreference PageWidth="612" PageHeight="792" FacingPages="false"/></idPkg:Preferences>`);
  z.file('MasterSpreads/MasterSpread_um.xml', `<idPkg:MasterSpread xmlns:idPkg="x"><MasterSpread Self="um" NamePrefix="A" BaseName="Master" ItemTransform="1 0 0 1 0 0">
  <Page Self="ump" GeometricBounds="0 0 792 612" ItemTransform="1 0 0 1 0 -396" Name="A"/>
  <Rectangle Self="umr" ItemTransform="1 0 0 1 0 0" FillColor="Color/Black">${box(0, 360, 612, 396)}</Rectangle>
</MasterSpread></idPkg:MasterSpread>`);
  const image = opts.linked
    ? `<Image Self="ui" ItemTransform="0.5 0 0 0.5 300 -300"><Properties><Profile type="string">sRGB</Profile></Properties><Link Self="ul" LinkResourceURI="file:/Users/teacher/Pictures/gradient.png"/></Image>`
    : `<Image Self="ui" ItemTransform="0.5 0 0 0.5 300 -300" ActualPpi="72 72"><Properties><Contents><![CDATA[${png.toString('base64')}]]></Contents></Properties></Image>`;
  z.file('Spreads/Spread_u1.xml', `<idPkg:Spread xmlns:idPkg="x"><Spread Self="u1" ItemTransform="1 0 0 1 0 0">
  <Page Self="up1" Name="1" AppliedMaster="um" GeometricBounds="0 0 792 612" ItemTransform="1 0 0 1 0 -396"><MarginPreference Top="36" Bottom="36" Left="36" Right="36" ColumnCount="2" ColumnGutter="12"/></Page>
  <TextFrame Self="tf1" ParentStory="us1" PreviousTextFrame="n" NextTextFrame="tf2" ItemTransform="1 0 0 1 0 0">${box(36, -360, 300, -200)}<TextFramePreference TextColumnCount="2" TextColumnGutter="10" InsetSpacing="4 4 4 4"/></TextFrame>
  <Rectangle Self="r1" Name="Red box" ItemTransform="1 0 0 1 0 0" FillColor="Color/u7" StrokeColor="Color/Black" StrokeWeight="2">${box(36, 0, 136, 100)}</Rectangle>
  <Oval Self="o1" ItemTransform="1 0 0 1 0 0" FillColor="Tint/u9">${pathGeo([[200, 0], [250, 50], [200, 100], [150, 50]])}</Oval>
  <GraphicLine Self="l1" ItemTransform="1 0 0 1 0 0" StrokeColor="Color/Black" StrokeWeight="1">${pathGeo([[36, 200], [500, 200]], true)}</GraphicLine>
  <Rectangle Self="ir" ItemTransform="1 0 0 1 0 0">${box(300, -300, 400, -250)}${image}</Rectangle>
  <Group Self="g1" ItemTransform="1 0 0 1 100 300"><Rectangle Self="gr1" ItemTransform="1 0 0 1 0 0" FillColor="Color/u8">${box(0, 0, 10, 10)}</Rectangle><Rectangle Self="gr2" ItemTransform="1 0 0 1 0 0" FillColor="Color/u8">${box(20, 0, 30, 10)}</Rectangle></Group>
</Spread></idPkg:Spread>`);
  z.file('Spreads/Spread_u2.xml', `<idPkg:Spread xmlns:idPkg="x"><Spread Self="u2" ItemTransform="1 0 0 1 0 0">
  <Page Self="up2" Name="2" AppliedMaster="um" GeometricBounds="0 0 792 612" ItemTransform="1 0 0 1 0 -396"/>
  <TextFrame Self="tf2" ParentStory="us1" PreviousTextFrame="tf1" NextTextFrame="n" ItemTransform="1 0 0 1 0 0">${box(36, -360, 300, 300)}</TextFrame>
</Spread></idPkg:Spread>`);
  z.file('Stories/Story_us1.xml', `<idPkg:Story xmlns:idPkg="x"><Story Self="us1">
  <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>Fish &amp; chips</Content><Br/></CharacterStyleRange></ParagraphStyleRange>
  <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/Em" PointSize="10"><Content>Second paragraph</Content></CharacterStyleRange></ParagraphStyleRange>
</Story></idPkg:Story>`);
  return z.generateAsync({ type: 'uint8array' });
}

