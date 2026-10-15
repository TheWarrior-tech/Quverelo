# Quvrelo UI critique: design review 3 (sign-off check for criteria 10 + 11)

Reviewer: independent senior product-design critic · 2026-10-15 · `main` @ `ea63147` (v0.4.0)
Captures: `/workspace/work/review-v3b/*.png`, 78 frames at 1440×873: dark / light / high-contrast × welcome, welcome-templates, photo, vector, layout, new, new-templates, export, export-pdf, export-pdf-vector, document-setup, confirm, preferences, preferences-general, shortcuts, shortcuts-search, about, colour, colour-popover, crop, curves, object-select, palette, tooltip, flyout, empty-canvas. Every frame was opened and read.
The captures were taken at 12:08 UTC, before the version-bump commit (`ea63147`, 12:33), so About shows "Version 0.3.0". No UI code changed between the two, so the captures are valid evidence for v0.4.0. Re-capture them anyway so the evidence matches the release.
Yardsticks: Linear, Figma, Framer, Affinity V3, and the written patterns in `docs/design/refs/MOBBIN.md`.
Severity is the same as reviews 1 and 2:
- **P0**: a pro notices within 10 s, or it reads broken or fake.
- **P1**: it reads generic or amateur, breaks DESIGN.md, or makes a student stall.
- **P2**: polish.

---

## 1. Verdict: **NOT YET**

This is the strongest build so far, and the critique-2 work landed almost to the letter:
- One `Segmented` everywhere, with a readable dark active tile and no olive wash in HC.
- One colour popover body.
- Themed `::selection`.
- White page thumbnails.
- Yellow HC canvas handles.
- A centred studio switch and a visible *Search commands · Ctrl K* field.
- A real Snap toggle.
- Text frames with no resting outline, and text layers named by their content.
- Sentence-case chrome.
- A cleaned-up Curves panel and histogram header.
- An honest Export that offers PDF as real vectors, *Image PDF* as a separate option, and Area, Scale and File name, and states "RGB · not PDF/X".

Chrome consistency in dark and light now reaches the bar.

Sign-off still fails on three counts:
1. **The headline ML feature visibly misfires in its own showcase frame (P0).** A click on the cottage in `*-object-select.png` produces a lumpy blob of hillside about 3× the size of the house.
2. **Intuitiveness is below 8 in every theme:**
   - Print documents are measured in px everywhere.
   - Photo opens into "no active layer" states where the Adjust tab says *Place a photo…* with a photo on screen, and the status bar says *Nothing selected* while marching ants run.
   - The Layout context bar is clipped mid-word.
   - Curves shows two identical reset icons.
   - The Export scale "×" suffix looks like a clear button.
3. **High contrast is still below 8 on premium and consistency:**
   - Crop handles and the Object Select click marker stay teal.
   - Focused and checked flyout rows are both yellow outlines.
   - The Curves grid is drawn full-white over the histogram.

Each of these is small and specific. Fix the P0, the nine new P1s and the HC P1 below, and I expect to sign off at review 4.

## 2. Scores (1–10)

| Theme | Premium feel | Modernity | Intuitiveness (first-time student) | Consistency |
|---|---|---|---|---|
| Dark | **8** (7.5) | **8.5** (8) | **7.5** (7) | **8** (6) |
| Light | **8** (7.5) | **8.5** (8) | **7.5** (7) | **8** (6.5) |
| High contrast | **7** (6.5) | **7.5** (7) | **7.5** (7) | **7** (5.5) |

Review-2 scores are in brackets. The bar is ≥ 8 premium, ≥ 8 consistency and ≥ 8 intuitiveness in every theme.

**Dark** meets premium and consistency. It is calm graphite with an accent used sparingly, the selection wash is now teal, and the segmented tiles read at a glance. It is held back by:
- the Object Select result;
- clipped dialog content with native stepper arrows on the scrollbars;
- the doubled Curves reset.

**Light** is level with dark. It photographs best: the Export, New Document and Colour frames could sit in a Figma marketing page. It is held back by:
- crop dimming that turns the whole light pasteboard dark grey;
- the invisible white "Paper" layer thumbnail.

**High contrast** is a solid, honest accessibility theme, and the yellow canvas handles, segments and tabs are right. Three of the canvas overlays still ignore it, though, and the flyout cannot tell focus from checked.

