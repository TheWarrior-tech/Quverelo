# CRITIQUE v4 — Workbench redesign

Scope: every screen captured by `tests/e2e/design-review.spec.ts` and `review-captures.spec.ts` (welcome, welcome templates, Photo / Vector / Layout workspaces, colour popover, curves, crop, object-select strip, tool flyout, command palette + tooltip, empty canvas, New document, templates, Document setup, Export (raster, PDF, vector PDF), Preferences, Shortcuts (+ search), confirm, About), in dark, light and high contrast, at 1440 × 873. Benchmarks: Affinity V3, Figma UI3, Photoshop 2025, Linear, Framer.

Scoring: 10 = indistinguishable in quality from the best of the benchmarks; 9 = a pro would choose it on looks; 7 = competent but forgettable; 5 = dated.

## Round 0 — the v3 baseline (blunt)

v3 passed five internal critiques on *correctness* (contrast, focus, one accent, tabular numbers) but it is visually anonymous. Specifics:

1. **It looks like a template.** Teal accent + Inter + 13px UI + flat charcoal slabs is the default look of 2023–25 AI-era SaaS. Nothing says "creative tool".
2. **Slabs and rules, no hierarchy.** Top bar, tool rail, left rail, context bar, inspector and status bar are all near-identical greys separated by 1px lines. The canvas (the work) does not read as the hero; the window reads as a grid of boxes.
3. **Shouty micro-caps.** Every section header is 11px UPPERCASE tracked grey ("APPEARANCE", "TRANSFORM", "HISTOGRAM"). It reads as an admin dashboard, and is harder for young readers.
4. **Everything is an outlined box.** Inputs, buttons, selects and keycaps all wear the same 1px grey outline at the same 4px radius. The inspector looks like a tax form.
5. **Inspector tabs overflow.** In Photo the inspector's five tabs (Design · Adjust · Histogram · History · Scripts) are cut ("Scri…") at 288px.
6. **Studio switch is timid.** The single most important navigation in the app is a grey segmented control whose active state is a slightly lighter grey.
7. **Welcome is a settings page.** A search bar and three tiny flat cards with 32px icons; nothing invites a student to start, nothing shows what each studio makes.
8. **Dialogs are cramped and generic.** 8px radius, 48px header, the selected preset is a muddy teal wash with an outline.
9. **Teal everywhere on the canvas too.** The selection overlay is the chrome accent, so chrome and artwork compete for the same hue.
10. **Rulers are a black frame** (`--c-app`, darker than the pasteboard) that boxes in the work.

Round-0 scores (v3): Welcome 6 · Photo 7 · Vector 7 · Layout 7 · New document 6.5 · Export 7 · Preferences 7 · Palette 7.5 · Flyout 7.5 · Colour popover 7 · Curves 7.5 · About 6.5. Verdict: correct, not desirable.

## v4 direction (summary; full spec in `docs/DESIGN.md`)

Islands on a bed (Figma UI3 / Affinity V3 structure), warm ink neutrals, signal-orange as the one chrome accent, selection blue on the canvas, an inverted ink tile for the studio switch, Geist for UI with Geist Mono for keys and rulers, Instrument Serif for one editorial line on Welcome, sentence-case section titles, segmented panel-tab tracks, 6/10/14 radii.

## How this critique was run

No separate critic agent was available in this session, so the critic pass is a deliberate fresh-eyes review: every capture from `design-review.spec.ts` + `review-captures.spec.ts` (77 PNGs, three themes) was viewed at full size and in 2×2 contact sheets, scored against Affinity V3 / Figma UI3 / Photoshop / Linear, and every finding below names its fix or why it stays. Treat the scores as a strict self-assessment, not an external sign-off.

## Round 1 — first v4 build

What worked immediately: the islands make the canvas the hero; the ink-tile studio switch is the most recognisable element in the window; orange reads as "action" and the blue selection no longer competes with it; sentence-case section titles make the inspector calmer and friendlier; the Welcome serif line gives the app a voice.

Findings and fixes:

| # | Screen | Finding | Fix |
|---|---|---|---|
| 1 | Photo | Inspector tabs still risked overflow | Full-width segmented tab track, `flex: 1` tabs; all five Photo tabs fit in 292px |
| 2 | All workspaces | Selected layer row had a 1px accent ring: looked like keyboard focus | Wash only, no ring, no bar (focus keeps the 2px ring) |
| 3 | Top bar | "Search comman…" cut at 200px | 232 × 30 pill (e2e updated) |
| 4 | Workspaces | Rulers painted with `--c-app` from the canvas code: a black frame round the stage | Rulers read `--c-panel` (island tone) and draw Geist Mono labels |
| 5 | Welcome | Start-card icon/title/meta misaligned; bar translucent so content showed through | 42px icon column, meta aligned to title; bar opaque |
| 6 | Dialogs | Selected preset a muddy accent wash | Quiet hover tone + 2px accent ring on the page well |
| 7 | Palette | Keycaps on the active row failed axe contrast (4.4:1) | Primary ink on the active row |
| 8 | Preferences | Theme-tile minis still drew the v3 teal palette | Minis read the v4 palette |
| 9 | Brand | App icon and in-app mark kept the teal Q tail | Orange tail, warm ink tile; all rasters (PNG set, .ico, .icns) re-rendered from the SVGs |
| 10 | Overlays | Size label, text caret and marquee washes still teal in `engine/` | Selection blue throughout; dark ink on the blue size label |
| 11 | About | Generic | Wordmark in the display serif |
| 12 | Context bar | Group dividers at 3:1 looked like rules | Decorative `--c-line` dividers |

Round-1 scores: Welcome 8.5 · Photo 8 · Vector 8 · Layout 8 · New document 8 · Export 8 · Preferences 8 · Palette 8.5 · Flyout 8.5 · Colour popover 8 · Curves 8 · About 7.5 · Shortcuts 7.5 · Confirm 8.5.

## Round 2 — after the fixes (final for this pass)

| Screen | Dark | Light | HC | Score | Notes |
|---|---|---|---|---|---|
| Welcome | ✓ | ✓ | ✓ | **9.5** | Editorial hero, studio artwork, card table; nothing like it in Affinity/Adobe start screens |
| Welcome › templates | ✓ | ✓ | ✓ | 9 | Thumbnails in 14px wells lift one tone on hover |
| Photo workspace | ✓ | ✓ | ✓ | 9 | Islands + blue selection + orange tool key; Adjust tab calm |
| Vector workspace | ✓ | ✓ | ✓ | 9 | Same; inspector sections read as sentences |
| Layout workspace | ✓ | ✓ | ✓ | 9 | Magenta margins read as print; page well on the stage |
| Colour popover | ✓ | ✓ | ✓ | 9 | |
| Curves / Adjust | ✓ | — | ✓ | 9 | |
| Crop / Object select strip | ✓ | ✓ | — | 9 | Blue crop handles legible on photos |
| Tool flyout | ✓ | ✓ | — | 9 | 10px popover, 6px rows |
| Command palette + tooltip | ✓ | ✓ | — | 9 | 600 wide, 56px search row, mono keycaps |
| Empty canvas | ✓ | ✓ | ✓ | 9 | |
| New document | ✓ | ✓ | ✓ | 8.5 | At 1440 × 873 the right-hand form still scrolls a little (scroll-edge shade shows it) |
| Document setup | ✓ | ✓ | ✓ | 8.5 | Long form; same scroll note |
| Export (raster, PDF, vector PDF) | ✓ | ✓ | ✓ | 9 | |
| Preferences | ✓ | ✓ | ✓ | 9 | |
| Keyboard shortcuts | ✓ | ✓ | ✓ | 8.5 | Dense two-column list with many keycaps; legible but busy |
| Confirm | ✓ | ✓ | ✓ | 9 | |
| About | ✓ | ✓ | ✓ | 9 | |

Result: 15 of 18 screens at ≥ 9 after the round limit used here (round 0 baseline + two v4 rounds). Below 9, with what would close the gap:

- **New document / Document setup (8.5):** fit the form without scrolling at 873px tall: collapse Resolution + colour line into one row and move Bleed beside Margins.
- **Keyboard shortcuts (8.5):** group headings as sticky section titles and render single-letter tool keys without a keycap frame so the column is quieter.
- **Inspector fields** (all workspaces, not scored separately) still wear a 3:1 outline at rest. That is a deliberate WCAG 1.4.11 choice carried over from v3; a fill-only field (Figma style) would look lighter but weakens the boundary for low-vision students.
