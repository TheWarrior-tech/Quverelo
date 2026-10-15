# Quvrelo UI critique: design review 2 (sign-off check for criteria 10 + 11)

Reviewer: independent senior product-design critic · 2026-10-15 · `main` @ `a88b303` (redesign v3 merged)
Captures: `/workspace/work/review-v3/*.png` (1440×873, dark / light / high-contrast × welcome, welcome-templates, photo, vector, layout, new, new-templates, export, export-pdf, document-setup, confirm, preferences, preferences-general, shortcuts, shortcuts-search, about, colour, colour-popover; plus `controls-gradient`, `controls-wheel`, `controls-assets`), taken about 11:15 on the v3 integration build. Supplementary: `/workspace/work/{crop,subject-actions,palette-open,tooltip,flyout-open,empty-canvas,shell-v3-dark,shell-v3-light,welcome-v3}.png`. Several of these **predate the shell-v3 merge** and show the old two-column shell, so I use them only for component behaviour (crop bar, palette rows, flyout, tooltip, action strip, empty state).
Yardsticks: Linear, Figma, Framer, Affinity V3, and the Mobbin pattern notes in `docs/design/refs/MOBBIN.md` (the "10 strongest cross-app patterns"). I compared against those written notes. No Mobbin screenshots are checked in, so the "side-by-side vs Mobbin" part of criterion 11 is only partly evidenced (see §6).
Severity is the same as review 1:
- **P0**: a pro notices within 10 s, or it reads broken or fake.
- **P1**: it reads generic or amateur, breaks DESIGN.md, or makes a student stall.
- **P2**: polish.

---

## 1. Verdict: **NOT YET**, but close

v3 is a different product from the one in review 1:
- The three-rail shell (tool rail · Layers/Pages/Assets · canvas · Design/Adjust/History) matches the Figma/Framer topology.
- The welcome screen is dense and left-aligned, with Recent as a table, search, and a Get started checklist.
- The template art no longer looks AI-made.
- Selection now behaves like a pro tool: accent handles, a floating selection toolbar, and the pixel action strip with *Remove background*.
- Crop has handles, ratios and Apply/Cancel, the command palette works with keycaps, and tooltips are custom.

Nothing now reads as "AI slop". What stops sign-off is a band of **inconsistency and unfinished-detail** issues that a Figma/Affinity user would still spot:
- **Three different segmented-control implementations**, each with its own active state. In dark the dialog one has an ambiguous active tile, and in high contrast a disabled one turns into the olive wash review 1 banned.
- **Two different colour pickers** for the same Fill property.
- **Opacity/Blend have two homes**, depending on the studio.
- The OS-blue text-selection highlight inside the teal UI.
- Grey "skeleton" page thumbnails in New Document.
- A Curves panel with empty Input/Output boxes and a "Reset" sitting inside the channel switch.
- Dashed outlines on every text frame at rest, with every text layer named "Text Frame".
- Mixed Title Case and sentence case on buttons.

One copy/feature contradiction is a P0 for a pro buyer: the PDF format is sold as "Print-ready pages" and then the dialog says "Pages are rasterised at this resolution".

Fix the P0 and the P1 list below (most are a day of CSS and component consolidation) and I expect to sign off at review 3.

## 2. Scores (1–10)

| Theme | Premium feel | Modernity | Intuitiveness (first-time student) | Consistency |
|---|---|---|---|---|
| Dark | 7.5 | 8 | 7 | 6 |
| Light | 7.5 | 8 | 7 | 6.5 |
| High contrast | 6.5 | 7 | 7 | 5.5 |

Review 1, for reference (implied): roughly 5 / 5 / 4 / 4.

- **Dark** is the hero theme: calm graphite and accent restraint at Linear level. It loses consistency points for the segmented contrast and the OS-blue selection.
- **Light** reads cleanest of the three, because white active tiles with hairlines separate well.
- **High contrast** is a real theme with yellow outlines on selected rows. But disabled-active segments wash to olive, the Curves channel switch ignores the HC rule, canvas handles stay teal while every other HC selection is yellow, and New Document page thumbnails are flat grey slabs.

To sign off I need ≥ 8 premium, ≥ 8 consistency and ≥ 8 intuitiveness in every theme.

---

## 3. Issues

### P0

