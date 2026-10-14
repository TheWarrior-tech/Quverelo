# Quvrelo design system

Status: v1 (2026-10-14). Source of truth for every screen. Tokens live in `src/renderer/styles.css` (`:root`, `[data-theme]`); icons in `src/renderer/ui/Icons.tsx`. If a screen needs a value that is not here, add it here first.

## 1. Intent

Quvrelo is a tool for making things, so the interface should disappear: calm graphite surfaces, one accent, hairlines instead of boxes, dense but never cramped, numbers that don't jiggle. A first-time student should find the tool in one glance; a pro should never wait on a transition.

Feel references (studied for structure and restraint, nothing copied): Linear (charcoal ramp, 13px UI, translucent hairlines, 4/6/8 radii), Raycast (single accent, tiny type, keycaps), Glyphs (tool-first, one accent), Figma / Affinity V3 (panel density, 24–28px rows), Arc (quiet chrome). Pattern notes from Mobbin (Framer, FLORA, Descript, Frame.io): two radii only, selection is a colour swap not a pill of colour, accent in four roles only, segmented controls as contained pills with a contrasting active tile, dialogs on a dimmed backdrop with a hairline above the footer, a single thin accent playhead. Notes: `docs/design/refs/NOTES.md`.

## 2. Anti-slop rules (reviewable, each is a checklist item)

1. No gradients on chrome, buttons, cards or logos. (Gradients only inside user artwork and the colour picker.)
2. No glass / blur blobs, no coloured glows, no drop shadows on resting controls.
3. No emoji, no unicode glyphs as icons (`✕ ▲ ▼ ＋`). Every icon comes from `Icons.tsx`.
4. Exactly one accent colour (verdigris). It appears only on: the active tool, the one primary button per view, focus rings and selection outlines, slider/checkbox "on" state, text links. Studios are not colour-coded.
5. Two radii: `4px` controls, `8px` containers (dialogs, cards, popovers). `999px` only for knobs and count pills. Nothing in between.
6. Elevation: resting surfaces are flat and separated by one-stop tone shifts and 1px hairlines. Only popovers/dialogs/toasts carry a shadow.
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
| `--c-line-strong` | `rgba(255,255,255,.15)` | `rgba(0,0,0,.18)` | `#fff` | input borders, keycaps |
| `--c-text` | `#ececed` | `#18191b` | `#fff` | primary text |
| `--c-text-2` | `#a3a5aa` | `#54565b` | `#fff` | secondary text, labels |
| `--c-text-3` | `#8b8d93` | `#686a70` | `#e6e6e6` | tertiary, placeholders, units |
| `--c-accent` | `#3cc4b0` | `#0c7a6b` | `#ffd400` | accent (see rule 4) |
| `--c-accent-hover` | `#58d3c0` | `#096558` | `#ffe766` | |
| `--c-accent-ink` | `#06231e` | `#ffffff` | `#000` | text on solid accent |
| `--c-accent-wash` | accent 14 % | accent 12 % | accent 25 % | selected row fill |
| `--c-focus` | `#58d3c0` | `#096558` | `#ffd400` | 2px focus ring, offset 1px |
| `--c-danger` | `#ff6b6b` | `#c92a2a` | `#ff8080` | destructive text/icons only |

Contrast (WCAG 2.2 AA minimum, checked): text on panel ≥ 12:1; text-2 ≥ 7:1; text-3 ≥ 4.5:1; accent-ink on accent ≥ 7:1; accent as text on panel ≥ 4.5:1.

Canvas overlays (selection, handles, guides) use accent `#2fb8a6` for selection, coral `#ff6b4a` for snapping and margins, cyan for ruler guides, so they stay legible on photographs.

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

