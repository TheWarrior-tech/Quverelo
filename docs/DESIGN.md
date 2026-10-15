# Quvrelo design system

Status: v3 shell (2026-10-15; v1 2026-10-14). Source of truth for every screen. Tokens live in `src/renderer/styles.css` (`:root`, `[data-theme]`); icons in `src/renderer/ui/Icons.tsx`. If a screen needs a value that is not here, add it here first.

## 1. Intent

Quvrelo is a tool for making things, so the interface should disappear: calm graphite surfaces, one accent, hairlines instead of boxes, dense but never cramped, numbers that don't jiggle. A first-time student should find the tool in one glance; a pro should never wait on a transition.

Feel references (studied for structure and restraint, nothing copied): Linear (charcoal ramp, 13px UI, translucent hairlines, 4/6/8 radii), Raycast (single accent, tiny type, keycaps), Glyphs (tool-first, one accent), Figma / Affinity V3 (panel density, 24–28px rows), Arc (quiet chrome). Pattern notes from Mobbin (Framer, FLORA, Descript, Frame.io): two radii only, selection is a colour swap not a pill of colour, accent in four roles only, segmented controls as contained pills with a contrasting active tile, dialogs on a dimmed backdrop with a hairline above the footer, a single thin accent playhead. Notes: `docs/design/refs/NOTES.md`.

## 2. Anti-slop rules (reviewable, each is a checklist item)

1. No gradients on chrome, buttons, cards or logos. (Gradients only inside user artwork and the colour picker.)
2. No glass / blur blobs, no coloured glows, no drop shadows on resting controls.
3. No emoji, no unicode glyphs as icons (`✕ ▲ ▼ ＋`). Every icon comes from `Icons.tsx`.
4. Exactly one accent colour (verdigris). It appears only on: the active tool, the one primary button per view, focus rings and selection outlines, slider/checkbox "on" state, text links. Studios are not colour-coded.
5. Two radii: `4px` controls, `8px` containers (dialogs, cards, popovers). `999px` only for knobs and count pills. Nothing in between.
6. Elevation: resting surfaces are flat and separated by one-stop tone shifts and 1px hairlines. Only popovers/dialogs/toasts carry a shadow (plus the scroll-edge shade, §6, shown only while a panel is scrolled).
7. Left-aligned, grid-aligned layouts. No centred hero blocks inside the app.
8. Every number is tabular (`font-variant-numeric: tabular-nums`).
9. Motion ≤ 150 ms, ease-out, opacity/transform only, removed under `prefers-reduced-motion` and the in-app "reduce motion" setting.
10. Nothing is decorated unless it carries meaning.

## 3. Colour

Neutrals are near-grey with ~0 chroma so photography never fights the chrome. Three themes: `dark` (default), `light`, `high-contrast`.

| Token | Dark | Light | High contrast | Use |
|---|---|---|---|---|
| `--c-canvas` | `#0d0e0f` | `#dedfdd` | `#000` | pasteboard behind the page |
| `--c-app` | `#131415` | `#f1f1ef` | `#000` | window chrome: top bar, status bar, tool rail |
| `--c-panel` | `#17181a` | `#f8f8f7` | `#000` | side panels, context bar |
| `--c-raised` | `#1e1f21` | `#ffffff` | `#0d0d0d` | inputs, segmented active tile, cards |
| `--c-popover` | `#222326` | `#ffffff` | `#000` | menus, dialogs, toasts |
| `--c-hover` | `rgba(255,255,255,.05)` | `rgba(0,0,0,.05)` | `rgba(255,255,255,.18)` | hover fill |
| `--c-press` | `rgba(255,255,255,.09)` | `rgba(0,0,0,.09)` | `rgba(255,255,255,.3)` | pressed / active fill |
| `--c-line` | `rgba(255,255,255,.08)` | `rgba(0,0,0,.09)` | `#fff` | 1px hairlines |
| `--c-line-strong` | `rgba(255,255,255,.34)` | `rgba(0,0,0,.43)` | `#fff` | input/button borders, keycaps, slider track (≥ 3:1, WCAG 1.4.11) |
| `--c-text` | `#ececed` | `#18191b` | `#fff` | primary text |
| `--c-text-2` | `#a3a5aa` | `#54565b` | `#fff` | secondary text, labels |
| `--c-text-3` | `#8b8d93` | `#606268` | `#e6e6e6` | tertiary, placeholders, units |
| `--c-accent` | `#3cc4b0` | `#0c7a6b` | `#ffd400` | accent (see rule 4) |
| `--c-accent-hover` | `#58d3c0` | `#096558` | `#ffe766` | |
| `--c-accent-ink` | `#06231e` | `#ffffff` | `#000` | text on solid accent |
| `--c-accent-wash` | accent 14 % | accent 12 % | accent 25 % | selected row fill |
| `--c-focus` | `#58d3c0` | `#096558` | `#ffd400` | 2px focus ring, offset 1px |
| `--c-danger` | `#ff6b6b` | `#c92a2a` | `#ff8080` | destructive text/icons only |