Intuitiveness is the same in all three themes because its blockers are behavioural (units, active layer, clipped bar), not colour.

---

## 3. CRITIQUE-2 items: status at `ea63147`

| # | Item | Status | Evidence / residue |
|---|---|---|---|
| P0-1 | PDF "print-ready" plus rasterised | **Resolved** | `*-export-pdf-vector.png`: PDF "Vectors and live text" with fonts embedded and text selectable, Area, Crop marks, "RGB · not PDF/X". `*-export-pdf.png`: "Image PDF · One picture per page". Residue: PDF page size is still in px (`1264 × 848 px`), see N1 |
| P1-1 | Three segmented implementations | **Resolved** | the dark Export "Current page / Transparent" tiles are clearly on. HC is yellow. HC disabled-active "Stable" is a black tile with a dashed outline and no olive (`high-contrast-preferences-general.png`). Curves uses the shared control |
| P1-2 | Curves empty fields, Reset in the track, heavy ghost | **Resolved** | `*-curves.png`: Input/Output 0/0, end knobs, lighter ghost, Reset outside the track. Introduced a duplicate reset icon (new N3) |
| P1-3 | Two colour pickers | **Resolved** | `*-colour.png` and `*-colour-popover.png` show the same body (None·Solid·Linear·Radial, Box/Wheel, Hex, swatches). Placement regressions are new N6 |
| P1-4 | Opacity/Blend two homes | **Resolved** | the Photo Layers header row is gone (`*-photo.png`). Photo › Design › Appearance with a pixel layer was not captured, so add a frame |
| P1-5 | OS-blue text selection | **Resolved** | `*-new.png`: "Untitled" on a teal wash (HC yellow with black ink) |
| P1-6 | Grey slab page thumbnails | **Resolved** | `dark-new.png` shows paper. HC unselected pages read light grey (88 % white on black) with no visible edge, which is acceptable |
| P1-7 | Text frames dashed at rest; "Text Frame" names | **Resolved** | `*-palette.png` and `*-tooltip.png`: no resting outlines; layers read "Free entry", "Thursday 14 March", "Year 8 Science Fair" |
| P1-8 | Mixed casing | **Partly** | chrome resolved ("Don't save", "Check now", "Document setup…"). Still Title Case: template names (`*-welcome-templates.png`, `*-new-templates.png`: "Social Graphic", "Presentation Slide", "Lesson Plan", "Blank US Letter") and Shortcuts tool names ("Marquee Rect", "Rect", `*-shortcuts.png`) |
| P1-9 | No visible command entry | **Resolved** | "Search commands Ctrl K" in every workspace frame |
| P1-10 | No shapes in Photo | **Resolved (code + e2e, `058c27d`)** | not visible in any capture. Add a Photo shapes-flyout frame |
| P1-11 | Export void, no Area/Scale | **Resolved** | `*-export.png`: File name, Area, Scale + W px, and the dialog hugs its content. The scale control is now over-built (new N5) |
| P1-12 | HC canvas handles teal | **Partly** | object handles are yellow (`high-contrast-vector.png`, `high-contrast-curves.png`). Crop edge handles and the Object Select click marker are still teal (`high-contrast-crop.png`, `high-contrast-object-select.png`), see N10 |
| P1-13 | Histogram clipped and saturated | **Resolved** | header "HISTOGRAM · Colours ▾", padding, thin channel lines |
| P2-1 | Studio switch off-centre | **Resolved** | the switch centre is at about x = 721 of 1440 |
| P2-2 | Snap as text | **Resolved** | magnet toggle. Zoom-as-menu not evidenced |
| P2-3 | Prefs booleans, clipped last row, thin sections | **Open** | `*-preferences-general.png`: "Autosave On" is still a bare word with the checkbox far right; "Software update / Check now" is cut by the footer; no scroll-edge shade; still four sections |
| P2-4 | Shortcuts search | **Partly** | the light clear-× is now neutral. Still no match highlight, nav counts don't follow the filter (90/11/23…), and there's a 400px void (`*-shortcuts-search.png`) |
| P2-5 | Accent used for status | **Open** | the "Edited" dot and toast dot are still accent. DESIGN §8 now codifies the accent Edited dot, which contradicts §2 rule 4 |
| P2-6 | Assets glyph cards | **Unverified** | no Assets capture |
| P2-7 | Assets tab focus sliver | **Unverified** | no Assets capture |
| P2-8 | Rainbow default swatches | **Open** | `*-colour.png`: a 20-hue saturated row |
| P2-9 | Done accent-filled | **Resolved** | default button in Preferences/Shortcuts/About |
| P2-10 | Literal radii | **Resolved** | `--r-hairline` plus lint (`05553fb`) |
| P2-11 | "Rectangle" + "RECTANGLE" | **Open** | `dark-vector.png` |
| P2-12 | Fuzzy noise | **Open** | `dark-palette.png`: "exp" still returns *Convert to Curves* |
| P2-13 | Doc setup "G"; Background chip vs Transparent | **Open** | `dark-document-setup.png`: "G 16"; a white chip with Transparent ticked |
| P2-14 | Number precision | **Open** | `dark-palette.png`: inspector `793.7 × 1122.52 px` vs status `793.7 × 1122.5 px` |
| P2-15 | Page edge on non-print Layout | **Partly** | `*-empty-canvas.png` (print doc) is excellent: edge, coral margins, dashed bleed. A photo doc in Layout (`*-layout.png`) still shows no page edge |
| §6 | Re-capture components in v3 | **Resolved** | crop, palette, tooltip, flyout, empty canvas, curves and object select are all in v3, in all themes |
| §6 | Side-by-side vs Mobbin references | **Open** | `docs/design/review/` holds Quvrelo frames only, no `compare-*.png`. Criterion 11 asks for this explicitly |
| §6 | 150 % / 200 % captures | **Open** | none. Pixel snapping at higher DPR is still unevidenced |

