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
