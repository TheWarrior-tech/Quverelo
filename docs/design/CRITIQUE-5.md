# Quvrelo UI critique: design review 5 (sign-off check for criteria 10 + 11)

Reviewer: independent senior product-design critic · 2026-10-15 · `main` @ `e60fff4`

**Captures.** `/workspace/work/review-v5/*.png`: 138 frames (`INDEX.txt`), taken at 15:33 UTC on the integrated critique-4 build. They include `6bffc5f` (device-pixel canvas chrome) and `cb3c00f` (review-extra spec). The set is:
- 46 surfaces × dark / light / high contrast, at 1440 × 873;
- the 8 new surfaces critique 4 asked for: `layers` (unobstructed), `layers-add-menu`, `assets`, `font-picker`, `photo-appearance`, `photo-shapes-flyout`, `welcome-checklist` (part done) and `new-templates`;
- 24 device-scale frames: `welcome`, `photo`, `vector` and `layout` at **150 %** (2160 × 1310) and **200 %** (2880 × 1746) in all three themes.

**Boards.** `/workspace/work/boards-v5/*.png`: 33 side-by-side boards. There are 11 patterns, each in 3 themes, with the Mobbin reference on the left, Quvrelo on the right, and a zoomed detail row. The patterns are:
- Figma: editor shell, tool rail, export, shape menu;
- Framer: inspector, layers;
- Linear: command palette, new issue;
- Notion: home;
- Pitch: empty state, tooltip.

The boards stay out of git for licensing reasons. `docs/design/BOARDS.md` and `scripts/compare-boards.config.json` list every pair and its Mobbin URL, and say how to regenerate them. That is the form critique 4 §5 accepted.

I opened every frame and every board. For detail checks I cropped regions and blew them up 2–4× with nearest-neighbour scaling: the text section, the palette search glyph, the export colour line, the rulers, handles and hairlines at 150/200 %, and the Assets grid.

**Yardsticks:** Linear, Figma, Framer, Affinity V3 and `docs/design/refs/MOBBIN.md`.

**Severity:** the same as in reviews 1–4.
- **P0:** a pro notices it within 10 s, or it reads broken or fake.
- **P1:** it reads generic or amateur, breaks DESIGN.md, or makes a student stall.
- **P2:** polish.

---

## 1. Verdict: **SIGN-OFF**, for criteria 10 and 11, in all three themes

Critique 4 set four conditions for sign-off: R1, R2, N11 and the §5 evidence. All four landed, and each is backed by a test as well as a screenshot.

- **R1: high contrast now has one selection vocabulary.** "Selected" is a solid `#ffd400` fill with black ink. "Focus" is a yellow ring on a black row. The two never look alike again, on any surface:
  - `high-contrast-shortcuts.png`: the focused search field (ring) and the selected "All shortcuts" row (fill) are now unmistakable.
  - The same holds in Preferences (`high-contrast-preferences-general.png`), the Export format list (`high-contrast-export-pdf-vector.png`), and New-document categories and tiles (`high-contrast-new.png`, where the olive wash is gone).
  - It also holds in Layers (`high-contrast-colour.png`), the flyout and the palette.
  - The rule is written once (DESIGN §9), linted (`20865ff`), and checked by computed style in `tests/e2e/hc-selection.spec.ts`.
- **R2: the active layer is no longer the object selection.** `*-crop.png` and `*-object-select.png` show a fresh open with the Background row active and the status bar reading `Layer Background`. There is no "Select a layer to adjust" dead end any more. Covered by `critique4-state.spec.ts` "R2: …".
- **N11: text has a home in the inspector.** `*-layout-mm-selected.png` shows a TEXT section: font · style + size · leading + tracking · alignment · *More type options*. The context bar is the one quick text set. The floating toolbar no longer repeats font and size. That is the split Figma and Framer use. Covered by `critique4-state.spec.ts` "N11: … exactly one font trigger outside it".
- **§5 evidence: delivered.**
  - The 33 boards exist in all three themes.
  - 150 % and 200 % captures exist for four screens in all three themes, and they are crisp. Rulers, page edge, margins, bleed, the selection box, handles and the Photo selection outline all land on whole device pixels (checked at 4×). This is the effect of `6bffc5f`'s `hairline()`.
  - Every frame critique 4 listed as missing is now in the set.