Contrast (WCAG 2.2 AA minimum, checked): text on panel ≥ 12:1; text-2 ≥ 7:1; text-3 ≥ 4.5:1; accent-ink on accent ≥ 7:1; accent as text on panel ≥ 4.5:1; focus ring, accent fills and `--c-line-strong` boundaries ≥ 3:1 on every surface. `--c-line` hairlines are decorative and exempt. Enforced by `npm run audit:contrast` (scripts/contrast-audit.mjs, also run by vitest) for all three themes — change a token, run it.

Canvas overlays (selection, handles, hover, guides) use accent `#2fb8a6` for selection and hover, coral `#ff6b4a` for snapping and margins, cyan for ruler guides, so they stay legible on photographs. Handles are solid accent with a 1px white ring, so they read on dark, light and photographic content alike.

## 4. Type

Typeface: **Inter** (SIL OFL, bundled via `@fontsource/inter`, weights 400/500/600). Monospace only for keycaps: system `ui-monospace`. Document typefaces (Merriweather, Roboto Slab, Caveat, Atkinson, OpenDyslexic) are content, never chrome. Dyslexia-friendly chrome option swaps `--font-ui`.

Features: `"cv11" "ss03"` off; `"tnum" "calt"` on for numerals; tracking −0.005em at 12–13px.

| Role | Size / line | Weight | Use |
|---|---|---|---|
| `--t-micro` | 11 / 16 | 500, +0.04em, uppercase | panel section labels |
| `--t-ui` | 12 / 16 | 400 / 500 | all panel and toolbar text, inputs |
| `--t-body` | 13 / 20 | 400 | dialog body, menus, descriptions |
| `--t-title` | 14 / 20 | 600 | dialog titles, card titles |
| `--t-h2` | 18 / 24 | 600, −0.01em | welcome section headings |
| `--t-display` | 24 / 28 | 600, −0.02em | welcome title only |

Weights: 400 body, 500 labels/controls in active state, 600 titles. Never 700+.

## 5. Space, size, grid

4px base; allowed steps 4 · 8 · 12 · 16 · 24 · 32 · 48. Control heights: `24` (compact: panel inputs, segmented, small buttons), `28` (default buttons, top bar), `32` (dialog actions). Tool rail buttons `32×32` on a `44px` rail. Panel row height `28`, layer row `28`. Top bar `44` (`--h-top`), context bar `36`, status bar `24`. Shell columns (v3): tool rail `44` (`--w-tools`) · left rail `248` (`--w-rail`) · canvas · inspector `288` (`--w-inspector`). The rails run full height between top bar and status bar; the context bar sits over the canvas column only. All hairlines are 1 device-independent px drawn as `box-shadow`/`border` so they stay crisp at 150 %/200 %.

## 6. Radius, elevation, motion

- Radius: `--r-1: 4px` (buttons, inputs, rows, tiles) · `--r-2: 8px` (dialogs, popovers, cards, thumbnails) · `--r-full: 999px` (knobs, count pills). One derived value, `--r-tile: calc(var(--r-1) - 1px)`, for tiles inset inside a 4px track (segmented controls) and checkboxes. No literal radii anywhere else.
- Elevation: `--e-0` none · scroll edges (the one exception on resting chrome): a hairline plus a short soft shade appears at the top/bottom of a scrolling panel only while content is hidden past that edge · `--e-1` popover `0 0 0 1px line, 0 4px 16px rgba(0,0,0,.28)` · `--e-2` dialog `0 0 0 1px line, 0 16px 48px rgba(0,0,0,.4)`.
- Motion: `--dur: 120ms`, `--ease: cubic-bezier(.2,.7,.3,1)`. Allowed: background/colour/opacity fades, 4px toast slide, dialog 4px rise. No bouncing, no scaling on hover.

