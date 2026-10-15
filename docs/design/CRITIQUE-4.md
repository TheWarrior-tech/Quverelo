# Quvrelo UI critique: design review 4 (sign-off check for criteria 10 + 11)

Reviewer: independent senior product-design critic · 2026-10-15 · `main` @ `12c9e3d`
Captures: `/workspace/work/review-v4/*.png`, 93 frames at 1440×873. That is dark / light / high-contrast × the 26 review-3 surfaces plus five new ones: `layout-mm`, `layout-mm-selected`, `layout-mm-document-setup`, `layout-mm-export-pdf` (an A4 Event poster in mm) and `preferences-general-window`. I opened and read every frame.
Capture timing: most frames were taken at 13:48–13:51 UTC, after `1ff1646` and before `12c9e3d` (13:53, a CSS-only change that widens the selection-toolbar font-size field). The five `dark-layout-mm*` and `dark-preferences-general-window` frames were re-taken at 13:53 and show the fix. `light-` and `high-contrast-layout-mm-selected.png` still show "17.5" clipped to "17.ʒ". The fix is theme-independent (`shell.css` widths only), so I count it as resolved, but re-capture those two frames.
Yardsticks: Linear, Figma, Framer, Affinity V3, and `docs/design/refs/MOBBIN.md`.
Severity is the same as reviews 1–3:
- **P0**: a pro notices within 10 s, or it reads broken or fake.
- **P1**: it reads generic or amateur, breaks DESIGN.md, or makes a student stall.
- **P2**: polish.

---

## 1. Verdict: **NOT YET**. Dark and light pass; high contrast and the criterion-11 evidence do not

Almost every critique-3 item landed, and most landed well:
- **Object Select** now selects the cottage and only the cottage (`*-object-select.png`: an 86 × 60 px mask on the house; it was a 3× hillside blob before).
- **Units:** an A4 poster reads 210 × 297 mm in the inspector, status bar, rulers, context bar, Document setup and PDF export, with "2480 × 3508 px at 300 dpi" as the hint.
- **Layout context bar:** it no longer clips; it collapses into **More ▾**.
- **Curves:** one reset per scope, with eye + ⋯ on the card header.
- **Export:** a single Scale field.
- **Colour popovers** sit beside what they edit.
- **Scrollbars:** themed, with no native arrows, and dialogs have scroll-edge shades.
- **HC:** the flyout separates checked (yellow tile) from focused (ring), and the crop handles and click marker are yellow.

**Dark and light** now meet the bar (≥ 8 premium, consistency and intuitiveness). They hold up next to Figma and Affinity V3 at a glance and on a second look.

**High contrast** still misses consistency and intuitiveness, for one systemic reason. The N9 fix was applied to the flyout only. Everywhere else in HC, a **selected** row is drawn as a 2px yellow outline, which is the same as the **focus** ring. This affects the Layers rows, the Preferences/Shortcuts nav, the Export format list and the New-document category rail. In `high-contrast-shortcuts.png`, the focused search field and the selected "All shortcuts" row are two identical yellow boxes, one above the other. HC is the theme keyboard users choose, so this is the place where focus must be unambiguous.

The goal's own "Done" line also needs evidence that still does not exist:
- side-by-side screenshots against references (criterion 11);
- pixel snapping at 150 % and 200 % (criterion 10).

The design critic cannot sign off what it cannot see.

To sign off at review 5, I need:
1. **R1** (HC selection vocabulary);
2. **R2** (the active layer survives deselect);
3. **N11** (text has a home in the inspector);
4. the two evidence sets in §5.

None of these is large.

## 2. Scores (1–10)

| Theme | Premium feel | Modernity | Intuitiveness (first-time student) | Consistency |
|---|---|---|---|---|
| Dark | **8.5** (8) | **8.5** (8.5) | **8** (7.5) | **8.5** (8) |
| Light | **8.5** (8) | **8.5** (8.5) | **8** (7.5) | **8.5** (8) |
| High contrast | **8** (7) | **8** (7.5) | **7.5** (7.5) | **7.5** (7) |