**Tally:**
- P0: 1/1 resolved.
- P1: 11 resolved, 2 partly done.
- P2: 5 resolved, 3 partly done, 5 open, 2 unverified.

---

## 4. New issues

### P0

**N0 · Object Select misfires in its own showcase frame.** (`dark-object-select.png`, `light-object-select.png`, `high-contrast-object-select.png`)
*Problem:* The click marker sits on the white cottage. The marching ants enclose a rounded blob about 160×140 px of hillside and grass around it, about 3× the house, with no edge following the walls or roof. That is the one frame a buyer or reviewer looks at for "custom ML selection" (GOAL criterion 7), and it reads as a fake feature. The action strip below (*Remove background · Mask · Copy to layer…*) invites the user to act on a wrong mask.
*Fix:*
1. Reproduce with the capture's click point on `sample-photo.jpg`. Dump the raw mask, the logits resolution and the threshold.
2. The blob shape suggests a low-resolution mask thresholded after nearest or blurred upsampling, or a wrong prompt-to-image coordinate mapping (scale/letterbox offset at a 60 % view). Map the click through the same resize/pad transform as the encoder input, upsample the logits bilinearly to full resolution *before* thresholding at 0, then run the edge-refine step (guided filter) on the result.
3. Add a regression test in `tests/unit` or `ml/`: a click on the cottage gives IoU ≥ 0.8 against a hand-drawn cottage mask, and the selected area is under 1.5× the cottage bbox.
4. Draw the marching ants from the mask contour (marching squares at full resolution), not a smoothed hull.
5. Until this passes, keep the review frame honest. Do not swap the click target to hide it.

### P1

**N1 · Print documents are measured in px everywhere.** (`dark-empty-canvas.png`, `dark-palette.png`, `dark-export-pdf-vector.png`, `dark-document-setup.png`)
*Problem:*
- New Document shows A4 in mm (`dark-new.png`: 210 × 297 mm).
- The moment the document opens, the inspector says `793.7 × 1122.52 px`, the status bar `793.7 × 1122.5 px` and Units `px`.
- The Layout context bar margins read `48`/`57` px and bleed `11` px.
- PDF export reports `Page size 1264 × 848 px`.

A student who typed 15 mm margins sees 57. Affinity Publisher and InDesign keep the document unit.
*Fix:*
- Store `doc.unit` at creation (mm for Print presets, px for Screen/Social). Make the status-bar Units select default to it.
- Inspector › Document Size, Transform, the context-bar margins/bleed, Document setup and PDF Page size all format through `controls/numeric.ts` in `doc.unit`, with px as a `text-3` hint where useful ("210 × 297 mm · 2480 × 3508 px at 300 dpi").
- The PDF page size is in mm (pt in the tooltip).
- Add an e2e check: an A4 doc from the Print preset shows "210" in the inspector W field.