## 7. Iconography

Custom set drawn for Quvrelo (`src/renderer/ui/Icons.tsx`), no third-party glyphs.
- Grid `20×20`, live area `16×16` (2px padding), pixel-aligned to 0.5.
- Stroke `1.5`, `round` caps and joins, never filled except `mask`, `adjust`, tiny anchor dots. Corner radius `1.5` on rects, `1` on small squares.
- Displayed at `20px` in the tool rail (1:1 on the grid) and `16px` inline (stroke bumps to `1.75` so it still reads as 1.4px).
- Colour is `currentColor`; active tool rail icon uses accent-ink on accent fill.
- Studios have glyphs (photo = aperture, vector = node curve, layout = columns). No coloured studio badges.

App icon / logo: graphite tile, off-white ring, one accent bar forming the Q tail. Flat, no gradient, no shadow. Source `build/icon.svg`; `build/icon-small.svg` is the 16–32px variant (near full-bleed tile, no inner hairline, heavier ring and tail). Re-render every raster with `scripts/render-icons.cjs` (each size rasterised from vector).

Icon buttons: use `tip(label, commandId | key)` from `ui/tooltip.ts` — `aria-label` is the name, the tooltip is name + shortcut read from the app menu, `aria-keyshortcuts` is set.

## 8. Components

**Shell v3 layout.** Four columns under the top bar: tool rail · left rail (document structure) · canvas (context bar on top) · inspector. Tab (outside a field) hides both rails. Grid and geometry live in `ui/shell.css`; nothing in the shell is positioned with inline styles except runtime geometry (popover/toolbar coordinates, virtualised rows, font-face previews), which `tests/unit/shellLint.test.ts` enforces.

**Top bar (44), three semantic zones** (Mobbin cross-app pattern 4). The outer columns are equal width so the centre zone is truly centred.
1. *Identity* (left): app mark · document name (500, truncates at 280; click to rename in place, Enter commits, Esc cancels) · save state as quiet 11px text with a 6px dot: `Saved` (hollow `text-3` dot), `Edited` (accent dot, `text-2`), `Not saved` (never saved).
2. *Studio + tools* (centre): studio switch, a 16px hairline, then Undo · Redo · Place image (28×28 icon buttons).
3. *Outbound* (right): Open · Save · Keyboard shortcuts · Preferences icon buttons, then **Export** as the only filled primary button in the bar (icon + label, 28 high). Align and boolean actions moved to the inspector and the selection toolbar.

**Studio switch.** Segmented control: 28 high, 4px inner padding, `--c-raised` track with hairline, active segment `--c-press` fill + text primary, icon in accent. Neither colour-coded nor underlined. Keyboard: arrow keys move, Enter selects.

**Tool rail (44 wide).** `--c-app`, hairline right. 32×32 buttons, 2px gap, groups divided by an 8px gap plus a 16px hairline (no heavy dividers). Active = solid accent with accent-ink icon. Tooltips show name + shortcut as keycaps. **Flyouts:** related tools share one button (layout and groups in `state/toolGroups.ts`): it shows the active or last-used member and carries a 4px corner triangle (bottom-right, 3px inset, `currentColor` at 80 %). Click uses the shown tool; right-click, a 350ms long-press, →, Alt+↓, Shift+F10 or the context-menu key open the flyout (press-drag-release on an item picks it). Flyout = `role="menu"` beside the button (4px gap, first row level with the button): `--c-popover`, `--r-2`, `--e-1`, 4px padding, 28px `menuitemradio` rows with 4px radius (check · 16px icon · name · keycap in `text-3`), the shown tool checked with `--c-press` fill (HC: black + 2px yellow inset). ↑/↓/Home/End move, Enter/Space or a tool's letter picks, Esc/←/Tab close and return focus. Shift + any member's key cycles the group; a member without its own key advertises `Shift+<group key>` in its tooltip. 120ms fade + 4px slide, none under reduced motion. Colour chips at the bottom: two overlapping 20px squares, 1px line-strong border, swap icon.