4px base; allowed steps 4 · 8 · 12 · 16 · 24 · 32 · 48. Control heights: `24` (compact: panel inputs, segmented, small buttons), `28` (default buttons, top bar), `32` (dialog actions). Tool rail buttons `32×32` on a `44px` rail. Panel row height `28`, layer row `32`. Top bar `44`, context bar `36`, status bar `24`, panels `288` wide. All hairlines are 1 device-independent px drawn as `box-shadow`/`border` so they stay crisp at 150 %/200 %.

## 6. Radius, elevation, motion

- Radius: `--r-1: 4px` (buttons, inputs, rows, tiles) · `--r-2: 8px` (dialogs, popovers, cards, thumbnails) · `--r-full: 999px` (knobs, count pills).
- Elevation: `--e-0` none · `--e-1` popover `0 0 0 1px line, 0 4px 16px rgba(0,0,0,.28)` · `--e-2` dialog `0 0 0 1px line, 0 16px 48px rgba(0,0,0,.4)`.
- Motion: `--dur: 120ms`, `--ease: cubic-bezier(.2,.7,.3,1)`. Allowed: background/colour/opacity fades, 4px toast slide, dialog 4px rise. No bouncing, no scaling on hover.

## 7. Iconography

Custom set drawn for Quvrelo (`src/renderer/ui/Icons.tsx`), no third-party glyphs.
- Grid `20×20`, live area `16×16` (2px padding), pixel-aligned to 0.5.
- Stroke `1.5`, `round` caps and joins, never filled except `mask`, `adjust`, tiny anchor dots. Corner radius `1.5` on rects, `1` on small squares.
- Displayed at `20px` in the tool rail (1:1 on the grid) and `16px` inline (stroke bumps to `1.75` so it still reads as 1.4px).
- Colour is `currentColor`; active tool rail icon uses accent-ink on accent fill.
- Studios have glyphs (photo = aperture, vector = node curve, layout = columns). No coloured studio badges.

App icon / logo: graphite tile, off-white ring, one accent bar forming the Q tail. Flat, no gradient, no shadow. Source `build/icon.svg`.

## 8. Components

**Top bar (44).** App mark, document title (500, truncates) with unsaved dot (4px, accent), file/undo icon buttons (28×28), studio switch centred in the bar's grid, align/boolean/arrange icon group right, then help and preferences. Hairline below.

**Studio switch.** Segmented control: 28 high, 4px inner padding, `--c-raised` track with hairline, active segment `--c-press` fill + text primary, icon in accent. Neither colour-coded nor underlined. Keyboard: arrow keys move, Enter selects.

**Tool rail (44 wide).** `--c-app`, hairline right. 32×32 buttons, 2px gap, groups divided by an 8px gap plus a 16px hairline (no heavy dividers). Active = solid accent with accent-ink icon. Tooltips show name + shortcut as keycaps. Colour chips at the bottom: two overlapping 20px squares, 1px line-strong border, swap icon.

**Context bar (36).** Tool name at 500, then controls in groups separated by a 16px hairline. Sliders show label, 96px track, tabular value. Modes (New/Add/Subtract/Intersect) are a segmented control. Hint text is `text-3`, never competes with controls.

**Panels (288).** Stack of groups: tab strip (28) then body. Tabs are text buttons, active = primary text + `--c-press` fill, 4px radius; no underline. Section label = micro type, `text-3`. Rows 28, label column 72, input fills. Group separation = hairline.

**Layers.** Row 32: twisty, 24×20 thumbnail (4px radius, hairline), name (12), then eye/lock icons that appear on hover or when active. Selected = accent-wash fill + hairline accent on the left 2px. Drag insertion = 2px accent line. Footer actions are 24×24 icon buttons.

**Inputs.** 24 high, `--c-raised`, 1px line-strong, 4px radius, text 12 tabular. Focus = border accent + 2px ring. Number fields hide spinners; arrow keys step, shift ×10. Selects: custom chevron icon. Checkbox 14px, radius 3, accent when on. Radio group = segmented.

**Sliders.** 2px track (line-strong), 12px thumb (off-white, 1px shadow ring), thumb gets accent ring on hover/focus; value is a paired number field (see slider row: label 88 · track · value 48).