Review-3 scores are in brackets. Bar: ≥ 8 premium, ≥ 8 consistency and ≥ 8 intuitiveness in every theme. **Dark and light pass. HC fails on consistency and intuitiveness.**

**Dark** is calm graphite with an accent used only for state.
- New this round: neutral status dots and toasts (P2-5), a muted document palette in the colour popover (P2-8), and a framed dark slide tile.
- The mm Event poster frames (`dark-layout-mm*.png`) read like Affinity Publisher: page edge, coral margins, dashed bleed, mm rulers and a margin band on the ruler.
- Intuitiveness reaches 8 because units, clipping, the doubled reset and the "×"-as-clear are all gone.
- Held back by:
  - text controls that live in two places at once and not in the inspector (N11);
  - the active layer dropping on a fresh Photo open (R2).

**Light** is level with dark. Export, New document and the colour popover are still the marketing-grade frames. The crop shade no longer greys the pasteboard (`light-crop.png`), and the Paper thumbnail is framed.

**High contrast** gets premium to 8:
- yellow canvas handles everywhere, including crop and the click marker;
- yellow segmented controls and tabs;
- a clean flyout.

It is held back by:
- **R1** (selected = focus in every list except the flyout);
- a solid-white Curves grid over the histogram (P2-14);
- an olive wash on selected tiles, which is the third "selected" dialect.

---

## 3. CRITIQUE-3 items: status at `12c9e3d`

