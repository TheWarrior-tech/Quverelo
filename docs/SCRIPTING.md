# Scripting

Quvrelo runs small JavaScript or TypeScript programs that edit the open document: make grids and
patterns, rename and number layers, find and replace text, add page labels, load a school palette.
Open **View › Scripts** (Ctrl+Alt+J / ⌘⌥J) or search "scripts" in the command palette.

- **Examples**: five ready-made scripts. Run one, or Edit it to make your own copy.
- **My scripts**: scripts you wrote, kept on this computer only (they are not in the document and
  never leave the machine).
- **Output**: what the last run printed with `log()`, its error if it failed, and how long it took.

A whole run is **one undo step** (Edit › Undo "Script: <name>"). If a script fails or hits a limit,
**nothing it did is applied**: the document is exactly as before.

## Safety and limits

Scripts run in a sandbox: the QuickJS engine compiled to WebAssembly (quickjs-emscripten, MIT),
inside the app, offline. A script cannot reach the file system, the network, the clipboard, other
documents, Node, the DOM or the app's own API. Its only door is the document API below, which
works on a private copy of the document that is checked and copied back when the script ends.

| Limit | Value | What happens |
|---|---|---|
| Run time | 5 s | "The script took longer than 5 s and was stopped" |
| Memory | 64 MB | "The script used too much memory and was stopped" |
| Stack | 1 MB | very deep recursion stops with a stack overflow error |
| Objects created | 20,000 per run | "A script may create at most 20000 objects" |
| String values | 100,000 characters | "text is too long" |
| Log | last 1,000 lines, 2,000 characters each | older lines are dropped |

Administrators can remove scripting entirely with `"disabledFeatures": ["scripting"]` in
`policy.json` (see [ADMIN_GUIDE.md](ADMIN_GUIDE.md)): the panel, menu item and command disappear and
nothing can run.

## TypeScript

Choose **TypeScript** in the editor's language switch. Types are stripped before running (sucrase,
MIT); there is no type checking at run time, so a type error doesn't stop a script, but the
declarations below describe exactly what exists.

## Units and coordinates

- Numbers are **document pixels** at 96 px per inch, whatever unit the document shows.
  `units.mm(10)` converts millimetres to pixels; `units.toMm(px)` converts back.
- `x` and `y` are the **centre** of an object; `(0, 0)` is the top-left corner of the page.
  `bounds` gives the top-left corner and size of what you see (after rotation).
- `rotation` is in degrees, clockwise. `opacity` is 0–1.
- Colours are `"#rrggbb"` (or `#rgb`, `#rrggbbaa`), `"rgb(r, g, b)"` or `null` for none.

## API reference

These are the globals a script sees (from `src/core/scripting/prelude.ts`).

### `document`

| Member | Type | |
|---|---|---|
| `title` | `string` (read/write) | the document title |
| `width`, `height` | `number` (read-only) | page size in px |
| `unit` | `string` | the unit the document displays (`mm`, `px`, `in`…) |
| `dpi` | `number` | output resolution |
| `studio` | `'photo' \| 'vector' \| 'layout'` | |
| `background` | `Colour` (read/write) | page colour, `null` = transparent |
| `pages` | `Page[]` | every page |
| `page` | `Page` | the first page |
| `addPage(name?)` | `Page` | adds a page at the end |
| `find(query?)` | `Node[]` | objects on every page (or `{ page: i }`) that match |
| `group(nodes)` | `Node` | groups objects that share a parent |
| `swatches` | `{ name, color }[]` | the document palette |
| `addSwatch(name, color)` | | adds a named colour |

A `query` is `{ type?, name?, text?, page? }`: `type` is exact; `name` and `text` match anywhere,
ignoring case (`text` looks inside text objects and text frames).

### `Page`