**N2 · The Layout context bar overflows and clips mid-word at 1440px.** (`dark-empty-canvas.png`, `light-empty-canvas.png`, `high-contrast-empty-canvas.png`: "Margins T L B R · Bleed · Co|")
*Problem:* `.contextbar` is `overflow-x:auto` with the scrollbar hidden (`styles.css:560-576`), so Columns/Gutter are cut off with no affordance at the reference window width.
*Fix:*
- Take Margins/Bleed/Columns out of the Layout Move context bar. They are document properties already in Document setup.
- Leave Page ‹ n of N › + and a ghost "Margins & columns…" button that opens Document setup on that section.
- If they must stay, make the context bar a priority+ row: groups that don't fit collapse into a trailing "More ▾" menu.
- Add an e2e check: `scrollWidth ≤ clientWidth` for `.contextbar` in every studio/tool at 1280 and 1440.

**N3 · Curves shows two identical "undo" reset icons 32px apart.** (`dark-curves.png`, `light-curves.png`, `high-contrast-curves.png`)
*Problem:*
- `AdjustmentsPanel.tsx:147` puts *Reset Curves* on the adjustment header.
- `CurvesEditor.tsx:328` puts *Reset the RGB curve* beside the channel switch.
- Same glyph, same size, stacked. A student can't tell which one does what.

*Fix:* the adjustment header gets visibility (eye) plus a `⋯` menu (*Reset all channels* · *Delete adjustment*). That is the pattern for every adjustment card. Only the channel row keeps the `undo` icon button, with its tooltip ("Reset Red curve").

**N4 · Photo has states with no active layer, and the UI contradicts the canvas.** (`dark-crop.png`, `dark-object-select.png`, and the light and HC versions)
*Problem:*
- With the photo on screen and Background unselected, the Adjust tab says "Select a pixel layer to add adjustments" with a **Place a photo…** button.
- The status bar says *Nothing selected* while marching ants are running.

Photoshop and Affinity always have an active pixel layer.
*Fix:*
- In Photo, `state/editor.ts` keeps an active layer invariant. On open, after crop/apply, and after deleting the active layer, activate the top-most pixel layer.
- The Adjust empty state is only for a document with no pixel layers. When pixel layers exist but none is active, show "Select a layer to adjust" with a ghost button "Select Background".
- Status bar: when a pixel selection exists, show `Selection 412 × 386 px` (tabular).

**N5 · Export scale is three controls for one value, and its "×" suffix reads as a clear button.** (`dark-export.png`, `light-export.png`)
*Problem:* `Scale [1          ×] [W 1264 px] [1× ▾]`. The suffix sits flush right, exactly where a clear-× lives in every search field, and the preset select repeats the field.
*Fix:* use one `NumberField` labelled "Scale":
- The value is followed directly by "×" in `text-3` (`1×`, left-aligned).
- A 20px chevron inside the field's right edge opens presets (0.5× · 1× · 2× · 3× · Custom width…).
- Keep "W px" as the linked field.
- Delete the separate select.

**N6 · The colour popover covers what it edits.** (`dark-colour.png`, `dark-colour-popover.png`, and the light and HC versions)
*Problem:*
- From the inspector, the popover's right edge sits about 85px inside the inspector. It hides the Fill/Opacity labels and the Transform X field, against DESIGN §8 ("opens to the *left* of the inspector so it never covers the panel").
- From the context bar, it lands on top of the selected rectangle, so the user can't see the colour change live. Figma places it beside the selection.

*Fix:*
- Inspector chips: `placement:'left'` with the anchor's x set to the inspector's left edge (`right = inspectorLeft − 8`), not the chip.
- Context bar and selection toolbar chips: compute the selection's screen bounds and choose the side (below/left/right) that doesn't intersect them; fall back to below.
- Add an e2e check that the popover rect doesn't intersect the selection rect or the inspector.