Since review 4, the remaining critique-3/4 P2 backlog went from 15 open items to 1 partly done (see §3).

**Dark and light** hold up next to Figma and Affinity V3 on every surface, side by side. **High contrast** now reads as a deliberate accessibility theme, not an inversion. It is the theme in which focus is clearest.

What is left (§4) is all **P2**. Nothing I found reads as generic or AI-made, nothing breaks a core task, and nothing would make a pro stop within 10 s. Two of the P2s are one-line fixes on surfaces critique 4 brought in, and I would like them in the next commit:
- P2-27: the half-filled alignment track;
- P2-28: the zoom glyph used as the search glyph.

Neither blocks sign-off.

## 2. Scores (1–10)

| Theme | Premium feel | Modernity | Intuitiveness (first-time student) | Consistency |
|---|---|---|---|---|
| Dark | **8.5** (8.5) | **8.5** (8.5) | **8.5** (8) | **8.5** (8.5) |
| Light | **8.5** (8.5) | **8.5** (8.5) | **8.5** (8) | **8.5** (8.5) |
| High contrast | **8** (8) | **8** (8) | **8** (7.5) | **8.5** (7.5) |

Review-4 scores are in brackets. Bar: ≥ 8 premium, ≥ 8 consistency and ≥ 8 intuitiveness in every theme. **All three themes pass.**

**Dark and light: intuitiveness 8 → 8.5.** A student who opens a photo now has an active layer whatever tool they pick first. Type has a persistent, labelled panel. Crop starts at the photo's own ratio. Stroke width is disabled while Stroke is None. Object Select explains itself in words ("Click an object · click again to add · Alt-click to remove") instead of three bare icons. Consistency holds at 8.5, not 9, because of the small dialect splits in §4:
- three ways to say "transparent background" (P2-31);
- three shortcut-chip styles (P2-32);
- mixed glyph styles in the Assets library (P2-30).

**High contrast.**
- *Consistency, 7.5 → 8.5.* One selection rule everywhere. Disabled is a dashed white edge plus `#8f8f8f` ink, never olive. The Curves grid is dim (`--c-plot-grid`), so it no longer slices the histogram.
- *Intuitiveness, 7.5 → 8.* Focus is never ambiguous now.
- *Premium stays at 8, not 8.5.* Yellow carries both "selected" and "primary action", so a busy frame shows six to eight yellow blocks at once (`high-contrast-crop.png`: Crop tool, Layers tab, the Background row, Thirds, Apply, Adjust tab, Photo studio, Export). This is legible and correct, but it flattens the hierarchy (P2-36).

### Side-by-side read (boards-v5)