| # | Item | Status | Evidence / residue |
|---|---|---|---|
| N0 (P0) | Object Select misfires | **Resolved** | `*-object-select.png`: ants follow the cottage walls and roof, and the status bar reads `Selection 86 × 60 px`. The IoU regression lives in `168ec25` |
| N1 | Print docs in px | **Resolved** | `dark-layout-mm.png`: inspector 210 × 297 mm · 2480 × 3508 px at 300 dpi, status `210 × 297 mm`, Units `mm`, mm rulers. `*-layout-mm-export-pdf.png`: Page size 210 × 297 mm. Residue: see P2-17 (PDF page size of a px document ignores Output DPI) |
| N2 | Context bar clips | **Resolved** | `*-empty-canvas.png`, `*-layout-mm.png`: `Page 1 of 1 ‹ › + · Margins T L B R · More ▾`, with no cut-off words |
| N3 | Two Curves resets | **Resolved** | `*-curves.png`: the card header has eye + ⋯, and only the channel row keeps ↺. Residue: in `*-photo.png` the header eye/⋯ are hidden at rest (P2-18) |
| N4 | Photo without an active layer | **Partly** | The status bar is fixed (`Selection 86 × 60 px`), and the Adjust empty state is honest ("Select a layer to adjust · Select Background"). The invariant is not holding: `*-crop.png` and `*-object-select.png` ("Not saved", a fresh open) show the Background row inactive and `Nothing selected`. See **R2** |
| N5 | Export scale ×3 | **Resolved** | `*-export.png`: one `1× ⌄` field with a `1264 × 848 px` hint |
| N6 | Colour popover covers its target | **Resolved** | `*-colour.png`: it opens left of the inspector and covers no field. `*-colour-popover.png`: it sits beside the selection, not on it. Residue: P2-19 (its top overlaps the top bar) |
| N7 | Native scrollbar arrows, clipped dialog rows | **Resolved** | `*-preferences-general.png` has every row visible. `*-shortcuts.png` has a themed thin bar and a scroll-edge rule above "Deselect" |
| N8 | Template ships with overflow | **Resolved** | no red overflow port on the Event poster in `*-tooltip.png` or `*-palette.png` |
| N9 | HC flyout checked = focused | **Resolved locally** | `high-contrast-flyout.png`: Rectangle is a yellow tile, Ellipse has a ring. The same fault remains in every other HC list, see **R1** |
| N10 | HC crop and click marker teal | **Resolved** | `high-contrast-crop.png`: yellow L-brackets with edge bars. `high-contrast-object-select.png`: a yellow marker. All eight crop handles now share one vocabulary in every theme |
| P1-8 (c2) | Title Case residue | **Resolved per DESIGN §4** | tools and templates are sentence case ("Rectangle marquee", "Blank US letter"). Shortcuts command rows mirror native menus (an allowed exception). Residue: New-document preset names ("A6 Postcard", "DL Flyer", "Business Card", `*-new.png`), see P2-20 |
| P1-12 (c2) | HC canvas handles teal | **Resolved** | see N10 |
| P2-1 | Light crop darkens the pasteboard | **Resolved** | `light-crop.png`: only the image outside the crop is shaded |
| P2-2 | Crop defaults to 4:3 on a 3:2 photo | **Open** | `*-crop.png`: Ratio `4:3` |
| P2-3 | Duplicate empty states | **Resolved** | `*-flyout.png`: the Layers rail shows only a glyph, title and one line |
| P2-4 | Two keyboard-hint dialects | **Resolved** | the welcome checklist and the canvas card both use keycaps (`*-welcome.png`, `*-empty-canvas.png`) |
| P2-5 | Palette top result without an icon | **Resolved** | `*-palette.png`: every row has the upload glyph |
| P2-6 | Light Paper thumb invisible | **Resolved** | `light-palette.png`: the thumbnail is framed |
| P2-7 | Confirm title | **Resolved** | `*-confirm.png`: "Save changes to "sample-photo" before closing?" |
| P2-8 | Slider dialects | **Resolved** | Interface size and PDF Photo quality both have a value field |
| P2-9 | Irrelevant "Ungroup" | **Open** | a disabled Ungroup is still in the Photo/Layout Move bar for a single pixel layer (`*-curves.png`, `*-layout.png`) |
| P2-10 | Duplicate page navigator | **Open** | `*-export-pdf-vector.png` (Newsletter): the context bar "Page 1 of 2" *and* the canvas pill "Page 1 of 2" are both visible |
| P2-11 | Margin order differs | **Open** | Document setup is T·B / L·R (`*-layout-mm-document-setup.png`), the context bar is T·L·B·R (`*-layout-mm.png`). There is no chain-link toggle |
| P2-12 | Stroke width enabled with Stroke None | **Open** | `*-vector.png`, `*-colour.png`: `W 2 px` is live next to a None stroke |
| P2-13 | Object Select mode icons unlabelled | **Open** | `*-object-select.png`: three bare icons after *Select subject* |
| P2-14 | HC Curves grid | **Open** | `high-contrast-curves.png`, `high-contrast-photo.png`: a solid white 4×4 grid still cuts through the histogram |
| P2-15 | Dark template tiles | **Resolved** | `dark-welcome-templates.png`: the Presentation slide has a visible 1px frame. A photo document in Layout now has a page shadow (`light-layout.png`) |
| P2-16 | Layer names cut twice / early | **Partly** | single ellipsis now, but still cut at about 24 characters with 60–80 px of free row (`light-palette.png`: "northfield.sch.uk/...", "NORTHFIELD AC...", "3:30 – 5:30 pm · ...") |
| c2 P2-3 | Prefs booleans, clipping | **Resolved** | nothing is clipped. Autosave is a disabled-checked box labelled "Always on" (honest) |
| c2 P2-4 | Shortcuts search | **Resolved** | matched letters are bold ("**Export** Again") and counts follow the filter. Residue: zero-count categories stay at full strength (P2-21) |
| c2 P2-11 | "Rectangle" + "RECTANGLE" | **Resolved** | the inspector shows "Rectangle" plus a "CORNERS" section |
| c2 P2-12 | Fuzzy noise | **Resolved** | "exp" returns only Export rows |
| c2 P2-13 | Doc setup "G"; chip vs Transparent | **Open** | "G 4.2 mm" still has a one-letter label. `dark-document-setup.png`: a white Background chip while Transparent is ticked |
| c2 P2-14 | Number precision | **Resolved** | one formatter: the inspector and status bar agree (`210 × 297 mm`) |
| §5 | compare-*.png vs references | **Open** | none in the repo (`find . -iname 'compare*'` is empty). Criterion 11's "Done" line requires them |
| §5 | 150 % / 200 % captures | **Open** | none. Criterion 10 requires pixel snapping at 100/150/200 % |
| §5 | Extra frames (Photo Appearance, Photo shapes flyout, Layers +, font picker, Assets, checklist part-complete) | **Partly** | the Photo Rectangle tool is evidenced in Shortcuts ("Rectangle U"). There is still no frame of the font picker, Assets, Layers + menu or Photo › Design › Appearance |
| §5 | About on v0.4.0 | **Resolved** | `*-about.png`: Version 0.4.0 |