**N7 · Fixed-height dialogs clip their last row, and every dialog scrollbar shows native stepper arrows.** (`dark-preferences-general.png`, `dark-shortcuts.png`, and the light and HC versions: ▲/▼ at the top and bottom of the scroll track; "Software update" and "Deselect" cut by the footer)
*Problem:* the root cause is `styles.css:1233-1236` `* { scrollbar-width: thin; scrollbar-color: … }`. In Chromium 121+ the standard properties win over `::-webkit-scrollbar`, so the themed WebKit scrollbar (lines 1237 and 1534, which are also duplicated) is ignored and the native thin bar with arrows is drawn.
*Fix:*
- Wrap the standard properties in `@supports not selector(::-webkit-scrollbar) { … }`.
- Delete the duplicate `::-webkit-scrollbar` block at 1237-1250.
- Add the §6 scroll-edge shade to `.dialog-body` and the Preferences/Shortcuts panes, so a clipped row reads as "more below".
- Add the check to `shellLint.test.ts`.

**N8 · A bundled template ships with overflowing text.** (`dark-tooltip.png`, `dark-palette.png`, and the light and HC versions: a red **+** overflow port on the Event Poster at about (894, 601), at rest)
*Problem:* The first thing a student opens shows an error badge.
*Fix:*
- Fit the frame: enlarge the frame or shorten the copy in the Event Poster template.
- Add `tests/unit/templates.test.ts`, which loads every bundled template, lays out its text and asserts that no frame overflows.

**N9 · High contrast: the focused and checked flyout rows look identical.** (`high-contrast-flyout.png`: Rectangle (checked) and Ellipse (focused) both have a 2px yellow outline)
*Fix:*
- HC checked = `#ffd400` fill with black text and icon, matching the HC segmented and tab active state.
- HC focus = 3px yellow outline with a 2px offset (the §9 HC focus rule).
- Never use the same treatment for both.

**N10 · High contrast: crop handles, the Object Select click marker and the crop shade ignore the HC tokens.** (`high-contrast-crop.png`, `high-contrast-object-select.png`)
*Problem:* The crop edge handles and the click marker are teal `#2fb8a6`, although DESIGN §3 says every HC canvas selection is yellow. Crop corners are white brackets while edge handles are small teal squares, which is mixed vocabulary in every theme.
*Fix:*
- The crop overlay and the click marker read `--c-canvas-handle` / `--c-canvas-handle-ring` through `readOverlayColors`.
- Draw all eight crop handles in one style: L-brackets at corners and 12×3 bars at edges, all `--c-canvas-handle`.

### P2

1. **Light crop darkens the pasteboard.** (`light-crop.png`) The crop shade covers the whole viewport, so the light-grey pasteboard goes slate. Shade only the image outside the crop rect (Lightroom/Affinity), and leave the pasteboard untouched.
2. **The crop ratio defaults to 4:3 on a 3:2 photo.** (`dark-crop.png`) Default to "Original", and remember the last ratio per session.
3. **There are two simultaneous empty states with the same three actions.** (`dark-flyout.png`: the Layers rail shows "No layers yet" plus Place/Draw/Text, and the canvas card shows Place/Draw/Text) Keep the canvas card. When the canvas card is visible, the Layers empty state shrinks to the glyph, title and one line.
4. **Keyboard hints come in two dialects.** The canvas empty card ("Ctrl+Shift+P", "M", "T") and the welcome checklist ("Ctrl+N", "T") use plain text. The palette, tooltips and flyout use keycaps. Render all of them with the shared `<Keys>` component.
5. **The palette's top result has no icon.** (`dark-palette.png`, "Export") The other Export rows have the upload glyph. Give every command an icon, or none.
6. **The light "Paper" layer thumbnail is invisible.** (`light-palette.png`, white glyph on white) Layer thumbnails need a 1px inner `--c-line` frame, and the vector glyph tint should fall back to `--c-text-3` when the fill's contrast against the thumb is below 1.5:1.
7. **Confirm dialog title.** (`dark-confirm.png`) "Close document?" should read "Save changes to "sample-photo" before closing?" (the Figma/macOS pattern, which names the object).
8. **Sliders come in two dialects.** Preferences › Interface size ("100%") and PDF › Photo quality ("90%") show a plain-text value, while the inspector sliders pair with a number field. Use `SliderRow` (label 72 · track · 56px field) everywhere.
9. **Irrelevant context-bar actions.** A disabled "Ungroup" text button shows for a single pixel layer (`dark-curves.png`, `dark-layout.png`). Hide actions that cannot apply to the selection kind.
10. **The Layout page navigator is duplicated.** The context bar "‹ Page 1 of 2 ›" and a floating pill on the canvas both show (`dark-export-pdf-vector.png` background). Keep one: the canvas pill in Layout, matching Affinity Publisher.
11. **Margin order differs.** Document setup is T·B / L·R and the context bar is T·L·B·R. Pick one order everywhere and add the chain-link toggle (UX P2-5, still open).
12. **The stroke width field stays enabled while Stroke is None.** (`dark-vector.png` context bar "W 2 px") Disable it with the tooltip "Add a stroke first".
13. **Object Select mode icons are unlabelled.** The three bare icons after *Select subject* in the context bar (`dark-object-select.png`) should be a `Segmented` (New · Add · Subtract) with names in the tooltips, which is the documented mode pattern.
14. **HC Curves grid.** (`high-contrast-curves.png`) Full-white 4×4 grid lines cut across the histogram. In HC, use a 1px dotted white grid, and keep the solid white for the curve only.
15. **Dark template tiles.** The dark slide templates (Photosynthesis, Presentation Slide) sit on a near-black tile with almost no edge (`dark-welcome-templates.png`). Tiles get `--c-canvas`, and thumbnails get a 1px `--c-line` frame.
16. **Layer names cut twice.** The 24-character word cut is followed by a CSS ellipsis mid-word ("Thirty projects fro…"). Let the CSS do the only truncation, or cut to fit the 150px column.