**Buttons.** Default: `--c-raised`, hairline, 28 high, 12px text 500. Primary: accent fill + accent-ink text (one per view). Ghost: no fill, hover fill. Danger text only. Disabled 40 % opacity, `not-allowed` cursor absent in desktop (default).

**Colour picker.** Saturation/value square 8px radius, hue strip 10px with 12px knob; fields below in a 2×N grid; swatches 16px, 4px radius, hairline; selected swatch has accent ring.

**Dialogs.** 8px radius, `--c-popover`, `--e-2`, backdrop `rgba(0,0,0,.55)` (no blur). Header 48 with title (14/600) and close icon; body 16 padding; footer separated by hairline, buttons right-aligned, primary last. Width 480 default, 840 wide. Esc closes, focus trapped, focus returns.

**Menus / selects.** `--c-popover`, 8px radius, items 28 high with 4px inner radius, keycaps right-aligned in `text-3`.

**Toasts.** Bottom-centre over the canvas area (never over panels or the tool rail), auto-dismiss 3 s (errors 5 s), paused on hover, `--c-popover`, 1px line, 6px status dot (accent / danger), 12px text, 120ms rise.

**Welcome.** Left-aligned content column max 1120. Header: mark + wordmark (display) and one line of description; Open (default) and New document (primary) right. "Start" = three rows of studio entries (line icon in a 32px neutral tile, title, one-line description, shortcut hint), flat cards with hairline and 8px radius. Template sections: micro-label heading with count and hairline, 6-up grid of thumbnails on pasteboard tone (no extra frame), title 12/500, meta 11 `text-3`. Recent files as a table-like list (name, location, 28px rows). No gradients, no big illustrations.

**Export / preferences.** Dialog with a left list (grouped, 4px-radius active row) and a form on the right; labels 12 `text-2`; dividers hairline; preview thumbnail on pasteboard tone with filename + dimensions as tabular text.

**Status bar (24).** Left: size, selection count, status. Right: units select, zoom control (− value +), snap. All 11–12px tabular, `text-2`.

**Rulers.** 20px, `--c-app`, page extent one tone up (`--c-raised`), minor ticks 4/7px, labels 9px tabular `text-3` inset 3px. Layout adds margin (coral) and bleed bands on the ruler's inner edge.

**Canvas selection.** 1px `#2fb8a6` box, 7×7 white handles with 1px accent stroke (edge handles only when the box is wider than 28px), rotation knob 20px above the top edge; drawn in screen space so they never scale with zoom. Same in Vector and Layout for every tool except Node/Crop; Photo shows it with Move only. The pixel selection (marching ants) is drawn only in Photo.

**Layout canvas.** Page edge hairline, dashed bleed, coral margins at 60 %, column guides at 40 %; none of these appear in Photo or Vector.

**Curves.** 256×256 graph, `--r-2`, `--c-canvas` fill, 4×4 hairline grid, histogram at 20 %, 1.5px curve, 8px knobs (selected = white + accent ring), RGB·R·G·B segmented control, Input/Output fields.

## 9. Accessibility (must not regress)

Focus ring 2px `--c-focus` + 1px offset on every interactive element; high-contrast uses 3px. All icon buttons have `aria-label`; tooltip text equals label. Target size ≥ 24×24 (WCAG 2.2 AA 2.5.8). Contrast table above. No information by colour alone (active tool also has fill + `aria-pressed`). Reduced motion honoured. Forced-colours supported via high-contrast theme.

## 10. Review checklist (design critic)

Per screen, in dark/light/high-contrast, at 100/150/200 %: alignment to 4px grid; two radii only; one accent, used only per rule 4; hairlines crisp; no gradient/glow/emoji; consistent icon weight; tabular numerals; no centred hero; contrast; focus visible; hit targets. Compare against Affinity V3/Photoshop/Linear/Figma screenshots; list anything that reads generic.
