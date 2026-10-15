# Quvrelo design system

Status: v3 shell + critique-2 shell fixes + critique-3 units, overflow, scrollbars, adjustment cards (2026-10-15; v1 2026-10-14). Source of truth for every screen. Tokens live in `src/renderer/styles.css` (`:root`, `[data-theme]`); icons in `src/renderer/ui/Icons.tsx`. If a screen needs a value that is not here, add it here first.

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
| `--c-accent-wash-strong` | accent 32 % | accent 24 % | `#ffd400` | text selection (`::selection`), never the OS blue |
| `--c-selection-ink` | `#ececed` | `#18191b` | `#000` | text on `--c-accent-wash-strong` |
| `--c-seg-track` · `--c-seg-on` · `--c-seg-ring` | see §8 Segmented | | | segmented control |
| `--c-focus` | `#58d3c0` | `#096558` | `#ffd400` | 2px focus ring, offset 1px |
| `--c-danger` | `#ff6b6b` | `#c92a2a` | `#ff8080` | destructive text/icons only |

Contrast (WCAG 2.2 AA minimum, checked; also selected text on the selection wash, and the segmented active tile against its track): text on panel ≥ 12:1; text-2 ≥ 7:1; text-3 ≥ 4.5:1; accent-ink on accent ≥ 7:1; accent as text on panel ≥ 4.5:1; focus ring, accent fills and `--c-line-strong` boundaries ≥ 3:1 on every surface. `--c-line` hairlines are decorative and exempt. Enforced by `npm run audit:contrast` (scripts/contrast-audit.mjs, also run by vitest) for all three themes — change a token, run it.

Canvas overlays (selection, handles, hover, guides) use accent `#2fb8a6` for selection and hover, coral `#ff6b4a` for snapping and margins, cyan for ruler guides, so they stay legible on photographs. Handles are solid accent with a 1px white ring, so they read on dark, light and photographic content alike. The selection colours are tokens the viewport reads from CSS on every theme change (`engine/controls.ts` `readOverlayColors`): `--c-canvas-selection`, `--c-canvas-handle`, `--c-canvas-handle-ring` = `#2fb8a6` / `#2fb8a6` / `#fff` in dark and light, and `#ffd400` / `#ffd400` / `#000` in high contrast, so canvas selection is yellow like every other high-contrast selection.

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