| Member | |
|---|---|
| `index` | 0-based page number |
| `name` | read/write |
| `nodes` | the page's top-level objects, bottom to top |
| `addRect(props?)`, `addEllipse(props?)` | new shape, 100 × 100 at the page centre unless `x`/`y`/`w`/`h` given |
| `addPolygon(props?)`, `addStar(props?)` | with `sides` / `points` (3–100) |
| `addText(textOrProps)` | artistic text |
| `addTextFrame(props?)` | a text frame with its own story (`text`, `w`, `h`…) |
| `addPath(svgPathData, props?)` | a path from SVG path data, e.g. `"M0 0 L100 0 L50 80 Z"`; `x`/`y` move its centre |
| `find(query?)` | like `document.find` on this page |

### `Node`

| Member | |
|---|---|
| `id`, `type` | read-only. `type` is `rect`, `ellipse`, `polygon`, `star`, `path`, `text`, `textframe`, `imageframe`, `raster` or `group` |
| `bounds` | `{ x, y, w, h }`, top-left and size as drawn |
| `children` | a group's members |
| `name`, `x`, `y`, `w`, `h`, `rotation`, `opacity`, `visible`, `locked` | read/write |
| `blend` | `normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity` |
| `fill`, `stroke`, `strokeWidth` | colours and width (setting `stroke` on an object without one gives it a 1 px stroke) |
| `text`, `fontSize`, `fontFamily`, `fontWeight` | text objects and text frames (a frame's text is its whole story) |
| `radius` | rectangle corner radius |
| `set(props)` | set several properties at once; returns the node |
| `moveBy(dx, dy)` | |
| `duplicate(offset?)` | a copy, moved by `offset` px right and down |
| `remove()` | |
| `ungroup()` | returns the former members |
| `info()` | every property above as one plain object (one call instead of many) |

Unknown property names and out-of-range values throw an error that names the problem, e.g.
`opacity must be between 0 and 1`.

### `selection`

| Member | |
|---|---|
| `nodes` | the selected objects |
| `set(nodes)` | select these (the app selects them after the run) |
| `clear()` | |

### Helpers

| Global | |
|---|---|
| `units.mm(v)`, `units.cm(v)`, `units.in(v)`, `units.pt(v)`, `units.px(v)` | to document px |
| `units.toMm(px)` | px to mm |
| `color.rgb(r, g, b)` | 0–255 each → `"#rrggbb"` |
| `color.hsl(h, s, l)` | degrees, %, % → `"#rrggbb"` |
| `log(...values)` / `console.log` | prints to Output (objects as JSON) |
| `quvrelo.version` | API version (1) |

The value of a script's last `return` (if any) is shown in Output.

## Type declarations

Shown in the editor's help and usable in your own editor:

```ts
declare type Colour = string | null; // "#rrggbb", "rgb(r,g,b)" or null for none
declare type NodeType = 'rect'|'ellipse'|'polygon'|'star'|'path'|'text'|'textframe'|'imageframe'|'raster'|'group';
declare interface Node {
  readonly id: string; readonly type: NodeType; readonly bounds: { x: number; y: number; w: number; h: number };
  readonly children: Node[];
  name: string; x: number; y: number; w: number; h: number; rotation: number; opacity: number;
  visible: boolean; locked: boolean; blend: string; fill: Colour; stroke: Colour; strokeWidth: number;
  text?: string; fontSize?: number; fontFamily?: string; fontWeight?: number; radius?: number;
  set(props: Partial<Node>): Node; moveBy(dx: number, dy: number): Node; remove(): void;
  duplicate(offset?: number): Node; ungroup(): Node[];
}
declare interface Page {
  readonly index: number; name: string; readonly nodes: Node[];
  addRect(p?: Partial<Node>): Node; addEllipse(p?: Partial<Node>): Node; addPolygon(p?: Partial<Node> & { sides?: number }): Node;
  addStar(p?: Partial<Node> & { points?: number }): Node; addText(p: string | Partial<Node>): Node; addTextFrame(p?: Partial<Node>): Node;
  addPath(svgPathData: string, p?: Partial<Node>): Node; find(q?: { type?: NodeType; name?: string; text?: string }): Node[];
}
declare const document: {
  title: string; readonly width: number; readonly height: number; readonly unit: string; readonly dpi: number;
  readonly studio: 'photo'|'vector'|'layout'; background: Colour; readonly pages: Page[]; readonly page: Page;
  addPage(name?: string): Page; find(q?: { type?: NodeType; name?: string; text?: string; page?: number }): Node[];
  group(nodes: Node[]): Node; readonly swatches: { name: string; color: string }[]; addSwatch(name: string, color: string): void;
};
declare const selection: { readonly nodes: Node[]; set(nodes: Node[]): void; clear(): void };
declare const units: { mm(v: number): number; cm(v: number): number; in(v: number): number; pt(v: number): number; px(v: number): number; toMm(px: number): number };
declare const color: { rgb(r: number, g: number, b: number): string; hsl(h: number, s: number, l: number): string };
declare function log(...values: unknown[]): void;
```

## Examples

Every example below is run by the unit tests (`tests/unit/scriptingDocs.test.ts`), so they stay
correct as the API grows.

### A rainbow grid

```js
const cols = 6, rows = 4, gap = 16;
const w = (document.width - gap * (cols + 1)) / cols;
const h = (document.height - gap * (rows + 1)) / rows;
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    document.page.addRect({
      x: gap + w / 2 + c * (w + gap), y: gap + h / 2 + r * (h + gap),
      w, h, radius: 12, fill: color.hsl((c + r * cols) * 15, 70, 55), name: `Tile ${r + 1}-${c + 1}`,
    });
  }
}
log(`Made ${cols * rows} tiles`);
```

### Number the selected objects from left to right (TypeScript)

```ts
const items: Node[] = selection.nodes.sort((a, b) => a.bounds.x - b.bounds.x);
if (!items.length) log('Select some objects first');
items.forEach((n, i) => (n.name = `Item ${i + 1}`));
log(`Renamed ${items.length}`);
```

### Find and replace in every text

```js
const find = 'colour', replace = 'color';
let count = 0;
for (const n of document.find({ text: find })) {
  n.text = n.text.split(find).join(replace);
  count++;
}
log(`Changed ${count} text object(s)`);
```

### A footer on every page

```js
const pages = document.pages;
for (const p of pages) {
  p.addText({
    text: `${document.title} — ${p.index + 1} / ${pages.length}`,
    x: document.width / 2, y: document.height - units.mm(8),
    fontSize: 12, fill: '#6b7079', name: 'Page label',
  });
}
```

### School colours

```js
const colours = { 'School navy': '#1f2a44', 'School gold': '#d9b44a', 'Paper': '#f6f3ea' };
for (const [name, value] of Object.entries(colours)) document.addSwatch(name, value);
log('Added', Object.keys(colours).length, 'swatches');
```

### A worksheet answer grid in millimetres

```js
const size = units.mm(12), left = units.mm(20), top = units.mm(60);
for (let i = 0; i < 10; i++) {
  const box = document.page.addRect({ x: left + size / 2, y: top + i * (size + units.mm(4)) + size / 2, w: size, h: size, fill: null, stroke: '#1f2a44', name: `Answer ${i + 1}` });
  document.page.addText({ text: `${i + 1}.`, x: box.x - units.mm(8), y: box.y, fontSize: 14 });
}
```

### Star burst from one shape

```js
const star = document.page.addStar({ points: 7, w: 120, h: 120, fill: '#d9b44a', name: 'Burst' });
for (let i = 1; i < 12; i++) {
  star.duplicate().set({ rotation: i * 30, opacity: 1 - i / 14, blend: 'multiply' });
}
return document.page.find({ name: 'Burst' }).length;
```

### Tidy up: hide empty text and report

```js
const empty = document.find({ type: 'text' }).filter((n) => !n.text.trim());
empty.forEach((n) => (n.visible = false));
log(`${empty.length} empty text object(s) hidden on ${document.pages.length} page(s)`);
```