**Tally:**
- P0: 1/1 resolved.
- Critique-3 P1s: 9 resolved, 1 partly done (N4), and N9 resolved locally but systemically open (R1).
- Critique-3 P2s: 8 resolved, 1 partly done, 6 open.
- Earlier carry-overs: 6 resolved, 1 open.

---

## 4. Remaining and new issues

### P0
None.

### P1

**R1 · High contrast: selected rows look the same as focus everywhere except the flyout.**
Screenshots:
- `high-contrast-shortcuts.png`: the focused search field and the selected "All shortcuts" row are both 2–3px yellow outlines, stacked 8px apart.
- `high-contrast-preferences-general.png`: is "General" selected, focused or both? You cannot tell.
- `high-contrast-colour.png`: the selected Rectangle layer row.
- `high-contrast-export-pdf-vector.png`: the selected PDF format row.
- `high-contrast-new.png`: the Print category.

*Problem:*
- `panels.css:1392` and `shell.css:529` (a duplicate rule) give `.layer-row.selected` `inset 0 0 0 2px var(--c-accent)`.
- `dialogs.css:363` gives HC `.nav-item[aria-current]` the same outline treatment.
- The export format list and New-document rail do the same.
- On top of that, preset tiles use a third dialect, an olive `rgb(64,53,0)` wash plus outline (`high-contrast-new.png`).

DESIGN §8 now states the rule for the flyout only ("High contrast never draws checked and focused alike"), so these surfaces break DESIGN.md.

*Fix:* make one HC rule, written once in `styles.css` and documented in DESIGN §3 or §9 as *the* HC selection vocabulary.
- **Selected / current / checked** in any list (`.layer-row.selected`, `.history-list li.current button`, `.nav-item[aria-current='true']`, `.nav-item[aria-selected='true']`, export `.format-row[aria-selected]`, new-doc category and preset tiles, `.cmdk-row.active` stays as is because it is the keyboard cursor): `background:#ffd400; color:#000`, icons and counts `#000`, and no outline.
- **Focus**: the §9 ring, a 3px yellow outline with a 2px offset, on a black row. A focused + selected row gets the yellow fill *plus* a 2px black inner gap and the 3px outer ring (`box-shadow: 0 0 0 2px #000, 0 0 0 5px #ffd400`).
- **Hover**: 1px white inset (unchanged).
- Delete the duplicate `.layer-row.selected` block in `shell.css:529-535`.
- Delete the olive `color-mix` wash on HC tiles.
- Add a unit lint to `shellLint.test.ts` that rejects any HC rule styling `.selected` / `[aria-current]` / `[aria-selected]` with only an outline or inset ring.
- Extend the critique-3 e2e: in HC, the computed background of the selected layer row, Preferences nav item and export format row is `rgb(255, 212, 0)`.

**R2 · Photo's active layer is lost on a fresh open and on deselect.** (`dark-crop.png`, `dark-object-select.png`, and the light and HC versions: "Not saved", Background row inactive, status `Nothing selected` in crop, Adjust tab "Select a layer to adjust")
*Problem:* `editor.ts:267` `ensureActiveLayer()` treats "active layer" as "object selection". Anything that calls `select([])` (Esc, Deselect, starting Crop or Object Select, a click on empty pasteboard) drops the active layer. Only undo and delete restore it (`validateUi`, line 325). A student opens a photo, picks Crop or Object Select, opens Adjust, and is asked to pick a layer although only one exists. The empty state is honest now, but Photoshop and Affinity never ask.
*Fix:*
- Add `ui.activeLayerId` to `UiState`, separate from `selection`.
- `ensureActiveLayer` sets `activeLayerId`, not `selection`, and runs on open, studio switch, crop apply, delete and undo.
- `select([])` never clears `activeLayerId`. Selecting a layer sets both.
- The Adjust panel, the brush/eraser/fill tools, Object Select's target and "Copy to layer" read `activeLayerId`.
- The Layers row shows *active* with the existing selected style when `activeLayerId === id` in Photo, even when the object selection is empty.
- e2e: open `sample-photo.jpg` → choose Crop → Esc → the Adjust tab shows "Add adjustment or filter…", not the empty state.