**P0-1 · PDF export: "Print-ready" plus "rasterised" is a contradiction, and there are no PDF/X controls.** (`dark-export-pdf.png`, `light-export-pdf.png`, `high-contrast-export-pdf.png`)
*Problem:*
- The format list says *PDF · Print-ready pages*. The first field in the form says *"Pages are rasterised at this resolution"*, with a Screen/Standard/Print dpi select and a JPEG-style Quality slider.
- Dimensions are reported in px (1975 × 1325 px) for a print format.
- There is no PDF standard (PDF/X-1a, X-4), no colour/output intent, and no page range on single-page documents.
- `grep -r "PDF/X" src/` returns nothing.

To a print pro or IT buyer comparing against Affinity Publisher, this reads as a fake feature.

*Fix:*
- (a) Copy, now, in `src/renderer/ui/dialogs/ExportDialog.tsx`:
  - If the export really is raster, the format subtitle becomes "Image PDF · one picture per page" and the field label becomes "Image resolution".
  - Hide Quality unless the page contains raster content.
  - Show the size in document units (mm/in) with px as the hint.
- (b) The real fix, tracked in PARITY.md (criteria 5/6):
  - Vector PDF output.
  - A **Preset** select at the top of the PDF form: *Digital (smallest) · Print · PDF/X-1a · PDF/X-4*.
  - An **Output intent** select.
  - **Area** = Whole document · Current page · Page range (text field `1–3, 5`).
  - Marks: crop + bleed.
- Until (b) ships, don't label PDF "Print-ready".

### P1

**P1-1 · Three segmented-control implementations with different active states.** (`dark-export.png` Background, `dark-preferences-general.png` Update channel, `high-contrast-preferences-general.png`, `dark-photo.png` Curves RGB/R/G/B, `high-contrast-photo.png`)
*Problem:* `.segmented` (`ui/panels.css:435-490`), `.seg` (`ui/dialogs/dialogs.css:181-237`) and `.choice-row .btn.selected` (`CurvesEditor.tsx:300-304`, `styles.css:604-631`) each style the active tile differently.
- In dark, `.seg[aria-checked]` is `--c-press` (white 9 %) on `--c-raised`. "Page colour | Transparent" in Export is genuinely ambiguous: I could not tell which was on without zooming.
- In HC the Curves switch uses a grey active tile while every other HC segmented control uses yellow.
- A **disabled** active HC segment ("Stable", updates off in dev builds) renders yellow at 40 % opacity. That is the muddy olive wash review 1 #23 removed.

*Fix:*
- Use one component, `ui/controls/Segmented.tsx`, everywhere: dialogs, context bar, inspector, Curves. Delete `.seg` and `.choice-row .btn.selected`.
- Active tile:
  - dark: `--c-popover` plus `box-shadow: 0 0 0 1px var(--c-line-strong)`, text `--c-text` 500
  - light: as today
  - HC: `--c-accent` fill with `--c-accent-ink`
- Disabled in HC: drop the opacity. Draw the active segment as black fill, 1px dashed `#fff` outline and `--c-text-3` text. Disabled must never mean translucent accent.
- Add a contrast-audit row in `scripts/contrast-audit.mjs` for active vs inactive tile (≥ 1.4:1 luminance difference, or a 3:1 boundary).

**P1-2 · Curves panel: empty Input/Output boxes, Reset inside the channel switch, and a heavy histogram behind it.** (`dark-photo.png`, `light-photo.png`, `high-contrast-photo.png`)
*Problem:*
- With no point selected, Input and Output are empty bordered boxes, which reads as broken.
- "Reset" sits inside the RGB/R/G/B track as if it were a fifth channel.
- The histogram ghost is a solid mid-grey area at about 50 %, not the 20 % review 1 asked for.
- The curve has no visible end-point knobs.

*Fix:* in `ui/panels/CurvesEditor.tsx` and `panels.css`:
- Fields show the selected point. When no point is selected, show the nearest end point (0 / 0), or disable the fields with placeholder "–".
- Move Reset out of the track to a 24px ghost icon button (`undo`) on the Curves header row, matching the other adjustment headers (`AdjustmentsPanel.tsx:91`).
- Histogram ghost: `--c-text-3` at 18 % (light 12 %).
- Draw 7px end-point knobs (`--c-text` fill, 1px `--c-app` ring) at (0, 0) and (255, 255).