| Board | Verdict vs reference |
|---|---|
| editor-shell vs Figma | Same anatomy and density (rail, left tabs, 36 px context bar, right inspector, status bar). Quvrelo is denser and more pro-oriented, with no wasted chrome. **At par.** |
| tool-rail vs Figma bottom toolbar | Single-grid stroke icons, corner flyout carets, active = solid fill. **At par.** The HC rail is cleaner than any HC mode Figma ships (it has none). |
| inspector vs Framer | The section rhythm, inline-labelled fields and unit-in-header match Framer. Framer's "+ to add a section" progressive disclosure is better than Quvrelo's dead-end "Effects None" (P2-34). **Near par.** |
| layers vs Framer | Row height, thumbnails, hover-revealed toggles and a full-width name all match. **At par.** |
| command-palette vs Linear | Layout, keycaps, group labels, footer hints and matched-letter weight all match Linear. The search glyph is wrong (P2-28). **At par after a one-line fix.** |
| modal-export vs Figma | Quvrelo's export dialog (format list · options · live preview with size estimate) is better than the reference. **Above par.** |
| modal-new vs Linear | Fields are concise and Cancel/Create sit bottom-right. It adds a live page preview and a px-at-dpi footer. **Above par.** |
| home-welcome vs Notion | Calm, typographic and table-like recents, with a checklist that teaches shortcuts. No hero, no gradient. **At par.** |
| empty-state vs Pitch | Pitch uses a 3D illustration. Quvrelo uses a quiet command card with keycaps, which is the correct choice for a pro tool. **At par.** |
| tooltip vs Pitch | Name plus keycap plus one-line hint. **At par.** |
| menu vs Figma shape menu | Same row anatomy (check · icon · name · key). The HC checked-vs-focused split is clearer than Figma's. **At par.** |

Board-set residue: every reference is a light-mode Mobbin frame, including on the dark and HC boards. Critique 4 asked for HC to be set beside the reference's dark mode. Figma and Linear dark frames are on Mobbin, and swapping them in would make the dark boards fairer (P2-37). This does not block sign-off: the comparison is about pattern and density, and those read clearly.

---

## 3. CRITIQUE-4 items: status at `e60fff4`

