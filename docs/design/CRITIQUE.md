# Quvrelo UI critique: design review 1

Reviewer: independent design critic · 2026-10-14 · branch `ui/critic` @ `e0bcb8e`
Captures: `QUVRELO_REVIEW_DIR=/workspace/work/review-current xvfb-run -a npx playwright test tests/e2e/design-review.spec.ts` (24 PNGs, 1440×873, dark / light / high-contrast × welcome, photo, vector, layout, preferences, export, shortcuts, new).
References: Affinity V3 (Photo persona screenshot, lenscraft.co.uk/photography-blog/affinity-3-for-photographers/), Linear and Raycast token extracts (inspomcp.dev/sites/linear-app, /sites/raycast-com), `docs/design/refs/NOTES.md`.

**Verdict.** Batch 1 got the foundations right: a graphite palette, one accent, hairlines, Inter, no glows. What still gives it away as a generated "web app in an Electron shell" is (a) state bugs that a pro would spot in seconds (stale selections, two active segments, objects vanishing behind modals, no selection handles), (b) photo tooling that looks like it is faking its features (Curves drawn as three sliders), (c) form-style chrome (outlined buttons in the context bar, nested bordered cards in panels), and (d) the template art on Welcome, which is the most "AI-made" thing in the app. Density is about 70 % of Affinity's: fewer tools, larger empty voids, panels that clip instead of scroll.

Severity: **P0** = a pro notices within 10 s / reads broken or fake. **P1** = reads generic or amateur, or breaks DESIGN.md. **P2** = polish.

---

## P0

