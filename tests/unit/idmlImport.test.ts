import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import JSZip from 'jszip';
import { fontStyleToCss, imageSize, importIdml, PX_PER_PT } from '../../src/core/interop/idml';
import { parseXml, findAll, textOf } from '../../src/core/interop/xml';
import type { EllipseNode, ImageFrameNode, PathNode, RectNode, TextFrameNode } from '../../src/core/types';

const png = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'gradient.png'));

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

describe('XML reader', () => {
  it('parses elements, attributes, entities, CDATA and comments', () => {
    const x = parseXml('<?xml version="1.0"?><!-- c --><a k="1 &amp; 2"><b>x &lt; y</b><c/><![CDATA[<raw>]]></a>');
    const a = findAll(x, 'a')[0];
    expect(a.attrs.k).toBe('1 & 2');
    expect(textOf(findAll(a, 'b')[0])).toBe('x < y');
    expect(findAll(a, 'c')).toHaveLength(1);
    expect(a.children.at(-1)).toBe('<raw>');
  });
});

describe('IDML import', () => {
  it('reads image headers and font styles', () => {
    expect(imageSize(new Uint8Array(png))).toMatchObject({ mime: 'image/png' });
    expect(fontStyleToCss('Semibold Italic')).toEqual({ weight: 600, italic: true });
    expect(fontStyleToCss(undefined)).toEqual({ weight: 400, italic: false });
  });

  it('imports pages, margins, masters, threaded stories, styles, shapes, colours and images', async () => {
    const r = await importIdml(await sampleIdml(), 'Newsletter');
    const doc = r.doc;
    expect(doc.studio).toBe('layout');
    expect(doc.settings.width).toBeCloseTo(612 * PX_PER_PT);
    expect(doc.settings.height).toBeCloseTo(792 * PX_PER_PT);
    expect(doc.settings.margins.top).toBeCloseTo(36 * PX_PER_PT);
    expect(doc.settings.columns).toBe(2);
    expect(doc.pages.map((p) => p.name)).toEqual(['Page 1', 'Page 2']);

    // master
    expect(doc.masters).toHaveLength(1);
    expect(doc.masters[0].name).toBe('A-Master');
    expect(doc.pages.every((p) => p.masterId === doc.masters[0].id)).toBe(true);
    const footer = doc.masters[0].nodes[0] as RectNode;
    expect(footer.type).toBe('rect');
    expect(footer.y).toBeCloseTo((396 + 378) * PX_PER_PT); // spread y 360..396 -> page y 756..792

    // swatches
    expect(doc.swatches.map((s) => s.name)).toEqual(expect.arrayContaining(['Brand Red', 'Cyan']));

    // threaded text
    const p1 = doc.pages[0].nodes;
    const tf1 = p1.find((n) => n.type === 'textframe') as TextFrameNode;
    const tf2 = doc.pages[1].nodes.find((n) => n.type === 'textframe') as TextFrameNode;
    expect(tf1.storyId).toBe(tf2.storyId);
    const story = doc.stories[tf1.storyId];
    expect(story.chain).toEqual([tf1.id, tf2.id]);
    expect(story.text).toBe('Fish & chips\nSecond paragraph');
    expect(tf1.columns).toBe(2);
    expect(tf1.columnGap).toBeCloseTo(10 * PX_PER_PT);
    expect(tf1.padding).toBeCloseTo(4 * PX_PER_PT);
    expect(tf1.w).toBeCloseTo(264 * PX_PER_PT);
    expect(tf1.x).toBeCloseTo(168 * PX_PER_PT);
    expect(tf1.y).toBeCloseTo((396 - 280) * PX_PER_PT);

    // resolved style: Body BasedOn Base
    expect(story.style.fontFamily.startsWith('Minion Pro')).toBe(true);
    expect(story.style.fontSize).toBeCloseTo(10 * PX_PER_PT);
    expect(story.style.fontWeight).toBe(700);
    expect(story.style.italic).toBe(true);
    expect(story.style.align).toBe('center');
    expect(story.style.letterSpacing).toBe(20);
    expect(story.style.lineHeight).toBeCloseTo(1.4);
    expect(story.style.fill).toEqual({ type: 'solid', color: '#00ffff' });
    expect(r.warnings.some((w) => w.includes('first style'))).toBe(true);

    // shapes
    const red = p1.find((n) => n.name === 'Red box') as RectNode;
    expect(red.type).toBe('rect');
    expect(red.fill).toEqual({ type: 'solid', color: '#ff0000' });
    expect(red.stroke.width).toBeCloseTo(2 * PX_PER_PT);
    expect([red.w, red.h].map((v) => Math.round(v))).toEqual([133, 133]);
    const oval = p1.find((n) => n.type === 'ellipse') as EllipseNode;
    expect(oval.fill).toEqual({ type: 'solid', color: '#ff8080' });
    const line = p1.find((n) => n.type === 'path') as PathNode;
    expect(line.closed).toBe(false);
    const group = p1.find((n) => n.type === 'group');
    expect(group && group.type === 'group' && group.children).toHaveLength(2);

    // embedded image placed in its frame
    const frame = p1.find((n) => n.type === 'imageframe') as ImageFrameNode;
    expect(frame.assetId).toBeTruthy();
    expect(r.encoded.get(frame.assetId!)?.mime).toBe('image/png');
    expect(frame.fit).toBe('none');
    expect(frame.contentScale).toBeCloseTo(0.5 * PX_PER_PT * 0.75 / 0.75, 1);
  });

  it('resolves linked images through the resolver and reports missing ones', async () => {
    const asked: string[] = [];
    const r = await importIdml(await sampleIdml({ linked: true }), 'Linked', async (uri) => {
      asked.push(uri);
      return new Uint8Array(png);
    });
    expect(asked).toEqual(['file:/Users/teacher/Pictures/gradient.png']);
    expect((r.doc.pages[0].nodes.find((n) => n.type === 'imageframe') as ImageFrameNode).assetId).toBeTruthy();

    const missing = await importIdml(await sampleIdml({ linked: true }), 'Linked');
    expect(missing.warnings.some((w) => w.includes('linked image'))).toBe(true);
  });

  it('rejects files that are not IDML', async () => {
    const z = new JSZip();
    z.file('mimetype', 'application/epub+zip');
    await expect(importIdml(await z.generateAsync({ type: 'uint8array' }), 'x')).rejects.toThrow(/IDML/);
  });
});