| # | Item | Status | Evidence / residue |
|---|---|---|---|
| **R1** (P1) | HC selected = focus outside the flyout | **Resolved** | `high-contrast-shortcuts.png` (search ring vs yellow nav fill), `-preferences-general.png`, `-export-pdf-vector.png` (PDF row filled, no ring), `-new.png` (Print + A4 filled, Name field ringed), `-colour.png` (Rectangle layer row filled), `-palette.png`. One rule in `styles.css`, documented in DESIGN §9, linted (`20865ff`), with computed-style e2e in `hc-selection.spec.ts` |
| **R2** (P1) | Photo active layer lost on open/deselect | **Resolved** | `*-crop.png`, `*-object-select.png`, `*-photo.png`: the Background row is active and the status reads `Layer Background`. `ui.activeLayerId` (`57bd807`), with e2e in `critique4-state.spec.ts:24` |
| **N11** (P1) | Text has no inspector home and two quick homes | **Resolved** (residue P2-27) | `*-layout-mm-selected.png`: TEXT section (Inter · Semibold · 17.5 pt · 1.3× · 120 · alignment · More type options) and "Text frame" (renamed from "Columns and links"). Font and size appear once outside the inspector (context bar), and the floating toolbar keeps only arrange/duplicate/delete. e2e in `critique4-state.spec.ts:47` |
| §5.1 | Side-by-side boards vs Mobbin | **Resolved** | 33 boards in `/workspace/work/boards-v5/`; pairs and URLs in `BOARDS.md` and the config. Residue P2-37 (light-only references) |
| §5.2 | 150 % / 200 % captures | **Resolved** | 24 frames; hairlines, rulers and handles are crisp at 4× zoom |
| §5.3 | Missing frames | **Resolved** | `*-font-picker`, `*-assets`, `*-layers-add-menu`, `*-photo-appearance`, `*-photo-shapes-flyout` and `*-welcome-checklist` (2/5) are all present |
| §5.4 | Re-capture `layout-mm-selected` | **Resolved** | "17.5 pt" fits in all three themes |
| P2-17 | PDF page size ignores Output DPI | **Resolved** | `*-export-pdf.png`: 107 × 71.8 mm for 1264 × 848 px at 300 dpi |
| P2-18 | Adjustment eye hidden at rest | **Resolved** | `*-photo.png`: the Curves and Vibrance headers show the eye at rest, and ⋯ appears on focus (`*-curves.png`) |
| P2-19 | Colour popover over the top bar | **Resolved** | `*-colour-popover.png`: it opens below the context bar, beside the selection |
| P2-20 | Title Case presets | **Resolved** | `*-new.png`: "A6 postcard", "DL flyer", "Business card", with a test |
| P2-21 | Zero-count shortcut groups | **Resolved** | `*-shortcuts-search.png`: only "File 3" remains while searching |
| P2-22 | Link-frame button styles | **Partly** | both are now the same quiet text style, and Unlink is disabled with no link. But neither reads as a button: the bare text has no hover or affordance at rest (P2-33) |
| P2-23 | Curves Input/Output "0" | **Resolved** | `*-photo.png`: "–" in disabled fields |
| P2-24 | 12.7 mm A4 margins | **Resolved** | `*-new.png`, `*-layout-mm.png`: 15 mm |
| P2-25 | "All 2" | **Resolved** | `*-export-pdf-vector.png`: "All (2)" |
| P2-26 | Vibrance title repeated | **Resolved** | `*-photo.png`: the slider label is "Amount" |
| P2-2 (c3) | Crop 4:3 on a 3:2 photo | **Resolved** | `*-crop.png`: Ratio **Original**, 1085 × 728 |
| P2-9 (c3) | Stray Ungroup | **Resolved** | `*-layout.png`, `*-curves.png`: the Move bar shows only flip and rotate for a single layer |
| P2-10 (c3) | Two page navigators | **Resolved** | `*-export-pdf-vector.png`: only the context bar's "Page 1 of 2" |
| P2-11 (c3) | Margin order | **Resolved** | the context bar and Document setup both read T · B · L · R (`*-layout-mm.png`, `*-layout-mm-document-setup.png`) |
| P2-12 (c3) | Stroke width live with Stroke None | **Resolved** | `*-vector.png`, `*-colour.png`: W is disabled (HC: dashed edge) |
| P2-13 (c3) | Unlabelled Object Select modes | **Resolved** | `*-object-select.png`: a written hint replaces the bare icons |
| P2-14 (c3) | HC Curves grid | **Resolved** | `high-contrast-curves.png`, `high-contrast-photo.png`: a dim plot grid; the histogram reads through it |
| P2-16 (c3) | Layer names cut early | **Resolved** | `*-layers.png`: names run to the row edge ("Thirty projects from Year 8, from water filt…") |
| c2 P2-13 | "G" label; white chip with Transparent ticked | **Resolved** | "Gutter" and "Columns" are written out. `*-document-setup.png` shows a checker chip when Transparent is ticked |
| c4 §1 | Olive wash on HC tiles | **Resolved** | no olive anywhere (`hc-selection.spec.ts` asserts it) |

**Tally:**
- Critique-4 P1s and evidence: 7 of 7 resolved.
- Critique-4 P2s: 9 resolved and 1 partly done (P2-22).
- Critique-3 carry-overs: 8 of 8 resolved.
- Earlier carry-overs: 1 of 1 resolved.

---

## 4. New and remaining issues (all P2; none blocks sign-off)

Numbering continues from critique 4.

**P2-27 · The text alignment control fills only half its track.** *(do next)*
- Screenshots: `dark-`, `light-` and `high-contrast-layout-mm-selected.png`, inspector › TEXT. The four alignment segments occupy about 45 % of a full-width track, and the right half is an empty grey (HC: black-bordered) bar.
- Cause: `TextSection.tsx:79` passes `full`. But icon-only segments get `.segmented button.icon-seg { flex: none; width: 28px }` (`panels.css:546`), which overrides `.segmented.full`'s even share.
- Fix, in `panels.css`: `.segmented.full button.icon-seg { flex: 1; width: auto; }`.
- Add an e2e check that each alignment button is ≥ 25 % of the group width minus the gaps.