**P1-3 · Two different colour pickers for one Fill.** (`dark-colour.png` vs `dark-colour-popover.png`, `light-colour-popover.png`, `high-contrast-colour-popover.png`)
*Problem:*
- The inspector Fill chip opens a picker with *None · Solid · Linear · Radial* tabs, a hex/opacity row and a Recent section.
- The context-bar Fill chip opens a different body: a "None" checkbox in the header, no gradient types, no Recent.
- Same property, two UIs. Students will think the gradient option "disappears".

*Fix:* one `ColorPopoverBody` in `ui/ColorControls.tsx`, used by `ColorChipButton` everywhere. The paint-type tabs (None · Solid · Linear · Radial) are always the first row. Remove the header "None" checkbox. The context-bar and selection-toolbar chips pass the same props as the inspector `PaintRow`.

**P1-4 · Opacity and Blend live in different places in different studios.** (`dark-photo.png` vs `dark-vector.png`)
*Problem:* In Photo they sit at the top of the Layers rail ("Normal · Opacity 100 %"). In Vector and Layout they sit in Design › Appearance. A student who learned one won't find the other.

*Fix:*
- Keep them in **Design › Appearance** in all studios. In Photo the Design tab already exists, so show Appearance for the selected layer there.
- Remove the Layers header row from `ui/panels/LayersPanel.tsx`, or keep it in Photo only as a mirror of the same control (the Affinity pattern), styled identically (blend select 96px plus Opacity slider row as in Appearance).
- Pick one and document it in DESIGN.md §8 Layers.

**P1-5 · OS-blue text selection inside the teal UI.** (`dark-new.png`, `light-new.png`, `high-contrast-new.png`: "Untitled" is highlighted in system blue)
*Problem:* This is the only non-accent hue in the chrome, and it shows on the very first field a student meets.

*Fix:* in `styles.css`:
- `::selection { background: var(--c-accent-wash-strong); color: var(--c-text); }`
- New token `--c-accent-wash-strong`: dark accent 32 %, light accent 24 %, HC `#ffd400` with `color:#000`.
- Add it to DESIGN.md §3 and to the contrast audit.

**P1-6 · New Document: unselected page thumbnails are flat grey slabs.** (`dark-new.png`, `high-contrast-new.png`. Light is fine.)
*Problem:* In dark and HC, A3/A5/A6… render as `#bdbdbd` blocks with no edge, so they read as loading skeletons. Only the selected A4 shows a white page.

*Fix:*
- In `ui/dialogs/NewDocumentDialog.tsx` and `dialogs.css`, draw every preset page as the real paper colour (`#fff`, HC `#fff`) at 88 % opacity, with a 1px `--c-line-strong` edge.
- Selection = the tile's accent outline only. The page stays white.
- Show margins as a faint coral inset on the selected tile only.

**P1-7 · Text frames show dashed outlines at rest, and every text layer is "Text Frame".** (`controls-gradient.png`, `controls-wheel.png`, `palette-open.png`)
*Problem:*
- Each frame on the Open Evening poster carries a dashed blue-grey box even with nothing selected. That's visual noise Figma and Affinity hide by default.
- Layers lists "Text Frame ×5", so a student can't tell which is which.

*Fix:*
- In `engine/Viewport.ts`, draw frame bounds only on hover, when selected or while editing, or when View › Show Text Frames is on (add it, default off).
- In the layer-name fallback (`state/editor.ts` / `LayersPanel.tsx`), name text layers by the first 24 characters of their content ("Open Evening", "Thursday 2 October…"), as Figma does. Keep "Text Frame" only for empty frames.

**P1-8 · Button and title casing is mixed.** (`dark-preferences-general.png` "Clear List", "Check Now"; `dark-confirm.png` "Don't Save"; `dark-about.png` "Check for Updates"; `dark-document-setup.png` "Document Setup"; vs `dark-welcome.png` "New document…", "Edit a photo…", `dark-preferences.png` "Done", inspector "Document setup…")
*Problem:* The same dialog is "Document Setup" in its title and "Document setup…" on the button that opens it.