**Context bar (36).** Tool name at 500, then controls in groups separated by a 16px hairline. Sliders show label, 96px track, tabular value. Modes (New/Add/Subtract/Intersect) are a segmented control. Hint text is `text-3`, never competes with controls.

**Left rail (248).** Tabs **Layers · Pages · Assets** (Figma/Framer pattern), 36px header with a hairline below. Tabs are text buttons (active = primary text on `--c-press`, 4px radius, no underline; arrow keys/Home/End move and select). Default tab: Layers in Photo and Vector, Pages in Layout; the choice is remembered per studio. Assets holds document swatches + recent colours, then Shapes & symbols, then placed Images (with a teaching empty state).

**Inspector (288).** Tabs **Design · Adjust (Photo only) · History**, remembered per studio. The Design tab is grouped by concern, in this order:
1. Header 32: object name (13/600) and, when it differs from the name, its kind in `text-3` 11/500.
2. Align bar 36: six align buttons, hairline, distribute H/V (enabled at 3+), Boolean menu (Vector, 2+).
3. **Appearance**: Fill row · Stroke row (+ width · dash · cap · join when on) · Opacity slider · Blend. Text and text frames show *Colour* in place of Fill.
4. **Transform** (unit in the header): one 4-up row X · Y · W · H (no unit suffix, so five digits fit), then R · S · flip H · flip V.
5. The object's own section last (Rectangle radius, Polygon sides, Star points/inner, Text frame columns + frame fill + linking, Picture frame fit/zoom/offset/replace, Pixels), then Mask.
Nothing selected: Document (title, size, pages, background chip) and *New objects* (default fill/stroke rows). Rows use a 56px label column; sections are flat with a micro-label disclosure (remembered per section), hairline between, and a section you expand scrolls itself into view.

**Colour control (one everywhere).** `ColorChipButton` is the only colour trigger in the shell: a 20px chip (optionally with a chevron in the context bar) that opens the shared picker in a popover. The inspector's `PaintRow` is chip · hex field · add/remove; its chip opens the full paint editor (None · Solid · Linear · Radial + picker) to the *left* of the inspector so it never covers the panel. Context bar (shape tools, brush, flood fill), selection toolbar and document background all use it. No native `<input type="color">` anywhere in the shell.

**Layers.** Header 36: blend select · Opacity number field (scrub label). Row 28, full bleed: 16px indent per group level, chevron twisty, 24×20 thumbnail (4px radius, hairline; vector thumbnails tint the type glyph with the fill), name (12), status icons (mask, live adjustments) in `text-3`, then lock/eye toggles that appear on hover, keyboard focus or selection, and stay visible while they carry state (hidden, locked). Rows are inset 4px with a 4px radius. Hover = `--c-hover` fill only; selected = accent-wash fill + 2px inset accent bar + name at 500 (hover on a selected row keeps the wash, never the grey hover). Hovering a row draws the hover outline on the canvas. High contrast = black fill + 2px yellow inset outline when selected, 1px white outline on hover, no washes. Photo keeps the blend · opacity header (36); Vector and Layout edit those in the inspector. **Empty state:** a teaching block, never a bare line: 32px glyph tile, “No layers yet” (13/600), one line on what lives here, then ghost actions *Place image* · *Draw a shape* (Photo: *Paint*) · *Add text*, and “Or drop an image file onto the canvas.” in `text-3`. Drag: the dragged row dims, insertion = 2px accent line with a 6px ring at its start, above or below the hovered row. Keyboard: ↑/↓ move focus, ←/→ collapse/expand, Enter selects, F2 renames, Alt+↑/↓ reorders, Alt+H toggles visibility. Footer actions are 24×24 icon buttons.

**Segmented control (shared).** `ui/controls/Segmented.tsx` is the one implementation (radio group, roving focus, arrows move and select; optional icon-only segments with an accessible name; disabled segments skipped). `sm` = 24 track / 20 tiles, `md` = 28 / 22. Used for paint type, colour model, selection mode, frame fit, curves channel.