**N11 · Text has no home in the inspector, and its controls appear twice at once elsewhere.** (`dark-layout-mm-selected.png`, `light-layout-mm-selected.png`, `high-contrast-layout-mm-selected.png`)
*Problem:* with a text frame selected:
- The context bar shows `Inter ⌄ · 17.5 pt · B I · colour · More ▾`.
- The floating selection toolbar 700 px lower shows the same `Inter ⌄ · 17.5 pt · B I · colour`.
- The inspector, which edits everything else (Appearance, Transform, Corners, Sides, Image fit), offers only Appearance · Transform · "Columns and links" (`PropertiesPanel.tsx:119`). There is no typeface, size, leading, tracking, alignment or paragraph spacing.

Figma, Framer (MOBBIN.md, Framer pattern 4: "properties-by-selection inspector") and Affinity's Character/Paragraph panels all give type a persistent panel home. Criterion 6 asks for per-character typography, which has nowhere to live in a 36 px toolbar. Two identical control sets on screen at once is the "two homes" fault critique 2 removed for Opacity/Blend (c2 P1-4).
*Fix:*
- Add a **Text** section to the inspector for `textframe`/artistic text, after Appearance: Font picker (full width) · Style + Size (grid2) · Leading + Tracking (grid2, with icons and tooltips) · Align segmented (left/centre/right/justify) + vertical align · a "More type options…" disclosure for OpenType, baseline and paragraph spacing. Rename "Columns and links" to "Text frame".
- Remove font and size from the **context bar** for text (keep the tool hint and *More*), *or* suppress the selection toolbar's text group while the context bar shows it. DESIGN §8 must then say which one is canonical. My recommendation: inspector = full set, floating toolbar = quick set (font · size · B · I · colour), context bar = tool hint only. That matches Figma's split.
- e2e: selecting a text frame shows exactly one font trigger outside the inspector.

### P2

17. **The PDF page size of a px document ignores Output DPI.** `dark-export-pdf.png`: a 1264 × 848 px photo exports at 334.4 × 224.4 mm, which is 96 px/in, while Document setup says Output DPI **300** (`dark-document-setup.png`), which would be 107 × 71.8 mm. Either derive the physical size from Output DPI for px documents, or rename the setting "Raster export DPI" and put "at 96 px/in" in the Page-size hint.
18. **Adjustment card header actions are hidden at rest.** `*-photo.png`: the Curves and Vibrance headers show no eye or ⋯ until hover or focus (`*-curves.png` shows them). Show the eye at `text-3` permanently (visibility is state, not an action), and keep ⋯ on hover.
19. **The context-bar colour popover rides over the top bar.** `light-colour-popover.png`, `high-contrast-colour-popover.png`: its top edge sits at y≈42, over the top bar's bottom hairline and the context bar. Clamp popovers to `top ≥ contextbar.bottom + 4` and slide horizontally instead.
20. **Preset names in Title Case.** New document › Print: "A6 Postcard", "DL Flyer", "Business Card" (`*-new.png`). Use sentence case ("A6 postcard", "DL flyer", "Business card"), and add `core/templates.ts` presets to the `sentenceCase` test scope.
21. **Shortcut search leaves empty categories at full strength.** `*-shortcuts-search.png`: Edit 0, Arrange 0… read as live. Use `text-3` for zero-count nav items, or hide them while a query is active.
22. **Text-frame link buttons mix button styles.** `*-layout-mm-selected.png`: "Link frames" is a bordered ghost button and "Unlink" is bare text. Give both the `btn sm ghost` style, and disable "Unlink" when the frame has no link.
23. **Curves Input/Output show "0" with no point selected.** `*-photo.png`: show "–" in disabled fields until a point is picked (`Input 128 / Output 181` in `*-curves.png` is the right selected state).
24. **The A4 preset defaults to 12.7 mm margins.** `*-new.png`, `*-empty-canvas.png`: 12.7 mm is ½ in leaking into a metric preset. Use 15 mm (or 12 mm) for ISO sizes and keep 0.5 in for US Letter.
25. **The "All 2" Area label.** `*-export-pdf-vector.png`: "All 2" reads as a typo. Use "All (2)" or "All pages".
26. **The Vibrance card repeats its title.** `*-photo.png`: the header "Vibrance" sits over a slider labelled "Vibrance". Label the slider "Amount".