*Fix:*
- Adopt sentence case for every button, dialog title, tab and heading (Linear/Figma). Keep native-menu items in platform Title Case.
- Strings to change:
  - `AppDialogs.tsx:154,303,331`
  - `DocumentDialogs.tsx:63`
  - the `DialogHost` destructive label
  - New Document / Keyboard Shortcuts titles
- Add the rule to DESIGN.md §4, and a lint test that rejects `>[A-Z]\w+ [A-Z]\w+</button>` in `ui/`.

**P1-9 · No visible search/command entry point in the top bar.** (all workspace captures)
*Problem:* The palette is excellent (`palette-open.png`) but reachable only by Ctrl+K or the menu. MOBBIN.md pattern "Command surfaces surfaced as inline controls" applies: every reference app puts search at the top. A student will never press Ctrl+K.

*Fix:* in `ui/Workspace.tsx` Topbar, left of the right cluster, add a 28px, 200px-wide quiet field-button: search icon · "Search commands" in `text-3` · `Ctrl K` keycaps. Style it `--c-raised` with a hairline. Clicking it opens `CommandPalette`. Below 1280px, collapse it to an icon.

**P1-10 · Photo studio still has no shape tools.** (`dark-photo.png` rail; UX_AUDIT P1-6)
*Problem:* A student who wants a box or arrow on a photo has to guess they should switch studio.

*Fix:* add a Shapes flyout (Rectangle · Ellipse · Line) to `STUDIO_TOOLS.photo` in `state/editor.ts`, after Text, using the existing flyout group model (`toolGroups.ts`). The first use in Photo creates a vector layer above the active pixel layer.

**P1-11 · The Export form leaves a dead void and still lacks Area options for raster.** (`dark-export.png`, `light-export.png`)
*Problem:* The middle column uses 4 rows, then about 240px of nothing. Area is a single disabled "Include bleed" checkbox with explanatory text. Scale is a select with no custom value.

*Fix:*
- In `ExportDialog.tsx`, add Area = Whole document · Selection (enabled when there is one) · Current page.
- Scale becomes a `NumberField` with the `×` suffix plus a preset menu (0.5 · 1 · 2 · 3 · custom W px).
- Put the filename field into the form (currently it shows only under the preview).
- Cap the dialog body at content height (`max-height` rather than a fixed height) so the void collapses.

**P1-12 · High contrast: canvas selection handles stay teal.** (`high-contrast-layout.png`, `high-contrast-vector.png`)
*Problem:* Every other HC selection (layer row, page thumb, tool, segment) is yellow. The canvas box and handles are `#2fb8a6`.

*Fix:* in `engine/Viewport.ts`, read the overlay colours from CSS variables (`--c-canvas-selection`, `--c-canvas-handle`) and set HC to `#ffd400` with a black ring. Document this in DESIGN.md §3 Canvas overlays.