1. **Canvas: stale photo selection leaks into Vector and Layout.** (`dark-vector.png`, `dark-layout.png`) The ellipse marquee drawn in Photo stays on screen, marching ants and all, after switching studios. Two studios now show two different selection systems at once.
   *Fix:* hide the pixel-selection overlay whenever `studio !== 'photo'` (keep it in the model, just don't render it), or clear it on switch with an undo entry. In Vector/Layout the only selection visual is the object bounding box.

2. **Vector: the selected object has no bounding box or handles.** (`dark-vector.png`) The status bar says "1 selected" and Properties shows RECTANGLE, but the rectangle on canvas has no visible selection: no box, no 8 handles, no rotation affordance. This is the core interaction of a vector app.
   *Fix:* draw the selection box at 1px `#2fb8a6` (canvas-selection token), handles 7×7 white fill + 1px accent stroke at corners/edges, scaled by `1/zoom` so they stay 7 device px; show W×H in a small tabular label under the box while dragging.

3. **Studio switch: two segments look active.** (`dark-layout.png`) After clicking Layout, "Vector" still has the `--c-press` fill and "Layout" has it too. Users can't tell which studio they are in.
   *Fix:* exactly one segment gets `[aria-pressed=true]` styling. Hover must use `--c-hover` (lighter than press), and the press fill must not stick after a click (check that `:focus` isn't styled like active; use `:focus-visible` for the ring only).

4. **Dialogs: vector/layout objects disappear behind the backdrop.** (`dark-preferences.png`, `dark-export.png`, `dark-new.png` vs `dark-layout.png`) With any modal open, the star and rectangle are gone from the canvas and only the photo remains. It reads as if opening Preferences wiped the work.
   *Fix:* the modal must not change canvas render state. Render the canvas as-is under a `rgba(0,0,0,.55)` backdrop. Look for a render path that skips vector layers when the canvas loses focus or a dialog sets `pointer-events`/visibility.

5. **Photo · Adjustments: Curves is three sliders.** (`dark-photo.png`) "Shadows / Midtones / Highlights" sliders labelled Curves is the clearest "fake feature" tell. Every reference (Affinity, Photoshop, Lightroom) shows a curve graph.
   *Fix:* a 256×160 curve editor: 8px radius, `--c-canvas` fill, 4×4 hairline grid, histogram ghost behind at 20 %, a 1.5px `--c-text` curve, 8px point knobs, a channel segmented control (RGB · R · G · B) above it, plus Input/Output numeric fields. If that can't ship yet, rename the item "Tone (3-point)" rather than call it Curves.

6. **Welcome: template thumbnails look like stock AI filler.** (`dark-welcome.png`, `high-contrast-welcome.png`) There are two identical purple-to-blue gradient "BIG EVENT TITLE HERE" posters with a ★ star, a rainbow-dot "Classroom Rules", rainbow name badges and a cyan clip-art worksheet header. These are the first things a buyer sees and they break anti-slop rule 1 in spirit.
   *Fix:* redo the template art (`src/core/templates.ts`) with a restrained system: one typeface pairing per template, at most 2 colours plus neutrals, no gradients, no stars, real-looking placeholder copy ("Year 8 Science Fair · 14 March") instead of "TITLE HERE". Remove the duplicate poster. Thumbnails need real document typography at render scale, so render them at 2× and downsample.

7. **Welcome: hyphens render spaced ("5 - day, 6 - period", "Double - sided", "cut - out").** (all welcome captures) Cause: `.template-card span` gets `font-feature-settings: 'calt','tnum'` (`styles.css:195-203`), and Inter's `tnum` gives punctuation tabular width.
   *Fix:* scope tabular numerals to numeric spans only (`.num`, dims). Prose meta uses plain `'calt'`. Better still, put `font-variant-numeric: tabular-nums` without `tnum` in `font-feature-settings` and only on number elements.

## P1

8. **Context bar (Photo): a row of outlined buttons reads like a web form.** (`dark-photo.png`, `high-contrast-photo.png`) "Select all · Invert · Deselect · Crop · To new layer · Mask layer" are six bordered 28px buttons. Affinity V3 uses an icon-led contextual toolbar with ghost controls.
   *Fix:* make them ghost buttons (`background: transparent; border: 0`, hover `--c-hover`, 24px high), grouped behind a 16px hairline divider. Make Select all, Deselect and Invert 24×24 icon buttons with tooltips. Keep text only for "Crop to selection" and "Mask layer". Use the same treatment in every studio's context bar.

9. **Panels: nested bordered cards = the "rounded-card look".** (`dark-photo.png` Adjustments; `dark-layout.png` Pages) Each adjustment is a bordered, rounded card inside a panel, the Pages thumbnail sits in a raised card with its own border, and the Fill segmented control is boxed. This doubles the hairlines and wastes 8–12px per item.
   *Fix:* adjustments become flat sections: a 28px header row (checkbox · name · reset · delete icons shown on hover) with a hairline between items, no card border, no 8px radius. Pages: drop the card; the thumbnail gets `--r-2` and a hairline, and selection is a 2px accent outline on the thumbnail only.

10. **Panels: the right column clips instead of scrolling or resizing.** (`dark-vector.png`, `dark-photo.png`) Properties is cut mid-control (the FILL segmented control is half visible at y≈412) and Vibrance is cut at its first slider, while the Layers group below has 120+ px of empty void. The three fixed-height groups are what make it look unfinished.
   *Fix:* a resizable split between groups (4px drag handle on the hairline, persisted). Give the group with focus the free space (`flex: 1 1 auto; min-height: 120px`), cap Layers by content (`flex: 0 1 auto`). Add collapsible group headers (twisty plus micro label) as Affinity does.

11. **Layers: blend-mode select has no visible value and opacity has no label.** (`dark-photo.png`, `dark-vector.png`, `high-contrast-photo.png`) The Layers header shows an empty 36px box with a chevron, then a bare slider.
   *Fix:* a 28px row: blend select (min-width 96, shows "Normal") · "Opacity" micro label · 72px slider · 40px tabular value. Use the same component as the Properties "Opacity/Blend" rows so the two match.

12. **Welcome: the studio cards and the welcome layout read as a SaaS landing page.** (`dark-welcome.png`) A centred 1040px column, a hero row with the description, three big cards with accent-coloured icons (breaks rule 4: accent only for active/primary), and no Recent files section.
   *Fix:* left-align the column at a 48px gutter (DESIGN.md §8 says left-aligned). Studio entries go `--c-text-2` icon in a neutral 32px tile, with the accent only on hover/focus ring. Add "Recent" first (28px rows: name · location · modified, tabular), then Start, then Templates. Shrink the header to the mark plus a 18/600 wordmark. Display size isn't needed in-app.

13. **Welcome: the template grid is 5-up with ragged rows and letterboxing.** (all welcome captures) Portrait A4 pages sit in landscape tiles with wide black/pasteboard bars, the last row has an empty slot, and one tile (Lesson Plan) shows a stuck accent border.
   *Fix:* use a 6-up grid as DESIGN.md says (`grid-template-columns: repeat(auto-fill, minmax(160px,1fr))`, gap 16). Use a fixed tile aspect of 4:3 with the page centred and a soft 1px hairline page edge, no full-bleed black. Show the accent outline only on `:focus-visible`/hover, not on first render.

14. **Dialogs: initial focus lands on the close button.** (`dark-export.png`, `dark-new.png`, `dark-shortcuts.png`) A thick accent ring around × is the loudest thing in every dialog.
   *Fix:* send initial focus to the first field (New: Name, selected; Export: the Format segmented control; Prefs: Theme). The close button is reachable by Tab/Esc. Keep the ring `:focus-visible` only, 2px + 1px offset.

15. **Keyboard Shortcuts: mono "Ctrl+Shift+S" chips look like a terminal dump.** (`dark-shortcuts.png`) Each combo is a single monospace chip, "Ctrl+O" reads as "Ctrl+0", the single-letter caps are tiny, and there is no search.
   *Fix:* one keycap per key (`kbd` 18px high, min-width 18, 4px radius, 1px `--c-line-strong`, 11px Inter 500, `text-2`), 4px gap and no "+". Mac shows ⌘ ⇧ ⌥. Add a 28px search field at the top that filters rows. Group the menu commands (File, Edit, Arrange) with micro labels like the tool groups. Lighten the row hairlines to `--c-line` at 50 %, or drop them and rely on the 28px rhythm.

16. **Export: a bare form instead of a pro export surface.** (`dark-export.png`) It has no preview, no quality/area/slices, the segmented control's track stretches to 336px with the segments bunched left, and the checkbox crowds its label.
   *Fix:* use the DESIGN.md §8 pattern: an 840 dialog with a left preview on pasteboard tone (filename · W×H · estimated size, tabular), and a right form: Format (segmented, track hugs content `width: max-content`), Area (Whole document · Selection · Page range), Scale, Quality (JPG slider), Colour profile, Background. Checkbox-to-label gap 8px.

17. **New Document: inconsistent rhythm, no units, bold titles.** (`dark-new.png`) Field rows sit at about 47px, but Background/Open in are at about 42px. Margins and Bleed have no units. Template titles render at 700 (DESIGN.md: never 700+). Cause: bare `<strong>`/`<b>` in chrome (`Welcome.tsx:47,90,121`, likely the same in the New dialog) inherit the UA `font-weight: bolder`. The template list is text-only.
   *Fix:* 40px row pitch (28 control + 12 gap) throughout, label column 120. Units suffix inside the input (`mm`, `text-3`). Margins become 4 linked fields with a chain toggle. Template list rows get a 32×24 page thumbnail and titles at 500. Add a chrome reset `.app b, .app strong { font-weight: 600 }` (keep the 700/800 imports in `main.tsx`, since document text uses bold), or use `<span class="title">`.

18. **Preferences: too thin to look like a pro app, and the checkbox alignment is off.** (`dark-preferences.png`) It's a six-row form. "Show rulers ☑ Snapping" share one row with about 4px between them, the unchecked boxes sit about 2px above the text baseline, and the slider runs 290px for a single value.
   *Fix:* use the §8 grouped left-nav dialog (General · Appearance · Canvas · Units & Grid · Performance · Shortcuts · Accessibility). One checkbox per row, box vertically centred to the 16px line box (`align-items:center`), and 8px between box and label. Cap the slider track at 160 + a 48px value field.

19. **Radii break the two-radius rule.** `styles.css:540`, `:650`, `:1122` use `6px` (segmented items, choice rows, paint tabs), `:405` uses `3px` and `:437` uses `2px`. It shows in the segmented controls, whose inner tiles look softer than the inputs next to them.
   *Fix:* the inner segment tile goes to `calc(var(--r-1) - 1px)` = 3px only if the track is 4px with 1px padding. Otherwise use `--r-1`. Replace the literal `2px`/`3px` with tokens (`--r-1`, or `--r-check: 3px` documented in DESIGN.md).

20. **Unicode glyphs as icons remain.** `LayersPanel.tsx:99` twisty `▾ ▸`; `AdjustmentsPanel.tsx:72` "+ Add adjustment or filter…" draws a "+" in a native select; `AppDialogs.tsx:63` "red ➕"; help text uses "▸" for menu paths.
   *Fix:* twisty uses `Icon name="chevron-down/right"` at 12px. Replace the add-adjustment select with a 24px ghost button (plus icon + "Add adjustment") that opens a `--c-popover` menu grouped Light / Colour / Filters. Write menu paths as "File › Place Image" in text only, no emoji.

21. **Tool rail: too sparse next to Affinity, and the colour chips are weak.** (`dark-photo.png`, `dark-vector.png`) Photo has about 11 tools, while Affinity's Pixel persona has about 20 with flyouts. The stroke chip is a dark square almost invisible on `--c-app` in dark and a heavy black square in light.
   *Fix:* add sub-tool flyouts (a small 4px corner triangle on buttons with variants, long-press/right-click opens them), e.g. Marquee rect/ellipse/row/col, Brush/Pencil/Mixer, Fill/Gradient, Retouch (Clone, Heal, Dodge/Burn). Colour chips: 20px squares, fill on top-left, stroke drawn as a ring (3px inner border) on bottom-right, both with 1px `--c-line-strong` and a 1px inner `--c-app` gap so they read on any theme.

22. **The Layout studio is indistinguishable from Vector.** (`dark-layout.png`) A photo document in Layout shows no page frame, margins, columns, baseline grid or facing-pages context, and the context bar still says "Rectangle".
   *Fix:* in Layout, always draw page edge (1px `--c-line-strong`), margin guides (coral `#ff6b4a` at 60 %), and bleed (dashed). Default tool on entering Layout = Move, with a context bar showing page/spread controls. Pages panel: spread thumbnails 2-up.

23. **High contrast: the selected layer row is a muddy olive.** (`high-contrast-photo.png`) Yellow at 25 % over black gives a brown wash that reads dirty. The inactive "New" segment is grey-on-grey.
   *Fix:* HC selected row = black fill + 2px `#ffd400` outline (inset) and white text. HC active segment = yellow fill + black text, inactive = black fill + white text + 1px white outline. No translucent washes in HC.

24. **Toasts sit on top of panel content for the whole session.** (`dark-vector.png`, `dark-layout.png`) "Opened sample-photo.jpg" covers the swatch hint text across three screens.
   *Fix:* auto-dismiss after 3s (5s with an action), offset the stack above the panel column (`right: 288 + 16`) or above the status bar on the canvas side only, and pause dismissal on hover.

## P2

25. **Rulers:** labels sit flush against the major tick with no 2px inset, and "130" is clipped at the right end. Inset labels 3px right of the tick, clip-path the last label, and draw the zero-origin tick 1px `--c-text-3`.
26. **Histogram:** full saturated RGB fills are noisy next to a calm UI. Draw luminance as a `--c-text-3` filled area with R/G/B as 1px lines at 60 %, plus a channel toggle. 64px high, `--r-1`.
27. **Adjustment slider rows:** the value boxes don't line up with the slider centre lines (1–2px off). Use the §8 slider row grid `88px 1fr 48px` with `align-items:center`.
28. **Layer row:** the 2px accent selection bar has a 2px gap from the row's left edge, and "fx" is a text label. Make the bar flush (`box-shadow: inset 2px 0 var(--c-accent)`) and draw `fx` as an icon in `text-3`.
29. **Top bar:** the studio switch shifts horizontally between studios (centre ≈ 692px in the Vector capture vs ≈ 774px in Layout) because the right icon cluster changes width. Use a 3-column grid `1fr auto 1fr` so the switch is truly centred. Also add a hairline group divider between the align icons and the help/prefs pair.
30. **Context bar (Vector):** the Fill/Stroke swatches are 20px boxes with no label hierarchy. Make them 24×24 with a chevron that opens the colour popover, and put the stroke width as a number field with a "pt/px" suffix.
31. **Swatches:** the hint "Click to fill · Shift-click for stroke · right-click to remove" wraps to two lines. Move it into a tooltip on the panel's ⓘ icon, or a single line in `text-3` 11px.
32. **Scrollbars:** the native light-grey scrollbar shows on Welcome in dark. Style it: 8px, thumb `--c-line-strong`, track transparent, thumb hover `--c-text-3`.
33. **Section labels:** "RECTANGLE" appears twice in Properties (the transform and shape sections). Rename them TRANSFORM / SHAPE.
34. **Keycap tooltips and "Ctrl+," etc:** a mono comma is hard to read. Render it as "Ctrl ,", with a keycap for ",".
35. **Light theme:** the selected layer row's accent-wash is nearly invisible on `#f8f8f7`. Raise light `--c-accent-wash` to 16 % or add the 2px inset bar.

---

## What already works

- The graphite palette (`#0d0e0f → #131415 → #17181a → #1e1f21`) is calm, neutral and lets the photo dominate. It's on par with Affinity V3's dark UI.
- One accent, used with restraint: the active tool tile, the primary button, checkboxes. There are no studio colour codes and no glows.
- Hairline separation between top bar, context bar, rail and panels, with no heavy dividers or drop shadows on resting chrome.
- The custom icon set is consistent in stroke weight and optical size across the rail, top bar and panel footers. Nothing reads as a mixed icon pack.
- Inter at 12px with micro uppercase section labels gives a sound type hierarchy. Tabular numerals in X/Y/W/H and the status bar keep numbers from jiggling.
- Dialog chrome (8px radius, 48px header, hairline above the footer, primary last) matches DESIGN.md and looks professional.
- The flat Q logo mark is good: no gradient, readable at 20px.
- High contrast is a real theme (pure black, white hairlines, yellow accent) rather than an afterthought.
- Status bar density (size · selection · cursor · units · zoom · snap) is about right for a pro tool.