Open from critique 3 (see the table): P2-2 crop ratio, P2-9 Ungroup, P2-10 page navigator, P2-11 margin order, P2-12 stroke width, P2-13 mode icons, P2-14 HC Curves grid, P2-16 layer-name cut, c2 P2-13 "G" / Transparent chip.

---

## 5. Evidence still missing for criteria 10–11 (blocking sign-off)

1. **Side-by-side comparisons**, in `docs/design/review/compare-<surface>-<theme>.png`, with Quvrelo on the left and the reference on the right:
   - welcome vs Figma/Framer home
   - editor shell vs Figma editor
   - inspector vs Framer
   - palette vs Linear
   - dialog vs Linear settings
   - empty state vs Pitch

   Do this for dark, light and HC (HC beside the reference's dark mode). If licensing forbids committing reference pixels, keep the composites outside git in `/workspace/work/compare/`, and commit a `docs/design/review/COMPARE.md` that lists each pair with the Mobbin URL (already in MOBBIN.md) and the Quvrelo frame.
2. **150 % and 200 % device-scale captures** of the shell (`dark-vector`, `light-layout-mm-selected`) and one dialog (`*-export`), for hairline crispness and handle and ruler pixel snapping. In Playwright: `deviceScaleFactor: 1.5 / 2` on the Electron window, or `--force-device-scale-factor`.
3. Frames still missing: the font picker open; Assets; the Layers + menu; Photo › Design › Appearance with a pixel layer; the Photo shapes flyout; Welcome with the checklist part-complete.
4. Re-capture `light-` and `high-contrast-layout-mm-selected.png` on `12c9e3d` or later (the font-size fix).

---

## 6. What is now at reference level (additions since review 3)

- **Print documents** (`dark-layout-mm.png`, `light-layout-mm-export-pdf.png`): mm everywhere, with the px-at-dpi hint. It reads like Publisher, and better than Affinity's "Document Setup" copy.
- **Object Select result** (`light-object-select.png`): a tight mask, an honest status-bar readout, and an action strip that is fine to act on now.
- **Adjustment cards** (`*-curves.png`): eye + ⋯ header, one reset per scope, Input/Output fields. Affinity-grade.
- **Context bar overflow**: a priority+ "More ▾" that never clips. That is how Figma and Linear degrade toolbars.
- **HC canvas**: yellow handles, crop brackets and the click marker. A real accessibility theme, not an inverted one.
- **Colour popover placement**: beside the selection, clear of the inspector (`dark-colour.png`).

## 7. Path to sign-off, in order

1. **R1**: one HC selection vocabulary (yellow fill = selected, ring = focus) across layers, nav lists, format lists and tiles, plus the lint and e2e checks.
2. **R2**: `activeLayerId` separate from the object selection, plus the e2e check.
3. **N11**: a Text section in the inspector, and one quick-text home outside it.
4. **§5 evidence**: compare frames vs the references in three themes, and 150/200 % captures.
5. Then P2-14 (HC Curves grid), P2-12 (stroke width), P2-17 (PDF size vs DPI) and the rest of the P2 list.

With R1–N11 fixed and §5 delivered, I expect to sign off at review 5. Dark and light already hold up against Linear, Figma and Affinity V3 on every surface captured.