**Context-bar hint (`CtxHint`).** One quiet line in `text-3`, ≤ 60 characters, pattern “Drag to … · Shift …”, truncates with an ellipsis (full text in the tooltip) and hides below 1280px. Never a coloured span.

**Menus (`MenuButton`).** Ghost trigger (icon and/or label + 12px chevron), opens an 8px-radius popover of 28px items (16px icon, label 13, keycaps right in `text-3`); arrows/Home/End move, Enter runs, Esc closes and returns focus.

**Popovers.** Portal to body, placement below/above/right/left with flip-on-overflow, close on Esc or outside press and return focus to the anchor. Focus moves to the first control once, after placement (`[data-autofocus]`, else the roving tab stop, else the first input/button) and never again on re-render, so committing a value never steals focus.

**Font picker.** Trigger shows the family set in its own face (168 wide in the context bar, 136 borderless in the selection toolbar). Popover 264 wide: search field (36 high, autofocused, a combobox), then sections Recent (5) · Bundled · System · Installed (Local Font Access, policy `local-fonts`), each row 28 high set in its own face at 13px, current font ticked in accent. Arrow keys live-preview, Enter commits (and records Recent), Esc or an outside click reverts to the font the list opened with. The list is windowed.

**Selection toolbar (floating).** `--c-popover`, 8px radius, `--e-1`, 36 high, 4px padding. Anchored 8px below the selection bounds, centred, clamped 8px inside the canvas; flips above when there is no room. Shown after pointer-up with the Move tool; hidden while the pointer is down, while transforming or panning, for 160ms after a wheel zoom, and while editing text. Fades in 100ms with a 4px slide (none under reduced motion). Content by selection: shapes = Fill chip · Stroke chip; text = font · size · bold · italic · colour; picture frame = Fit menu · Replace…; pixel layer = flip H · flip V · rotate; then hairline · Arrange menu (front/forward/backward/back with keycaps) · Boolean menu (Vector, 2+ shapes) · Group/Ungroup · Duplicate · Delete. F6 moves focus in (and back to the canvas), arrows move between buttons, Esc returns to the canvas. Preferences ▸ Canvas ▸ “Floating selection toolbar” turns it off (`showSelectionToolbar`).

**Empty states (`EmptyState`).** 32px glyph tile (`--c-raised`, hairline, 8px radius, 20px icon in `text-3`), title 13/600, one body line `text-2`, ghost actions stacked full width, optional footnote 11px `text-3`. Left-aligned, no illustration. Used by Layers and Assets ▸ Images.

**Inputs.** 24 high, `--c-raised`, 1px line-strong, 4px radius, text 12 tabular. Focus = border accent + 2px ring. **Number fields** (`NumberField`): scrub label on the left (letter or word, `text-3`, `ew-resize` cursor; drag 1px = 1 step, Shift ×10, Alt ×0.1, pointer-locked so drags never run out), value, unit suffix inside the field in `text-3`. Arrow keys step with the same modifiers, Enter commits, Esc reverts, typed units convert (`10mm` in a px field) and simple arithmetic evaluates (`100+20`). The input is the accessible `spinbutton`; the label is decorative. A live scrub is one undo step. Selects: custom chevron icon. Checkbox 14px, radius 3, accent when on. Radio group = segmented.

**Sliders.** 2px track (line-strong) with the accent fill from the origin to the value, 12px thumb (off-white, 1px shadow ring), thumb gets accent ring on hover/focus; value is a paired number field (slider row: label 72 · track · value 56). The label scrubs too.

**Buttons.** Default: `--c-raised`, hairline, 28 high, 12px text 500. Primary: accent fill + accent-ink text (one per view). Ghost: no fill, hover fill. Danger text only. Disabled 40 % opacity, `not-allowed` cursor absent in desktop (default).