---

## 5. Evidence still missing for criteria 10–11

- `docs/design/review/compare-*.png`, with Quvrelo beside a reference for six surfaces:
  - welcome vs Figma/Framer home
  - shell vs Figma editor
  - inspector vs Framer
  - palette vs Linear
  - dialog vs Linear settings
  - empty state vs Pitch

  Criterion 11 asks for side-by-side evidence. Text notes are not enough. Keep the references local if licensing requires it, but the comparison must exist.
- 150 % and 200 % device-scale captures of the shell and one dialog, for hairline crispness and pixel snapping.
- Frames for: Photo › Design › Appearance with a pixel layer; the Photo Shapes flyout; Layers + menu; the font picker; Assets; and Welcome with the checklist part-complete.
- Re-capture About on v0.4.0 (the current frame shows 0.3.0 because of capture timing).

## 6. What is now at reference level

- **Export dialog** (`light-export.png`, `light-export-pdf-vector.png`): the format list with one-line descriptions, live preview with file name and size, and honest PDF copy. This is as good as Figma's export and clearer than Affinity's.
- **Command palette** (`*-palette.png`): Linear-grade. Matched letters are bold, groups are right-aligned, there is a disabled reason ("Select an object first") and a key legend.
- **Top bar**: identity · centred studio switch · search field · quiet icon cluster · one Export primary. This is the Mobbin pattern 4 split executed cleanly.
- **Segmented controls and HC tabs**: one vocabulary across 20+ instances.
- **Layout empty page** (`dark-empty-canvas.png`): page edge, coral margins, dashed bleed, ruler margin bands and a teaching card. It reads like Publisher.
- **The tooltip** with its two-line "Drag to draw · Shift for a square" hint and keycap.

## 7. Path to sign-off, in order

1. **N0**: fix the Object Select mask (coordinate mapping and full-resolution upsample before threshold, then refine) plus the IoU regression test.
2. **N1**: document units follow the preset (mm for print) in every readout.
3. **N4**: Photo always has an active layer; Adjust empty state and status bar tell the truth.
4. **N2**: no clipped context bar (move margins out, or add an overflow menu) plus the e2e check.
5. **N7**: the scrollbar CSS fix (two declarations) plus scroll-edge shade in dialogs.
6. **N3 / N5 / N6**: one reset per scope; a single Scale field; colour popover placement.
7. **N8**: fix the overflowing template plus the template overflow test.
8. **N9 / N10**: the HC flyout checked-vs-focus distinction and the HC crop/click-marker tokens.
9. Evidence: compare-*.png vs references, plus 150/200 % frames.

Then the P2 list, starting with P2-3 (Preferences booleans and clipping, which N7 partly solves), P2-12 (fuzzy) and P2-14 (one number formatter, which falls out of N1).
