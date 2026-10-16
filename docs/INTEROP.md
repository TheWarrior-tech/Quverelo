# Interoperability: Photoshop, Illustrator, PDF, InDesign and Affinity files

Quvrelo opens and exchanges files with the tools schools and studios already have, entirely offline.
Everything here runs inside the app with bundled, permissively licensed code (ag-psd MIT, pdf-lib
MIT, JSZip MIT); nothing is uploaded or converted online.

| Format | Open (File › Open) | Place into a document (File › Place) | Export |
|---|---|---|---|
| Photoshop `.psd` / `.psb` | ✓ layered | ✓ as one group | ✓ layered `.psd` |
| Illustrator `.ai` (PDF-compatible) | ✓ editable vectors | ✓ as one group | via PDF / SVG |
| PDF | ✓ editable vectors, one or many pages | ✓ | ✓ vector PDF, image PDF |
| InDesign `.idml` | ✓ pages, masters, threaded stories | — | via PDF |
| Affinity `.afphoto` / `.afdesign` / `.afpub` | ✗ (see below) | ✗ | — |

When something could not be kept exactly, a message says how many things changed ("Opened Poster.psd —
2 things changed on import"); its **Details** button lists them in plain words (for example "Layer
effects (shadows, strokes, glows) were not imported"). Repeated notes are counted ("… (×3)"). Administrators can switch each importer off with `disabledFeatures`:
`import-psd`, `import-ai` (also PDF vector import), `import-idml`, `export-psd`
(see [ADMIN_GUIDE.md](ADMIN_GUIDE.md)).

## Photoshop (PSD / PSB)

Read and written with ag-psd (`src/core/interop/psd.ts`, `src/renderer/engine/psdExport.ts`).

**Kept editable on open**
- Pixel layers → pixel layers; groups → groups (pass-through groups become normal groups).
- Text layers → editable text: font (PostScript name mapped to family, weight, italic), size, colour,
  alignment, tracking, leading. The rendered pixels Photoshop stored are not used.
- Shape layers → editable paths (vector mask + solid fill / stroke).
- Blend modes, opacity × fill opacity, visibility, locks; vector masks → object masks.

**Approximated (with a note)**
- Pixel masks are applied to the layer's transparency (Quvrelo's object masks are vector).
- Text with several styles uses the first; warped text is imported straight.
- Gradient / pattern shape fills become solid grey; clipping masks become normal layers.
- Layer effects and adjustment layers are not imported.

**Export** (File › Export › Photoshop PSD): every object becomes its own layer, rendered at document
resolution and cropped to its bounds; groups become layer groups; names, visibility, opacity, blend
modes and locks are kept; a flattened composite is included so any reader can show the picture.
Text and vectors arrive in Photoshop as pixels (send a PDF or SVG when they must stay editable).

## Illustrator (.ai) and PDF