**Colour picker.** Saturation/value box (152 high, 8px radius) or hue wheel (152, brightness strip under it); preview tile 28 (checkerboard under alpha), hue strip and alpha strip 10px with 12px knobs filled with the current colour, eyedropper (system EyeDropper, else the canvas picker tool). Model segmented control Hex · RGB · HSL · CMYK (device CMYK, uncalibrated) and Box · Wheel; channel fields are number fields in one row (+ A for alpha). Document palette and Recent (12, most-recent-first) as 16px swatches, 4px radius, hairline; the swatch matching the current colour has an accent ring. Every strip and the box are keyboard sliders (arrows, Shift ×10). **Fill/stroke chips:** overlapping 28px squares (22 on the tool rail), fill top-left, stroke as a 4px ring bottom-right, 1px surface-coloured gap so they read on any theme; none = hairline square with a danger diagonal; the active target sits on top with a `text-2` ring; swap button beside. Context-bar colour controls are a chip + chevron that opens the picker in a popover.

**Dialogs.** 8px radius, `--c-popover`, `--e-2`, backdrop `rgba(0,0,0,.55)` (no blur). Header 48 with title (14/600) and close icon; body 16 padding; footer separated by hairline, buttons right-aligned, primary last. Width 480 default, 840 wide. Esc closes, focus trapped, focus returns.

**Menus / selects.** `--c-popover`, 8px radius, items 28 high with 4px inner radius, keycaps right-aligned in `text-3`.

**Toasts.** Bottom-centre over the canvas area (never over panels or the tool rail), auto-dismiss 3 s (errors 5 s), paused on hover, `--c-popover`, 1px line, 6px status dot (accent / danger), 12px text, 120ms rise.

**Welcome.** Left-aligned content column max 1120. Header: mark + wordmark (display) and one line of description; Open (default) and New document (primary) right. "Start" = three rows of studio entries (line icon in a 32px neutral tile, title, one-line description, shortcut hint), flat cards with hairline and 8px radius. Template sections: micro-label heading with count and hairline, 6-up grid of thumbnails on pasteboard tone (no extra frame), title 12/500, meta 11 `text-3`. Recent files as a table-like list (name, location, 28px rows). No gradients, no big illustrations.

**Export / preferences.** Dialog with a left list (grouped, 4px-radius active row) and a form on the right; labels 12 `text-2`; dividers hairline; preview thumbnail on pasteboard tone with filename + dimensions as tabular text.

**Status bar (24).** Left: size, selection count, status. Right: units select, zoom control (− value +), snap. All 11–12px tabular, `text-2`.

**Rulers.** 20px, `--c-app`, page extent one tone up (`--c-raised`), minor ticks 4/7px, labels 9px tabular `text-3` inset 3px. Layout adds margin (coral) and bleed bands on the ruler's inner edge.

**Canvas selection and hover.** Selection = 1px `#2fb8a6` box + 7×7 solid accent handles with a 1px white ring (edge handles only when the box is wider than 28px) + accent rotation knob 20px above the top edge; in a multi-selection each member also gets a 1px outline at 55 %. Hover = the same 1px accent outline with *no* handles, never drawn on a selected node or while dragging, and also shown when a layer row is hovered. So hover vs selected is unambiguous: handles mean selected. Drawn in screen space so they never scale with zoom. Same in Vector and Layout for every tool except Node/Crop; Photo shows it with Move only. The pixel selection (marching ants) is drawn only in Photo.

**Layout canvas.** Page edge hairline, dashed bleed, coral margins at 60 %, column guides at 40 %; none of these appear in Photo or Vector.

**Curves.** 256×256 graph, `--r-2`, `--c-canvas` fill, 4×4 hairline grid, histogram at 20 %, 1.5px curve, 8px knobs (selected = white + accent ring), RGB·R·G·B segmented control, Input/Output fields.

## 9. Accessibility (must not regress)

Focus ring 2px `--c-focus` + 1px offset on every interactive element; high-contrast uses 3px. All icon buttons have `aria-label`; tooltip text equals label. Target size ≥ 24×24 (WCAG 2.2 AA 2.5.8). Contrast table above. No information by colour alone (active tool also has fill + `aria-pressed`). Reduced motion honoured. Forced-colours supported via high-contrast theme.

## 10. Review checklist (design critic)

Per screen, in dark/light/high-contrast, at 100/150/200 %: alignment to 4px grid; two radii only; one accent, used only per rule 4; hairlines crisp; no gradient/glow/emoji; consistent icon weight; tabular numerals; no centred hero; contrast; focus visible; hit targets. Compare against Affinity V3/Photoshop/Linear/Figma screenshots; list anything that reads generic.