**P2-28 · The command palette and font picker use the Zoom glyph as their search glyph.**
- Screenshots: `*-palette.png` (zoomed 8×: a magnifier with a "+" inside, the same as the rail's Zoom tool) and `*-font-picker.png`. The top-bar "Search commands" and the Welcome search use the correct `search` glyph, so the two dialects sit one click apart.
- Fix: change `CommandPalette.tsx:154` and `controls/FontPicker.tsx:97` from `<Icon name="zoom">` to `<Icon name="search">`.
- Add to `shellLint.test.ts`: `name="zoom"` is allowed only in zoom commands and tools.

**P2-29 · A hyphen in tabular text is spaced as a figure.**
- Screenshot: `*-export.png`, Colour reads "sRGB · 8 - bit" (zoomed: the hyphen sits in a figure-width cell).
- Cause: `.value-text` sets `font-variant-numeric: tabular-nums` (`dialogs.css:241`), and Inter's `tnum` gives the hyphen a figure advance.
- Fix: drop `tabular-nums` from `.value-text`, and add the existing `.num` class only where the value is numeric (dimensions, file size, counts).
- While there, use one order for colour everywhere. Export says "sRGB · 8-bit"; New document says "RGB · 8-bit · sRGB". Pick "RGB · 8-bit · sRGB".

**P2-30 · The Assets library mixes two glyph styles and two header styles.**
- Screenshot: `*-assets.png`. Fourteen shapes are solid silhouettes, while "Book" (and in part "Pencil") renders as an outline. Next to the line-icon UI the solid set reads clip-art-ish. In HC (`high-contrast-assets.png`), fourteen solid white tiles are the loudest thing on screen.
- Headers: "DOCUMENT 20" has no collapse chevron, "SHAPES & SYMBOLS" has a chevron but no count, and "IMAGES 0" has both.
- Fix:
  - Render every preview in one style. Either all filled (close the Book path as a solid silhouette), or better, all as 1.5 px-equivalent outlines in `text-2` (`fill:none; stroke-width:6` on the 100-unit box at the 24 px tile) to match `Icons.tsx`.
  - HC tiles: a black tile with a 1px white edge and white glyph, as with every other HC tile.
  - All three sections use `<Section>` with chevron + count ("Shapes and symbols 16").

**P2-31 · There are three controls for "transparent background".**
- Screenshots:
  - New document: segmented *White | Transparent* (`*-new.png`);
  - Document setup: colour chip + "Transparent" checkbox (`*-document-setup.png`);
  - Export: segmented *Page colour | Transparent* (`*-export.png`).
- Fix: one `BackgroundField` in `dialogs/controls.tsx`, a segmented *Colour ▢ | Transparent* where the Colour segment carries the chip. Use it in all three dialogs, and document it in DESIGN §8.

**P2-32 · There are three shortcut-chip dialects.**
- Per-key keycaps: palette, Shortcuts, Welcome, tooltips and the empty-page card.
- One mono chip "Shift+U": the Photo shapes flyout (`*-photo-shapes-flyout.png`).
- Plain "Ctrl+Shift+N": the Layers + menu (`*-layers-add-menu.png`).

Plain text in a menu is acceptable (native menus do it), but the flyout chip is a third style.
- Fix: the flyout renders `<Keys combo>` like the palette.
- Also in the Photo flyout, three members all advertise "Shift+U", which reads as three tools sharing one key. Show `U` on the group's shown member only, plus a `text-3` footer row "Shift U cycles shapes". This matches DESIGN §8's own rule that the cycle key lives in the tooltip.

**P2-33 · The text-frame link actions have no affordance.**
- Screenshot: `*-layout-mm-selected.png`, Text frame › "Link frames" / "Unlink" is bare text.
- Fix: `btn sm ghost` with a 16px link / unlink icon (the critique-4 ask), keeping Unlink disabled when there is no link.
- Also add the unit to the section header ("TEXT FRAME mm") as Transform does, because "Gap 4.2" and "Inset 0" are otherwise unitless.

**P2-34 · Photo › Design › Effects is a dead end.**
- Screenshot: `*-photo-appearance.png`. "Effects None" has no way to add one, and the Vector and Layout inspectors have no Effects row at all.
- Fix (Framer pattern, `inspector` board): an "Effects" header with **+** (Drop shadow · Outer glow · Blur), listing the active effects as rows with eye + ⋯ like the adjustment cards. Hide the row entirely where no effects are supported.

**P2-35 · Welcome checklist.**
- Screenshot: `*-welcome-checklist.png`, at 2/5. The progress bar lights segments 1 and 4 (step-mapped), which reads as a glitch. Fill left to right by count.
- "Place an image" (Ctrl Shift P) and "Select a subject" (W in Photo) have no keycaps, while the other three rows do. Add them.

**P2-36 · In high contrast, yellow is both "selected" and "primary".**
- Screenshot: `high-contrast-crop.png`, with eight yellow blocks: tool, tab, layer row, Thirds, Apply, Adjust tab, studio switch and Export.
- Fix (low effort): in HC, keep the solid primary only in dialog footers and the context bar's commit action (Apply). The persistent top-bar **Export** becomes a 1px white-bordered button with white ink, since it is permanent chrome, not the next step. Add this to DESIGN §9.

**P2-37 · Board references are light mode on every board.**
Swap the dark and HC boards' references to Mobbin dark-mode frames (Figma and Linear both have them) via `compare-boards.config.json` `ref.mobbin_dark`.

**P2-38 · Small copy and labels.**
- `*-about.png`: "linux · arm64" should read "Linux · ARM64" (use a display map: `win32` → Windows, `darwin` → macOS, `x64`, `arm64` → ARM64).
- `*-new-templates.png`: the "Blank A4" preview shows a plain page while its description says "with margins and bleed". Draw the margins as the Print-tab A4 preview does.
- `*-document-setup.png`: the inline-label gap is ragged ("Columns 1" vs "Gutter    16"). Give inline labels one fixed label column inside grid2 fields.
- `*-font-picker.png`: the "Caveat" preview renders at about 7 px x-height and is illegible. Normalise previews to a common x-height (scale by `xHeight/unitsPerEm`, clamped to 11–15 px).

---

## 5. What is now at reference level (additions since review 4)

- **High-contrast lists** (`high-contrast-shortcuts.png`, `-new.png`, `-export-pdf-vector.png`): selected and focused are now as clear as Windows' own High Contrast Black, and more consistent.
- **Inspector Text section** (`light-layout-mm-selected.png`): Figma-grade structure, with the font picker previewing each face in itself (`*-font-picker.png`) and leading/tracking as icon fields with tooltips.
- **Photo inspector** (`*-photo-appearance.png`): a Pixel layer card with an honest `Pixels 1264 × 848` and the same Transform grid as Vector.
- **Layers + menu** (`*-layers-add-menu.png`): a disabled "Group selection" with its reason underneath ("Select two or more layers"). That is better than Figma, which simply greys it out.
- **Device-scale rendering** (`*@150.png`, `*@200.png`): every canvas hairline is snapped, and the chrome scales with no blurred 1.5 px lines. This matches Affinity V3 on Windows at 150 %.
- **Export** (`modal-export-*` boards): it beats the Figma reference on preview, size estimate and format teaching.

## 6. Next, in order (polish only)

1. P2-27 (alignment track) and P2-28 (search glyph), both one-liners.
2. P2-29 (tabular hyphen) and P2-32 (shortcut chips), for consistency.
3. P2-30 (Assets glyphs) and P2-31 (Background field), for dialect clean-up.
4. P2-33 to P2-38.

Signed off for criteria 10 and 11 at `e60fff4`: dark, light and high contrast; welcome, all three studios, every panel captured, dialogs, export and preferences, at 100 / 150 / 200 %, with side-by-side boards against Mobbin references.