Illustrator has embedded a full PDF in every `.ai` by default since CS ("Create PDF Compatible
File"). Quvrelo reads that PDF and interprets the page drawing itself (`src/core/interop/pdfImport.ts`)
so the result is editable objects, not a picture.

**Kept editable**
- Paths (lines, curves, rectangles) with fill and stroke colour, width, caps, joins, dashes.
- Colours in Gray, RGB, CMYK, ICC-based, Lab, **spot colours** (Separation / DeviceN through their
  tint transform) and Indexed spaces.
- **Gradients**: axial and radial shadings — both Illustrator's "clip, then paint the shading" and
  shading-pattern fills / strokes — become real linear / radial gradients. Stop colours come from the
  PDF functions (exponential, stitching, sampled and PostScript-calculator functions are evaluated;
  curved ramps are sampled into extra stops). Quvrelo gradients run across an object's bounding box,
  so the angle and stop positions are re-expressed on that box and the colours land where they were.
- **Opacity**: fill and stroke opacity are kept separately (`ca` / `CA`); blend modes are kept.
- **Opacity (soft) masks**: a mask made of shapes becomes a vector mask; a mask that is one gradient
  becomes a fading fill (the gradient's lightness as transparency) plus the mask shape; a uniform grey
  becomes object opacity.
- Clipping paths → object masks. Illustrator layers (optional content) → named groups; hidden
  layers stay hidden.
- Text → editable text, decoded through the font's ToUnicode map.
- Images (JPEG kept as-is; 8-bit RGB / Gray with soft masks).
- **Rotated pages** (`/Rotate` 90 / 180 / 270) open the way a PDF viewer shows them.
- Multi-page PDFs and multiple artboards open as a multi-page document.

**Approximated or not imported (with a note)**
- Off-centre radial gradients are centred on their shape; mesh (types 4–7) and function (type 1)
  shadings and tiling patterns become flat colour.
- Opacity masks that contain images or text, or several grey levels, are reduced to their shape.
- An object with both a clipping path and an opacity mask keeps the clipping path.
- Inline images, unusual image encodings; Illustrator-only data (live effects, symbols, appearance
  stacks) — what you get is what the PDF copy contains.
- PostScript-only `.ai` files (Illustrator 8 and earlier, or saved without PDF compatibility) are
  refused with a message explaining how to re-save them.

## InDesign (IDML)

IDML is InDesign's published interchange format (a zip of XML). Export it from InDesign with
**File › Save As › InDesign Markup (IDML)**. Quvrelo reads `designmap.xml`, preferences, colours,
styles, stories, spreads and master spreads (`src/core/interop/idml.ts`, `idmlRich.ts`).

**Kept**
- Pages (size, margins, columns), facing pages, master spreads → master pages.
- Text frames → text frames threaded in story order, with columns, gutter and inset.
- Rectangles, ovals, polygons, lines, groups → editable shapes; named colours and tints → swatches.
- Placed images: embedded images always; linked images when they sit next to the IDML or in its
  `Links` folder (packaged InDesign jobs). Missing links leave an empty picture frame and a note.
- **Styles**: the named paragraph, character and cell style sheet with Based On chains and Next
  Style; every paragraph's style and local overrides; every character range's style and overrides
  (font, size, weight, italic, leading, tracking, alignment, colour, underline, strike-through,
  small caps, superscript / subscript, baseline shift, space before / after, indents, hyphenation,
  keep options).
- **Tables**: header rows, column widths, row heights, merged cells, cell styles, cell fills, borders,
  insets and vertical alignment, and the formatting inside each cell.

**Current limitations (with a note)**
- Until the Layout text engine with per-range styles is merged, a story is drawn in its first style;
  the styles and where they apply are already stored in the document and light up with that engine.
- Until the Layout table object is merged, tables show as tab-separated text (one paragraph per row);
  the full table structure is stored with the import.
- Gradient swatches import as their first colour; non-rectangular picture frames as rectangles;
  uneven frame insets as the top inset; buttons and form fields are skipped.

## Affinity (.afphoto, .afdesign, .afpub)

**Quvrelo cannot open Affinity's native files, and we don't plan to guess at them.**

Affinity Photo, Designer and Publisher save in a proprietary, undocumented binary format. Serif has
not published a specification, there is no permissively licensed reader we could bundle, and the
format changes between versions (V1, V2 and the unified V3 app). Reverse-engineering it would give
fragile results that could silently lose work, and we won't ship that to schools.

**What to do instead** — export from Affinity into a format Quvrelo reads well:

| You have | In Affinity | Then in Quvrelo | What stays editable |
|---|---|---|---|
| A layered photo (.afphoto) | File › Export › **PSD**, preset "PSD (preserve editability)" | File › Open | pixel layers, groups, blend modes, opacity, text layers, vector masks |
| A vector design (.afdesign) | File › Export › **PDF** (preset "PDF (for export)") or **SVG** | File › Open (PDF) / File › Open or Place (SVG) | paths, colours, gradients, text, layers (PDF) |
| A publication (.afpub) | File › Export › **PDF** | File › Open (all pages) | every page as editable vectors and text |
| Anything, for print | File › Export › PDF/X-4 | File › Open | as PDF |

Affinity can also *open* Quvrelo's exports (PSD, PDF, SVG, PNG, JPEG), so work can go back the other
way. Tip for IT before a migration: Affinity Photo's **File › New Batch Job** can convert a whole
folder of files to PSD in one step.