**P1-13 · Histogram looks clipped and stays saturated RGB.** (`dark-photo.png`, `light-photo.png`, `high-contrast-photo.png`)
*Problem:* It sits flush under the Design/Adjust/History tabs with no header or padding, so it reads cut off. It still uses full-saturation RGB fills (review 1 #26 open).

*Fix:* in `AdjustmentsPanel.tsx` and `panels.css`:
- Add a 28px `HISTOGRAM` micro-label header with a channel menu.
- Pad the top 8px.
- Draw luminance as a `--c-text-3` area at 40 %, with R/G/B as 1px lines at 60 %.
- HC: white area plus coloured lines.

### P2

1. **Top bar: the studio switch is off-centre.** (`dark-photo.png`) The switch plus the undo/redo/place group is centred as one block, so the switch itself sits about 54px left of the window centre. Move undo/redo/place into the left zone after the filename, or use a 3-column grid that centres only `.studio-switch` (`ui/shell.css` topbar).
2. **The status bar "Snap on" is plain text.** (all workspace captures; UX P1-14 open) Make it a 20px ghost toggle (magnet icon, `aria-pressed`, tooltip with shortcut), and turn the zoom value into a menu (`Workspace.tsx:399`).
3. **Preferences › General: "Autosave On" is a bare word, the checkbox sits at the far right, and the last row hides under the footer.** (`dark-preferences-general.png`) Use a 32×18 switch control for all boolean PrefRows (Autosave, Automatically download updates), and add the scroll-edge shade at the bottom (DESIGN §6). Also add Performance and Shortcuts sections, as review 1 #18 listed.
4. **The Shortcuts search results use half the dialog.** (`dark-shortcuts-search.png`, `light-shortcuts-search.png`) Matches aren't highlighted, and the left-nav counts don't follow the filter. Cap rows at 560px, bold the matched substring (same as the palette), and update the counts. The clear-× in light is accent-coloured, which breaks DESIGN rule 4: use `text-3`.
5. **Accent used for status.** The "• Edited" dot in the top bar and the toast dot are accent-filled. Use `--c-text-3` for Edited (or a 6px `--c-text-2` dot) and keep the accent for its four roles.
6. **Assets › Shapes & Symbols are filled clip-art glyphs on raised bordered cards.** (`controls-assets.png`) They clash with the outline UI icon set and look like a stock icon font. Redraw them on the `Icons.tsx` grid as outline shapes, or present them as neutral-fill silhouettes on flat tiles (no border, hover `--c-hover`). The "Place image…" in the empty state is a bare text link; use the `EmptyState` ghost button.
7. **Stray accent bar on the focused "Assets" rail tab.** (`controls-assets.png`) The focus ring is clipped to a left-edge sliver. Give rail tabs `outline-offset: -2px` so the ring draws inside the tab.
8. **Default document swatches are a 20-colour saturated rainbow** that reads like a generic default palette. Ship a curated set: neutrals ramp (5) plus 3 tints each of 5 hues at moderated chroma. School brand kits override it (`core/swatches` defaults).
9. **"Done" is accent-filled** in Preferences, Shortcuts and About (UX P2-1 open). Use the default button. The accent is for commit actions only.
10. **Literal radii remain:** `styles.css:384`, `dialogs.css:1005`, `panels.css:573,1304`, `welcome.css:471` (1px/2px). Tokenise as `--r-hairline: 1px`, or document them as track/tick exceptions in DESIGN §6.
11. **Inspector naming:** the title says "Rectangle" and the bottom section says "RECTANGLE" (review 1 #33, partly open). Rename the section `SHAPE`.
12. **The command palette's fuzzy match is noisy:** "exp" returns *Convert to Curves* (`palette-open.png`). Require a contiguous word-start match for queries of 3 or fewer characters (`ui/fuzzy.ts`).
13. **Document Setup: "G" (gutter) is a cryptic one-letter label, and the Background chip contradicts the checked Transparent box.** (`dark-document-setup.png`) Spell out "Gutter". When Transparent is checked, show the chip as a checkerboard and disable it.
14. **Number precision:** "793.7 × 1122.52 px" in the inspector vs "1122.5" in the status bar (`palette-open.png`). Use one formatter (1 decimal for px, 2 for mm) in `controls/numeric.ts`.
15. **Layout on a non-print document shows no page edge or margins** (review 1 #22, partly open). `high-contrast-layout.png` is fine as a photo doc, but draw at least the page-edge hairline and offer "Add margins…" in the Pages rail.

---

## 4. Review 1 (`CRITIQUE.md`): status at `a88b303`

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Stale photo selection in Vector/Layout | **Resolved** | `dark-vector.png`, `dark-layout.png` |
| 2 | No selection box/handles | **Resolved** | accent handles plus white ring, `dark-layout.png` |
| 3 | Two studio segments active | **Resolved** | one active everywhere |
| 4 | Objects vanish behind dialogs | **Resolved** | star and rect in export previews and behind backdrops |
| 5 | Curves as three sliders | **Resolved (graph)**, details open | see P1-2 |
| 6 | AI-filler template art | **Resolved** | `dark-welcome-templates.png` (Open Evening, Science Fair) |
| 7 | Spaced hyphens (tnum) | **Resolved** | welcome meta |
| 8 | Outlined buttons in the context bar | **Resolved** | ghost/icon context bar |
| 9 | Nested bordered cards | **Resolved** | flat sections. Assets tiles remain (P2-6) |
| 10 | Panels clip | **Resolved** | v3 rails. Histogram presentation is P1-13 |
| 11 | Blend/opacity unlabelled | **Resolved**, but the placement is inconsistent | P1-4 |
| 12 | SaaS-landing welcome | **Resolved** | `dark-welcome.png` |
| 13 | Ragged/letterboxed template grid | **Resolved** | |
| 14 | Initial focus on × | **Resolved** | Name / W / format / search get focus |
| 15 | Shortcuts mono chips, no search | **Resolved** | the search layout is P2-4 |
| 16 | Export is a bare form | **Partly** | preview and format list done. Area/scale/PDF in P0-1, P1-11 |
| 17 | New Doc rhythm/units/bold | **Partly** | units and thumbnails done. Margins are still a single value, thumbnails are P1-6 |
| 18 | Thin preferences | **Partly** | left nav done. Only 4 sections, booleans inconsistent (P2-3) |
| 19 | Radii | **Partly** | `--r-tile` added. Five literal 1–2px radii (P2-10) |
| 20 | Unicode glyph icons | **Resolved** | no glyphs found in `ui/` |
| 21 | Sparse rail and weak chips | **Resolved** | flyouts (`flyout-open.png`), chips with ring |
| 22 | Layout looks like Vector | **Partly** | own rail and Pages tab. No page edge on non-print docs (P2-15) |
| 23 | HC olive selected row | **Resolved** for rows | the olive comes back on disabled segments (P1-1) |
| 24 | Persistent toasts | **Resolved** | `TOAST_MS = 3000` (`App.tsx:29`). Toasts in captures are within 3 s of open |
| 25 | Ruler labels | **Resolved** | |
| 26 | Saturated histogram | **Open** | P1-13 |
| 27 | Slider row alignment | **Resolved** | |
| 28 | Layer row bar / fx text | **Resolved** | |
| 29 | Studio switch centring | **Open** | P2-1 |
| 30 | Vector fill/stroke chips | **Resolved** | chips plus chevron, W with px |
| 31 | Swatches hint wraps | **Resolved** | moved to tooltip |
| 32 | Native scrollbars | **Resolved** | themed scrollbars |
| 33 | Duplicate RECTANGLE label | **Partly** | P2-11 |
| 34 | "Ctrl+," keycap | **Resolved** | keycaps per key |
| 35 | Light accent-wash invisible | **Resolved** | inset bar plus wash |

**Score:** 25 resolved, 8 partly done, 2 open.

## 5. UX_AUDIT: status at `a88b303`

| ID | Item | Status | Evidence / remaining |
|---|---|---|---|
| P0-1 | Command palette | **Resolved** | `palette-open.png`. No visible entry point yet (P1-9) |
| P0-2 | Select Subject / Object Select / action strip | **Resolved** | `dark-photo.png` context bar and strip, `subject-actions.png`, Ctrl+Alt+S, W |
| P0-3 | Edit a photo / drop overlay / canvas empty state | **Resolved** | Welcome Start row, `empty-canvas.png` (pre-v3 capture; re-capture in v3) |
| P0-4 | Adjustable crop | **Resolved** | `crop.png` (handles, ratio, W/H, overlay, Cancel/Apply) |
| P0-5 | Export label / split / PDF visible / Export again | **Resolved** | `Export ▾` primary in the top bar |
| P1-1 | Custom tooltips with keycaps | **Resolved** | `tooltip.png`, `5ac993e` |
| P1-2 | Appearance first | **Resolved** | `dark-vector.png` Design tab |
| P1-3 | One colour picker, no native input | **Partly** | native inputs gone, but two popover bodies (P1-3 here) |
| P1-4 | Checklist + coach marks | **Partly** | Get started checklist done. No workspace coach marks seen in any capture |
| P1-5 | Unified context bar | **Resolved** | the segmented component itself is not unified (P1-1 here) |
| P1-6 | Explain studios; shapes in Photo | **Open** | P1-10 here |
| P1-7 | One New-document path; infer studio | **Resolved** | "Opens in Layout", More options |
| P1-8 | Layers + menu, footer tooltips | **Unverified** | no capture of the + menu |
| P1-9 | Font picker | **Resolved** | `3f8a7a6`, e2e (no v3 capture) |
| P1-10 | One T tool in Layout | **Resolved** | Layout rail shows a text flyout |
| P1-11 | Panels clip / per-studio split | **Resolved** | the v3 rails replace the split |
| P1-12 | Floating selection toolbar | **Resolved** | `dark-layout.png` |
| P1-13 | Welcome fluid / search / scrollbars | **Resolved** | `dark-welcome.png` |
| P1-14 | Snap as a control | **Open** | P2-2 here |
| P1-15 | Shortcut collisions / cycling | **Resolved** | Shift-cycling (`9426fab`) |
| P2-1 | Done not accent | **Open** | P2-9 here |
| P2-2 | HC inactive segments | **Resolved** (inactive) | the disabled-active issue is P1-1 |
| P2-3 | Shortcuts void / match highlight | **Open** | P2-4 |
| P2-4 | Export checkerboard for transparent | **Unverified** | the sample covers the page |
| P2-5 | Margins linked, presets | **Open** | |
| P2-6 | Hint copy ≤ 60 chars | **Resolved** | crop guidance moved to tooltips (`0052ae2`) |
| P2-7 | Undo toasts for destructive actions | **Unverified** | |
| P2-8 | History naming | **Unverified** | |
| P2-9 | Unified title bar | **Open** | captures are frameless Linux/xvfb, so this can't be judged |
| P2-10 | Density / theme preview | **Partly** | theme tiles plus Interface size. No density |
| P2-11 | Swatch hint tooltip, + to save | **Resolved** | |
| P2-12 | Studio switch keycaps in tooltip | **Resolved** | tooltips with keycaps |

**Score:** P0 5/5 resolved. P1 10 resolved, 2 partly done, 2 open, 1 unverified. P2: 4 resolved, 1 partly done, 4 open, 3 unverified.

## 6. Evidence gaps to close before review 3

- Re-capture in v3, in all three themes: `empty-canvas`, `crop`, `palette-open`, `tooltip`, `flyout-open`, the font picker, the Layers + menu, a coach mark (if one exists), and Welcome with the checklist part-completed. The current versions of most of these predate the shell merge.
- Criterion 11 asks for **side-by-side screenshots vs Mobbin references**. The repo has text notes only (`refs/MOBBIN.md`). Add `docs/design/review/compare-*.png`: Quvrelo next to a public screenshot of the reference pattern (Figma inspector, Framer left rail, Linear command bar, Canva onboarding) for welcome, shell, inspector, palette, dialog and empty state. Use a local-only reference image if licensing forbids committing it.
- Add a 150 %/200 % scale capture of the shell. Pixel snapping at higher DPR has never been evidenced.

## 7. What is now genuinely at reference level

- The shell topology and density are on par with Figma/Framer: tool rail · Layers/Pages/Assets · canvas · Design/Adjust/History, with Export as the single primary in the top-right.
- The pixel action strip (*Remove background · Mask · Copy to layer · Crop · Invert*) and the object selection toolbar are the most "modern" things in the app. Students get the core ML feature in one click.
- The crop bar (ratio · swap · W/H · Thirds/Grid/None · Cancel/Apply) matches Lightroom/Affinity.
- The command palette is Linear-grade: keycaps, group label, disabled reason ("Select an object first"), and a key-legend footer.
- Welcome is no longer a landing page: Recent as a tabular list, sectioned templates with counts, search with "/", and a quiet checklist.
- Template art is restrained and believable.
- The light theme is the cleanest of the three and photographs beautifully.

---

## 8. Top 10 fixes, in order

1. **P0-1** Fix the PDF copy now ("Image PDF", no "Print-ready"). Track vector PDF + PDF/X presets.
2. **P1-1** One `Segmented` component everywhere: clear dark active tile, HC yellow, no translucent disabled-active.
3. **P1-3** One colour popover body for every Fill/Stroke chip.
4. **P1-5** Themed `::selection` (accent wash), so there's no OS blue.
5. **P1-2** Curves: filled Input/Output, Reset out of the channel track, a lighter histogram ghost, end-point knobs.
6. **P1-7** Hide text-frame outlines at rest, and name text layers by their content.
7. **P1-4** One home for Opacity/Blend across studios.
8. **P1-8** Sentence case on every button, title and tab, plus a lint test.
9. **P1-9** A visible "Search commands · Ctrl K" field in the top bar.
10. **P1-6 / P1-12** White page thumbnails in New Document (dark/HC), and HC canvas handles in yellow.

Then P1-10 (shapes in Photo), P1-11 (Export Area/Scale and the dead void) and P1-13 (histogram header), then the P2 list.