**Case.** Sentence case for every string Quvrelo draws: buttons, dialog titles, tabs, headings, labels, tooltips, tool names, toasts (“Document setup…”, “Check for updates”, “Don't save”, “Rectangle marquee”). Two exceptions: native menu items keep platform Title Case (`shared/menu.ts`), and so do the command-palette rows that mirror them and any text that quotes a menu item as a path (“File › Place Image”); proper nouns (Quvrelo, font and platform names, keys) keep their capitals. Micro-labels are uppercase by CSS, never typed in capitals. Enforced by `tests/unit/sentenceCase.test.ts` over `ui/` and the UI-facing `state/` modules.

## 5. Space, size, grid

4px base; allowed steps 4 · 8 · 12 · 16 · 24 · 32 · 48. Control heights: `24` (compact: panel inputs, segmented, small buttons), `28` (default buttons, top bar), `32` (dialog actions). Tool rail buttons `32×32` on a `44px` rail. Panel row height `28`, layer row `28`. Top bar `44` (`--h-top`), context bar `36`, status bar `24`. Shell columns (v3): tool rail `44` (`--w-tools`) · left rail `248` (`--w-rail`) · canvas · inspector `288` (`--w-inspector`). The rails run full height between top bar and status bar; the context bar sits over the canvas column only. All hairlines are 1 device-independent px drawn as `box-shadow`/`border` so they stay crisp at 150 %/200 %.

**Units.** Every length the user reads or types is in the document's own unit (`settings.unit`: mm for a Print preset, in for US paper, px for screen, social and photos), never a global preference. One formatter and one parser in `core/units.ts` (`formatLength` · `formatSize` · `lengthIn` · `parseLength`, precision from `UNIT_DIGITS`: px/pt/mm 1 decimal, cm 2, in 3, trailing zeros trimmed) feed the inspector, context bar, status bar, rulers, Document setup and Export, so the same length never reads two ways. Stroke widths and brush sizes stay in px/pt.

## 6. Radius, elevation, motion

- Radius: `--r-1: 4px` (buttons, inputs, rows, tiles) · `--r-2: 8px` (dialogs, popovers, cards, thumbnails) · `--r-full: 999px` (knobs, count pills). One derived value, `--r-tile: calc(var(--r-1) - 1px)`, for tiles inset inside a 4px track (segmented controls) and checkboxes, and `--r-hairline: 1px` for 2px tracks, ticks and insertion bars (slider track, checklist progress, layer drop line, orientation glyph, spread page corners). No literal radii anywhere else (`tests/unit/shellLint.test.ts` rejects a px `border-radius` outside the tokens).
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

Icon buttons: use `tip(label, commandId | key)` from `ui/tooltip.ts` — `aria-label` is the name, `data-tip` is the tooltip text and `data-keys` the shortcut read from the app menu (drawn as keycaps by `ui/Tooltip.tsx`), `aria-keyshortcuts` is set. Never use the native `title` attribute; any left over is taken over by the tooltip host on hover.

## 8. Components

**Shell v3 layout.** Four columns under the top bar: tool rail · left rail (document structure) · canvas (context bar on top) · inspector. Tab (outside a field) hides both rails. Grid and geometry live in `ui/shell.css`; nothing in the shell is positioned with inline styles except runtime geometry (popover/toolbar coordinates, virtualised rows, font-face previews), which `tests/unit/shellLint.test.ts` enforces.

**Top bar (44), three semantic zones** (Mobbin cross-app pattern 4). The outer columns are equal width and the centre column holds only the studio switch, so the switch sits on the window's centre line (±1px, e2e-checked).
1. *Identity* (left): app mark · document name (500, truncates at 280; click to rename in place, Enter commits, Esc cancels) · save state as quiet 11px text with a 6px dot: `Saved` (hollow `text-3` dot), `Edited` (accent dot, `text-2`), `Not saved` (never saved) · a 16px hairline · Undo · Redo · Place image (28×28 icon buttons).
2. *Studio* (centre): the studio switch, nothing else.
3. *Outbound* (right): **Search commands** field-button (28 high, 200 wide, `--c-raised`, hairline; 16px search icon, "Search commands" 12 `text-3`, `Ctrl` `K` keycaps; opens the command palette; below 1280px it collapses to a 28×28 icon button), then Open · Save · Keyboard shortcuts · Preferences icon buttons, then **Export** as the only filled primary button in the bar (icon + label, 28 high). Align and boolean actions moved to the inspector and the selection toolbar.

**Studio switch.** Segmented control: 28 high, 4px inner padding, `--c-raised` track with hairline, active segment `--c-press` fill + text primary, icon in accent. Neither colour-coded nor underlined. Keyboard: arrow keys move, Enter selects.

**Tool rail (44 wide).** `--c-app`, hairline right. 32×32 buttons, 2px gap, groups divided by an 8px gap plus a 16px hairline (no heavy dividers). Active = solid accent with accent-ink icon. Tooltips show name + shortcut as keycaps. **Flyouts:** related tools share one button (layout and groups in `state/toolGroups.ts`): it shows the active or last-used member and carries a 4px corner triangle (bottom-right, 3px inset, `currentColor` at 80 %). Click uses the shown tool; right-click, a 350ms long-press, →, Alt+↓, Shift+F10 or the context-menu key open the flyout (press-drag-release on an item picks it). Flyout = `role="menu"` beside the button (4px gap, first row level with the button): `--c-popover`, `--r-2`, `--e-1`, 4px padding, 28px `menuitemradio` rows with 4px radius (check · 16px icon · name · keycap in `text-3`), the shown tool checked with `--c-press` fill (HC: black + 2px yellow inset). ↑/↓/Home/End move, Enter/Space or a tool's letter picks, Esc/←/Tab close and return focus. Shift + any member's key cycles the group; a member without its own key advertises `Shift+<group key>` in its tooltip. Tool keys are per studio (`TOOL_KEYS` in `state/toolGroups.ts`). **Photo** has a Shapes flyout after Text (Rectangle · Ellipse · Polygon · Star, key `U`, Shift+U cycles, since M is the marquee and E the eraser there); a shape drawn in Photo is a vector layer inserted directly above the active layer. 120ms fade + 4px slide, none under reduced motion. Colour chips at the bottom: two overlapping 20px squares, 1px line-strong border, swap icon.

**Context bar (36).** Tool name at 500, then controls in groups separated by a 16px hairline. Sliders show label, 96px track, tabular value. Modes (New/Add/Subtract/Intersect) are a segmented control. Hint text is `text-3`, never competes with controls. **Priority+ overflow** (`controls/CtxOverflow.tsx`): the bar never scrolls and never cuts a word. When its groups don't fit the canvas column, the hint is dropped first (a hint is dropped rather than shown cut short), then groups collapse, lowest `<Pri n>` first (ties right to left), into a trailing ghost **More ▾** button whose popover holds them in a column. Page navigation and crop Cancel/Apply never collapse. Layout Move: Pages (always) · Margins (4) · Document setup (3) · Facing pages (2.5) · Columns (2) · Bleed (1). E2e-checked for every studio and tool at 1280 and 1440 (`scrollWidth ≤ clientWidth`).

**Left rail (248).** Tabs **Layers · Pages · Assets** (Figma/Framer pattern), 36px header with a hairline below. Tabs are text buttons (active = primary text on `--c-press`, 4px radius, no underline; arrow keys/Home/End move and select). Default tab: Layers in Photo and Vector, Pages in Layout; the choice is remembered per studio. Assets holds document swatches + recent colours, then Shapes & symbols, then placed Images (with a teaching empty state).

**Inspector (288).** Tabs **Design · Adjust (Photo only) · History**, remembered per studio. The Design tab is grouped by concern, in this order:
1. Header 32: object name (13/600, the same display name as the layer row) and, when it differs from the name, its kind in `text-3` 11/500.
2. Align bar 36: six align buttons, hairline, distribute H/V (enabled at 3+), Boolean menu (Vector, 2+).
3. **Appearance**: Fill row · Stroke row (+ width · dash · cap · join when on) · Opacity slider · Blend. Text and text frames show *Colour* in place of Fill. This is the one home for Opacity and Blend in every studio, Photo included (pixel layers show Opacity · Blend here).
4. **Transform** (the document unit in the header): one 4-up row X · Y · W · H (no unit suffix, so five digits fit), then R · S · flip H · flip V.
5. The object's own section last (Rectangle radius, Polygon sides, Star points/inner, Text frame columns + frame fill + linking, Picture frame fit/zoom/offset/replace, Pixels), then Mask.
Nothing selected: Document (title, size in the document unit with the output pixels as an 11px `text-3` second line, "2480 × 3508 px at 300 dpi", pages, background chip) and *New objects* (default fill/stroke rows). Rows use a 56px label column; sections are flat with a micro-label disclosure (remembered per section), hairline between, and a section you expand scrolls itself into view.

**Colour control (one everywhere).** `ColorChipButton` is the only colour trigger in the shell: a 20px chip (optionally with a chevron in the context bar) that opens `ColorPopoverBody` in a popover. There is one popover body: title, then the paint-type tabs **None · Solid · Linear · Radial** as the first row (always all four, in that order), then the picker (Solid) or the gradient editor. A target that can't take a type (brush and flood fill: no None, no gradients; text: no None; document background: no gradients) shows that tab disabled with a tooltip, never hidden, so the body is identical in the inspector, context bar, selection toolbar, tool rail and Document section. No "None" checkbox anywhere. The chip takes a `Paint` and returns a `Paint`; defaults for new objects are read and written through `state/uiPaint.ts`, so a default fill or stroke can be a gradient too. The inspector's `PaintRow` is chip · hex field · add/remove; its chip opens to the *left* of the inspector so it never covers the panel. No native `<input type="color">` anywhere in the shell.

**Layers.** No header controls: opacity and blend are edited only in Design › Appearance (all studios). Row 28, full bleed: 16px indent per group level, chevron twisty, 24×20 thumbnail (4px radius, hairline; vector thumbnails tint the type glyph with the fill), name (12; text layers that were never renamed show the first words of their text, ≤ 24 characters cut at a word with an ellipsis, "Text Frame" only when empty; F2 renames and the name then sticks), status icons (mask, live adjustments) in `text-3`, then lock/eye toggles that appear on hover, keyboard focus or selection, and stay visible while they carry state (hidden, locked). Rows are inset 4px with a 4px radius. Hover = `--c-hover` fill only; selected = accent-wash fill + 2px inset accent bar + name at 500 (hover on a selected row keeps the wash, never the grey hover). Hovering a row draws the hover outline on the canvas. High contrast = black fill + 2px yellow inset outline when selected, 1px white outline on hover, no washes. **Empty state:** a teaching block, never a bare line: 32px glyph tile, “No layers yet” (13/600), one line on what lives here, then ghost actions *Place image* · *Draw a shape* (Photo: *Paint*) · *Add text*, and “Or drop an image file onto the canvas.” in `text-3`. Drag: the dragged row dims, insertion = 2px accent line with a 6px ring at its start, above or below the hovered row. Keyboard: ↑/↓ move focus, ←/→ collapse/expand, Enter selects, F2 renames, Alt+↑/↓ reorders, Alt+H toggles visibility. Footer actions are 24×24 icon buttons: **+** (Add layer) opens a menu above it: Pixel layer · Group selection (2+) · Place image… · in Photo an *Adjustment* heading with the adjustment list (disabled, "Select a pixel layer first", until a pixel layer is selected); then Group · Mask · Duplicate · Forward · Backward · Delete.

**Segmented control (shared).** `ui/controls/Segmented.tsx` is the one implementation (radio group, roving focus, arrows move and select; optional icon-only segments with an accessible name; disabled segments skipped; `disabled` locks the whole group). `sm` = 24 track / 20 tiles (panels, context bar, colour picker), `md` = 28 / 24 (dialogs, via the `dialogs/controls.tsx` adapter, which only sets the size). Used for every one-of-few choice: paint type, colour model, selection mode, frame fit, dialog options (orientation, background, update channel, resize mode, export pages/background). There is no other segmented style (`.seg` and `.choice-row` are gone, the Curves channel switch included; `tests/unit/shellLint.test.ts` guards it). Tokens: track `--c-seg-track` with a `--c-line` hairline; active tile `--c-seg-on` + 1px `--c-seg-ring`, label `--c-seg-on-text` at 500.

| | Dark | Light | High contrast |
|---|---|---|---|
| track | `#1e1f21` | black 6 % | `#000` + 1px white |
| active tile | `#222326` + 1px white 34 % ring | `#fff` + 1px black 43 % ring | `#ffd400` fill, black label |
| disabled | 40 % opacity | 40 % opacity | no opacity: label `text-3`; active = black tile, 1px dashed white outline |

Disabled never means translucent accent. The contrast audit checks that the active tile differs from the track (fill ≥ 1.4:1 or ring ≥ 3:1) on panels and in dialogs, in all three themes.

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

**Tooltips** (`ui/Tooltip.tsx`, one host for the whole app). `--c-popover`, `--r-1`, `--e-1`, 4×8 padding, 12/16 text at 500, keycaps 16 high, optional second line in `text-2` (≤ 60 chars, "Drag to … · Shift …"). 6px from the trigger, below by default, `data-tip-side` overrides (tool rail opens right); flips and clamps 8px inside the window. 400 ms hover delay, instant between neighbours for 800 ms, shown on `:focus-visible`; hoverable, persistent, Esc dismisses (WCAG 1.4.13). 120 ms fade + 2px slide from the trigger side. `aria-describedby` only when the tooltip adds to the accessible name.

**Command palette** (`ui/CommandPalette.tsx`, Ctrl/⌘+K and Ctrl/⌘+/). 560 wide, top at 20 % of the window, `--c-popover`, `--r-2`, `--e-2` on the dialog backdrop. 48px search row (16px search glyph `text-3`, borderless 14px input), 32px rows inset 4px: 16px icon `text-2` · label (matched letters 600) · group or disabled reason (12 `text-3`) · keycaps. Active row = `--c-press` (high contrast: 2px accent inset). Browse mode lists Recent (last 5 run), Commands, Tools, Templates, Recent files under micro-label headers; a query gives one ranked list. Footer hairline with ↑/↓ · Enter · Esc keycaps. ARIA combobox + listbox with `aria-activedescendant`; synonyms live in `MenuCommand.keywords` (`shared/menu.ts`).

**Menus / selects.** `--c-popover`, 8px radius, items 28 high with 4px inner radius, keycaps right-aligned in `text-3`.

**Toasts.** Bottom-centre over the canvas area (never over panels or the tool rail), auto-dismiss 3 s (errors 5 s), paused on hover, `--c-popover`, 1px line, 6px status dot (accent / danger), 12px text, 120ms rise.

**Welcome.** Dense home in the manner of Linear/Figma/Framer: no hero, no illustration, no gradients. Content is fluid to 1440 (1504 with 32px gutters), centred in wide windows, left-aligned inside. Sticky bar 56: mark (24) + wordmark (14/600) + org, a 32px search field (search icon, `/` keycap; filters Recent and every template section, `/` focuses, Esc clears), Open (default) and New document (primary) right. Body is a two-column grid, main + 288 side column (stacks, side first, below 1080px). Main: "Start" row of three flat cards (hairline, 8px radius, 32px neutral icon tile, title 13/600, one-line description 12 `text-2`, meta 11 `text-3`): **Edit a photo…** (opens an image; "Blank canvas" link opens New Document on Photo), **Poster or social post** and **A4 page** (open New Document preselected; there is no second blank-document path). Recent is a table: 24px column header (Name · Location · Opened, 11 `text-3`), 36px rows with a 32×24 thumbnail, name 13/500, location 12 `text-2` shown as "~/…/Folder" (the last folder is never cut; full path in the row tooltip), relative time 12 `text-3` tabular; six rows then "Show all". Template sections: micro-label heading with count and hairline, `repeat(auto-fill, minmax(160px, 1fr))` grid of thumbnails on pasteboard tone, title 12/500, meta 11 `text-3`. Side column: *Get started* checklist (panel tone, hairline card; title 13/600, `n/5` count, close icon; 2px segment progress in `text-2`/`press`; 32px rows with a 16px circle that becomes an accent check when done, the checkbox "on" role) and a *Learn* list (28px rows) with the drop-anywhere tip. Hidden by `disableOnboarding` policy or when dismissed/complete.

**Canvas empty state.** Over an empty page only: a 264px panel-tone card with a line-strong hairline (resting, no shadow), title 13/500 `text-2`, three 32px ghost rows (Place image… · Draw a shape · Add text, icon 16 `text-2`, key `text-3` right), and "or drop an image here" below a hairline. Disappears on the first layer. "Draw a shape" picks the Rectangle tool in the current studio (Photo included; its key shows on the right).

**Drop overlay.** While files are dragged over the window: accent-wash fill with a 2px dashed accent outline inset 8px, over the canvas viewport (or the whole Welcome), and a 32px popover-tone label "Drop to open" / "Drop to place". Pointer-events none.

**Split button (Export ▾).** Rightmost in the top bar: 28 high default button (raised, line-strong border, 4px radius), main half icon + "Export", 24px chevron half divided by a line-strong hairline. The menu: Export… (detail "Opens on PDF"), Export again (detail: format · file, disabled until the first export), Format heading with PNG/JPEG/SVG/PDF, Hand in… when assignments are on.

**Menus.** `role="menu"`, `--c-popover`, `--e-1`, 4px padding, 28px rows (13px label, optional 11px `text-3` detail line, shortcut right in 11px `text-3`), hairline separators, micro-label headings; icon column only when an item has an icon. ↑/↓/Home/End, Enter, Esc returns focus to the anchor.

**Scrollbars.** Themed everywhere: 10px hit area, 6px thumb in `--c-line-strong` (hover `text-3`), transparent track, no stepper arrows. One `::-webkit-scrollbar` block in `styles.css`; the standard `scrollbar-width`/`scrollbar-color` are set only inside `@supports not selector(::-webkit-scrollbar)` (in Chromium 121+ they override the WebKit pseudo-elements and bring back the native bar), and elsewhere only as `scrollbar-width: none`. `tests/unit/shellLint.test.ts` guards both. Dialog scroll regions (body, side list, main pane, aside) carry the §6 scroll-edge shade, so a row under the footer reads as "more below".

**New document presets.** Grid of 124px-min tiles: page thumbnail on pasteboard tone (84 high), name 12/500, meta 11 `text-3`. Every page is drawn as paper in every theme: `#fff` at 88 % opacity with a 1px `--c-line-strong` edge, never a grey slab. Selection is the tile's accent-wash fill and 1px accent outline only; the selected page goes to full opacity and shows its margins as a faint coral inset (`#ff6b4a` at 60 %).

**Export / preferences.** Dialog with a left list (grouped, 4px-radius active row) and a form on the right; labels 12 `text-2`; dividers hairline; preview thumbnail on pasteboard tone with filename + dimensions as tabular text. Export lists PNG · JPEG · SVG · **PDF** (vectors and live text, embedded fonts) · **Image PDF** (one picture per page); copy never calls a format "print-ready" and no PDF/X preset is shown until output is genuinely conformant. Form order: File name · Area (All · Current · Range with a `1–3, 5` field · Selection for PNG/JPEG) · Scale (× field · W px field · preset menu) or Image resolution · Quality (PDF: only when the pages hold photos) · Background · Bleed · Marks · Colour, then one `text-3` note on what the format keeps. The dialog is as tall as its content (no fixed height); PDF shows page size in the document unit (mm for a px document), pt in its tooltip.

**Status bar (24).** Left: size (document unit), selection (`Selection 412 × 386 px` while a pixel selection exists in Photo, else the layer count or "Nothing selected"), status (cursor position in the document unit). Right: the document **Units** select (changes the document's unit, one undo step), zoom control (− value +), a 12px hairline, then the **Snap** toggle: 20-high ghost button, 16px magnet icon + "Snap", `aria-pressed`, tooltip "Snapping" with its shortcut; off = `text-3`, on = `--c-press` fill, `text` label, accent magnet (the "on" role; HC: black + 1px yellow inset). All 11–12px tabular, `text-2`.

**Rulers.** 20px, `--c-app`, page extent one tone up (`--c-raised`), minor ticks 4/7px, labels 9px tabular `text-3` inset 3px. Layout adds margin (coral) and bleed bands on the ruler's inner edge.

**Canvas selection and hover.** Selection = 1px `#2fb8a6` box + 7×7 solid accent handles with a 1px white ring (edge handles only when the box is wider than 28px) + accent rotation knob 20px above the top edge; in a multi-selection each member also gets a 1px outline at 55 %. Hover = the same 1px accent outline with *no* handles, never drawn on a selected node or while dragging, and also shown when a layer row is hovered. So hover vs selected is unambiguous: handles mean selected. **Text frames** have no resting outline: an unstroked frame shows its dashed guide only while its text is being edited, or when it is empty (so it never vanishes); hover and selection use the outlines above. Picture frames keep their placeholder guide. Drawn in screen space so they never scale with zoom. Same in Vector and Layout for every tool except Node/Crop; Photo shows it with Move only. The pixel selection (marching ants) is drawn only in Photo.

**Layout canvas.** Page edge hairline, dashed bleed, coral margins at 60 %, column guides at 40 %; none of these appear in Photo or Vector.

**Adjustment cards (Adjust tab).** One header for every card: name (13/500; `text-3` while hidden) · eye toggle (visibility, stays visible while hidden) · `⋯` menu (*Reset …* — *Reset all channels* for Curves — and *Delete adjustment*). The header never carries a reset icon of its own, so there is exactly one reset per scope. **Empty state:** pixel layers exist but none is active → "Select a layer to adjust" with a ghost *Select ‹layer›*; no pixel layers at all → *Place a photo…*. Photo always activates the top-most pixel layer on open, on entering Photo, after a crop and after the active layer is deleted (`editor.ensureActiveLayer`).

**Curves.** Header row: RGB·R·G·B segmented control (shared `Segmented`) and, outside the track, a 24px ghost `undo` icon button that resets the shown channel ("Reset Red curve"; disabled while straight). 256×256 graph, `--r-2`, `--c-canvas` fill, plot inset 6px so end points are whole, 4×4 hairline grid, histogram ghost `--c-text-3` at 18 % (light 12 %; a channel's tint on R/G/B), 1.5px curve, 8px ring knobs for inner points, 7px solid end-point knobs (`--c-text` fill, 1px `--c-app` ring), selected = white + accent ring. Input/Output are number fields that always show a point: the selected one, else the black point.

**Histogram (Adjust tab).** 8px top padding, 28px header (micro-label `HISTOGRAM` · channel menu: Colours / Luminance / Red / Green / Blue), 60px plot on `--c-app` with a hairline: luminance as a `--c-text-3` area at 40 %, R/G/B as 1px lines at 60 % (HC: white area, full-strength lines). No saturated fills.

## 9. Accessibility (must not regress)

Focus ring 2px `--c-focus` + 1px offset on every interactive element; high-contrast uses 3px. All icon buttons have `aria-label`; tooltip text equals label. Target size ≥ 24×24 (WCAG 2.2 AA 2.5.8). Contrast table above. No information by colour alone (active tool also has fill + `aria-pressed`). Reduced motion honoured. Forced-colours supported via high-contrast theme.

## 10. Review checklist (design critic)

Per screen, in dark/light/high-contrast, at 100/150/200 %: alignment to 4px grid; two radii only; one accent, used only per rule 4; hairlines crisp; no gradient/glow/emoji; consistent icon weight; tabular numerals; no centred hero; contrast; focus visible; hit targets. Compare against Affinity V3/Photoshop/Linear/Figma screenshots; list anything that reads generic.
