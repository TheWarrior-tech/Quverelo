# Quvrelo UX audit: first-run usability and the "premium/modern" gap

Auditor: UX/intuitiveness specialist · 2026-10-15 · `main` @ `3f94830` (v0.3.0)
Scope: GOAL.md criteria 8, 10 and 11. This audit builds on `docs/design/CRITIQUE.md` (review 1) and does not repeat the visual nits that review already fixed.
Evidence: these captures (1440×873, light/dark/high-contrast), taken 2026-10-15 00:42 UTC. Commits after that touched only the updater UI, so they still match the code: `dark-welcome.png`, `light-photo.png`, `high-contrast-photo.png`, `dark-vector.png`, `dark-colour-popover.png`, `dark-layout.png`, `light-new.png`, `light-export.png`, `dark-preferences.png`, `dark-shortcuts-search.png`. I also read the code in `src/renderer/ui/**`, `src/renderer/state/{commands,editor,io}.ts`, `src/renderer/engine/{tools,mlSelect}.ts`, `src/shared/menu.ts` and `src/main/main.ts`.

Severity:
- **P0**: a first-time student can't finish the core task without help, or a pro hits a dead end.
- **P1**: the task can be done but is slow, hidden or inconsistent, or it reads below Figma/Affinity/Linear quality.
- **P2**: polish.

Every fix names the file it belongs in. File paths are relative to `src/renderer/` unless they say otherwise.

---

## 1. Walkthroughs

Two personas:
- **Sam**, a 13-year-old student on a school laptop who has never used a design app. Sam knows Canva and Google Slides.
- **Priya**, a freelance designer who uses Affinity and Photoshop every day and expects keyboard speed and Ctrl+K.

| # | Task | Student (Sam) | Pro (Priya) | Verdict |
|---|---|---|---|---|
| 1 | **Create a new document** | Welcome: **New Document…** (primary) opens a clear dialog. The categories (Print/Screen/Photo/School/Templates), the preview and the selected-and-focused Name field are all good (`light-new.png`). But there's a second "Start" row of three studio cards that create blank docs *without* the dialog, so there are two ways to start that behave differently. "Open in: Photo/Vector/Layout" asks a newcomer a question they can't answer yet. | Ctrl+N works. There are no custom presets to save, and Margins is a single value. | **Pass with friction** |
| 2 | **Open/place an image** | Sam wants to "edit my photo". The **Photo** studio card makes a *blank* 1920×1280 canvas. Getting the photo in means finding a 16px unlabelled "image" icon in the top bar (`Workspace.tsx` Topbar, the 5th icon), or the menu. Drag-and-drop works (`App.tsx` onDrop) but nothing anywhere says so: there's no drop-zone state on Welcome or on the canvas. The empty canvas has no empty state. The only hint ("This page is empty…") sits inside the Layers panel. | Ctrl+O accepts JPG/PNG/SVG (`io.ts:123`), and Ctrl+Shift+P places. Fine. | **Fail for student** |
| 3 | **Select subject** | The ML model exists (`engine/mlSelect.ts`, `select.subject` in `commands.ts:429`) but the **only** way in is the native menu **Select › Select Subject**. It isn't on the tool rail, the marquee context bar, the Layers panel or Welcome. It has no shortcut. Sam will never find it. Click-to-select-object (`runSelectObject`) is implemented in `mlSelect.ts:91` and **wired to nothing in the UI**. | Priya looks for a "Quick Selection / Object Selection" tool on the rail and the "Select Subject" button Photoshop puts in the context bar. Neither exists. | **Fail (both)** |
| 4 | **Crop** | The Crop tool (C) shows a hint: "Drag… then press Enter or double-click." Each drag *replaces* the rectangle. There are no handles to adjust it and no way to move it (`tools.ts` CropTool, lines 749–818). There are no Apply/Cancel buttons, so Sam has to know Enter. Esc silently switches to Move. There are no ratio presets (1:1, 4:5, 16:9, A4) and no W/H fields. | Priya expects handles, Shift for ratio, a ratio dropdown, straighten, and a Delete-cropped-pixels toggle. | **Fail for student / weak for pro** |
| 5 | **Add text** | T is on the rail in every studio, and a click creates text. In Layout there are *two* text tools (Artistic T / Frame X) with no explanation of the difference beyond the tooltip names. The font picker is a native `<select>` with no preview (`ContextBar.tsx:173`). | Context bar has Size/Leading/Tracking number fields: good. No font search or preview, no recent fonts. | **Pass with friction** |
| 6 | **Draw a shape** | Rect/Ellipse/Polygon/Star/Line are there in Vector, and the context bar shows Fill/Stroke chips and a hint. Selection handles now draw (`dark-colour-popover.png`). Good. In **Photo** there are no shape tools at all, so Sam can't draw a box on a photo without switching studio. Nothing tells Sam that the studio switch is the answer. | Fine. Expects the flyout tool groups (CRITIQUE #21, still open). | **Pass (Vector) / Fail (Photo)** |
| 7 | **Change colour** | There are five places: the rail chips, the context-bar chips, the Inspector **Colour** tab, Properties › **Fill** and Swatches. With a shape selected, Properties › FILL is **below the fold**: it's clipped at y≈480 in `dark-vector.png` and needs a scroll. The brush and flood-fill tools use a native OS `<input type="color">` (`ContextBar.tsx:213,241`), which looks different from every other picker. | The popover picker is good (Hex/RGB/HSL/CMYK, box/wheel, document swatches). Wants a quick eyedropper key and the picker to stay open while editing. | **Pass with friction** |
| 8 | **Use layers** | The Layers panel is clear: thumbnails, hover lock/eye, a drag line. The footer is six unlabelled 16px icons (add, duplicate, mask, group, up, down) plus delete. "Add" adds a pixel layer silently. There's no menu for *what* to add (pixel, adjustment, group, fill). Opacity and blend are visible now. | Keyboard ops (Alt+↑/↓, F2) are excellent. There are no layer effects, no search or filter in the panel, and no solo-visibility (Alt-click eye). | **Pass** |
| 9 | **Export PNG/PDF** | The top-bar export icon is labelled **"Export PNG"** (`Workspace.tsx` Topbar) but opens a dialog where PDF/JPEG/SVG are also choices, so the label is wrong. The dialog itself is good (`light-export.png`): format list, preview, size estimate. The PDF settings are on a second view, and nothing in the top bar mentions PDF. Students handing in work want "Export as PDF" to be obvious. | Ctrl+Shift+E / Ctrl+Alt+P. There are no export presets, no "export again with the last settings", and no slices/artboards. | **Pass with friction** |
| 10 | **Find a command** | There's **no command palette**. The Keyboard Shortcuts dialog (F1) has search (`dark-shortcuts-search.png`), but its results can't be *run*, so it's a dead end. On Windows/Linux the native menu bar is the only full command list. | Priya presses Ctrl+K / Ctrl+/ and nothing happens. | **Fail (both)** |

**Summary:** 3 of the 5 tasks criterion 11 names (place image, select subject, export) aren't yet "doable without help". Task 10 (find a command) fails outright. Most of the fixes are small UI wiring: the hard engineering (ML, export, colour) already exists.

---

## 2. Prioritised issues

### P0: blocks a first-time student or dead-ends a pro

**P0-1 · No command palette.** (all screens)
*Problem:* There's no way to search and run a command. That fails criterion 11 explicitly ("command palette"), and it's the single biggest "modern" signal missing (Figma, Linear, Raycast, Framer and Notion all have one).
*Fix:*
- Add `ui/CommandPalette.tsx`, opened by `CmdOrCtrl+K` (add it to `shared/menu.ts` under Help as `help.command-palette`, with Ctrl+/ as an alias in `handleKeydown`).
- Source the entries from `allMenuCommands()` + `STUDIO_TOOLS` (tool switches) + panel toggles + templates + recent files.
- Fuzzy-match on the label and synonyms. Add a `keywords?: string[]` field to `MenuCommand` ("cutout, remove background" → Select Subject; "pdf, print" → Export PDF).
- Each row: icon · label · group (`text-3`) · keycaps right-aligned. Disabled commands show with a one-line reason ("Needs a pixel selection").
- Keep a "Recent" section first.
- Layout: 560 wide, 8px radius, `--e-1`, 40px input, 32px rows, top-anchored at 20 % of the viewport.
- Run via `runCommand`. Also make the F1 shortcuts list rows runnable (Enter).

**P0-2 · Select Subject is invisible, and click-to-select isn't wired.** (`light-photo.png`)
*Problem:* The headline ML feature is reachable only via the native menu, and `runSelectObject` (`engine/mlSelect.ts:91`) has no UI.
*Fix:*
- (a) Add an **Object Select** tool to `STUDIO_TOOLS.photo` (`state/editor.ts:78`) after `lasso`, with shortcut W and its own icon in `Icons.tsx`. Click adds, Alt-click subtracts, calls `runSelectObject` with the previous result, and shows a spinner chip by the cursor while it runs.
- (b) Put a **"Select subject"** button (icon + label) as the first control in the context bar for marquee, lasso and object-select (`ContextBar.tsx` ~l.217), and in the Photo **Layers** empty-selection state.
- (c) Add `accel: 'CmdOrCtrl+Alt+S'` to `select.subject` in `shared/menu.ts:112`.
- (d) After a selection, show a contextual action strip floating under the selection bounds: *Remove background · Mask layer · Copy to new layer · Crop to selection · Invert*. "Remove background" = `layer.mask-selection` on the inverted subject.

**P0-3 · Photo studio starts blank. No "open a photo" path, no drop affordance, no canvas empty state.** (`dark-welcome.png`, Photo card)
*Fix:*
- (a) In `Welcome.tsx` `STUDIO_INFO`, the Photo entry becomes **"Edit a photo…"** and opens the image file dialog (`openDialogAndLoad` filtered to images) instead of `newFromTemplate('photo')`. Keep "Blank photo canvas" as secondary text.
- (b) Add a full-window drop overlay to `App.tsx` onDragOver/onDragLeave: a 2px dashed accent inset on the canvas area or Welcome, with "Drop to open" / "Drop to place".
- (c) Canvas empty state in `Workspace.tsx` `CanvasArea`: when the active container has no nodes, show a centred quiet panel (`text-2`, no illustration) with three ghost buttons: **Place image** (Ctrl+Shift+P) · **Draw a shape** · **Add text**. Also show "or drop a file here". It disappears on first node.
- (d) Rename the top-bar image icon tooltip to "Place image…" and give it a visible label at ≥1280px window width.

**P0-4 · Crop tool can't be adjusted and has no visible commit.** (`engine/tools.ts` CropTool 749–818)
*Fix:*
- Give the crop rect 8 handles and a move-inside drag, reusing the selection-handle drawing from the transform tool.
- Shift locks the ratio.
- In the context bar (`ContextBar.tsx:236`), replace the hint with: Ratio select (Free · Original · 1:1 · 4:5 · 3:2 · 16:9 · A4 · Custom) · W/H `NumberField`s · swap-orientation icon · Overlay (thirds/grid/none) · **Cancel** (ghost) · **Apply** (primary, 24px).
- Esc should *reset the crop and stay in Crop*, not silently jump to Move.
- Drop the on-canvas text "— Enter to crop" once the Apply button exists.

**P0-5 · Export entry point is mislabelled and PDF is hidden.** (top bar)
*Fix:*
- In `Workspace.tsx` Topbar, change the icon to `tip('Export…', 'file.export-png')`. Better: make it a split button, **Export ▾**, where the chevron opens PNG · JPEG · SVG · PDF · *Hand in…* (when `feature('assignments')`).
- Export dialog (`dialogs/ExportDialog.tsx`): remember the last format per document and offer **"Export again"** (Ctrl+Alt+Shift+E) that skips the dialog.
- For Layout documents, default the format to PDF.

### P1: works, but slow, hidden or below Figma/Affinity quality

**P1-1 · Tooltips are native `title` attributes.** (`ui/tooltip.ts`)
*Problem:* They show after an OS delay of about 1 s, in OS styling. They don't show keycaps (DESIGN.md §8 says they should), never appear on keyboard focus, and can't be hovered (WCAG 1.4.13).
*Fix:*
- Build a `ui/controls/Tooltip.tsx` portal driven by `data-tip`/`data-keys` attributes that `tip()` now emits instead of `title`.
- Delay 400 ms on first show, 0 ms when moving between neighbours for 800 ms afterwards. Show on `:focus-visible`. Esc dismisses.
- Styling: `--c-popover`, 4px radius, 12px text and keycaps. Use `aria-describedby`, not `title`.
- Optional second line for tools ("Drag to draw. Shift for square").

**P1-2 · The fill (the most-edited property) is below the fold.** (`dark-vector.png`)
*Fix:*
- In `panels/PropertiesPanel.tsx`, reorder the sections to **Appearance (Fill · Stroke · Opacity/Blend)** first, then **Transform**, then **Shape**. That's Figma's order, and it suits students, who change colour more often than X/Y.
- Collapse Transform to two rows (X Y W H on one 4-up row at 288px, R/S behind a disclosure).
- In `panels/Panels.tsx`, give the Inspector group the free space whenever the selection changes.

**P1-3 · Too many colour entry points, and one of them is a native OS picker.** (`ContextBar.tsx:213,241`)
*Fix:*
- Replace both `<input type="color">` with `ColorChipButton` (already used for shapes).
- Drop the Inspector **Colour** tab: fold its "default for new objects" chips into Properties when nothing is selected. That leaves Properties › Fill, the rail chips, the context chips and Swatches, all using the same popover.

**P1-4 · No onboarding or progressive hints.**
*Fix:*
- Add a dismissible first-run checklist card on Welcome (`Welcome.tsx`, above Recent) with five rows that tick as they're done: *Create a document · Place an image · Select a subject · Add text · Export*. Each row deep-links into the action.
- Persist the state in settings (`settings.onboarding`). Policy `disableOnboarding` for IT.
- In the workspace, show one-time **coach marks** (an 8px-radius popover with an arrow, max 2 lines, "Got it"): on first entry to each studio, point at the tool rail; on the first pixel selection, point at the action strip.
- Respect reduced motion. Never show more than one at a time.

**P1-5 · The context bar is a mix of segmented, outlined and ghost controls with inline styles.** (`ContextBar.tsx`, 62 inline `style={{}}` across `ui/`)
*Problem:* The marquee modes are outlined `btn`s, Fit is outlined, Group/Convert to curves are outlined, and the hints are spans with ad-hoc `var(--text-dim)` colours.
*Fix:*
- Create `ui/controls/Segmented.tsx` (one component, used for selection mode, frame Fit, curves channel and New Doc Background/Open in) and a `CtxHint` component (`text-3`, truncates, hidden below 1280px).
- Make every context-bar action a 24px ghost button.
- Move all inline colour styles into `styles.css` classes. This is also where P0-2's Select Subject button and P0-4's Apply/Cancel go.

**P1-6 · Studio model is unexplained.** (`dark-layout.png`)
*Problem:* One document can be viewed in three studios, and switching studio swaps the tools. A student who drew a rectangle in Vector and goes to Photo can't find the shape tools. In Layout on a photo document, nothing tells you what's different.
*Fix:*
- When a studio is first entered (P1-4 coach mark), show a one-line description under the switch.
- On hover of a studio segment, the tooltip lists 3 example tools.
- In Photo, add Rectangle/Ellipse/Line/Text as a "Shapes" flyout on the rail (`STUDIO_TOOLS.photo`) so shapes over photos don't need a studio switch.
- If a shortcut belongs to a tool in another studio, switching studio is fine, but show a toast: "Switched to Vector for Pen (P)".

**P1-7 · There are two ways to start a document from Welcome, and "Open in" is in New Document.** (`dark-welcome.png`, `light-new.png`)
*Fix:*
- On Welcome, make the Start row three *presets* (Photo · Poster/Social · A4 page) that open the **New Document** dialog preselected on that category, so there's one path.
- In `NewDocumentDialog.tsx`, hide "Open in" behind "More options" and infer the studio from the category (Photo→Photo, Screen→Vector, Print/School→Layout).

**P1-8 · Layers footer: unlabelled icons and a silent "Add".** (`panels/LayersPanel.tsx`)
*Fix:*
- Make the **+** button open a menu: Pixel layer · Group · Adjustment ▸ (the same list as the Adjustments "Add" popover) · Place image…
- Give every footer icon a `tip()` with its shortcut.
- Add Alt-click on the eye to solo a layer, plus a 24px filter field that appears with more than 12 layers.

**P1-9 · Font picker is a native select with no preview or search.** (`ContextBar.tsx:173`)
*Fix:* add `ui/controls/FontPicker.tsx`: a popover with a search field, then Recent (5), Bundled, then System. Each row shows the name set in its own face at 13px, with 28px rows and a virtualised list. Arrow keys live-preview, Enter commits, Esc reverts.

**P1-10 · Layout has two text tools with no explanation.** (Layout rail)
*Fix:* merge them into one T rail button with a flyout (Artistic text · Frame text). A click-drag with T makes a frame, a single click makes artistic text (Affinity/InDesign behaviour), so students never have to choose. The tooltip second line says so.

**P1-11 · Panels still clip mid-control and the groups don't follow the task.** (`high-contrast-photo.png`: Curves cut at the graph bottom; `dark-vector.png`: FILL cut)
*Fix:*
- When a section expands or a tool is chosen, auto-scroll it into view (`scrollIntoView({block:'nearest'})` in `controls/Panel.tsx` Section).
- Add a per-studio default split in `Panels.tsx`: Photo gives Inspector 60 %, Layout gives Pages/Layers 50 %.
- Add a "Reset panel layout" command to View.

**P1-12 · There's no contextual floating toolbar on the canvas.** (all studios)
*Problem:* Modern tools (Figma's selection toolbar, Canva, Pixelmator) put the 3–5 most likely next actions next to the selection. Quvrelo puts everything in the 36px bar at the top, far from the pointer.
*Fix:*
- Add `ui/SelectionToolbar.tsx`, anchored 8px below the selection bounds (flipped above near the bottom), shown after pointer-up and hidden while dragging or zooming.
- Content by type:
  - pixel selection: the P0-2 strip
  - shape: Fill chip · Stroke chip · Arrange ▾ · Boolean ▾ (when 2+ are selected)
  - text: Font · Size · Bold/Italic · Align
  - image frame: Fit ▾ · Replace…
- Turn it off in Preferences › Canvas ("Show floating toolbar"). It's always keyboard reachable via F6 focus cycling.

**P1-13 · Welcome uses its width poorly and has no search.** (`dark-welcome.png`)
*Problem:* At 1440px wide there's a dead band of about 320px on the right because the column is left-aligned at a max of 1120. Recent meta truncates ("quvrelo-sa…"). The native light scrollbar shows in dark (CRITIQUE #32, still open). There's no search across templates and recents.
*Fix:*
- In `welcome.css`, make the column fluid to 1440 with the grid `repeat(auto-fill, minmax(168px,1fr))`.
- Add a 32px search field in the header (filters Recent and every template section, with "/" to focus).
- Recent meta shows "Edited 2 h ago · Folder", with the full path in a tooltip.
- Style the scrollbars globally in `styles.css` (`::-webkit-scrollbar` 8px, thumb `--c-line-strong`).

**P1-14 · Status bar "Snap on" is text, not a control.** (`Workspace.tsx` StatusBar)
*Fix:* make it a 20px ghost toggle button with a magnet icon, `aria-pressed`, and a `tip('Snapping', 'view.snap')`. Add the same treatment for rulers/grid toggles. Make the zoom value a menu (Fit · 50 · 100 · 200 · Fill).

**P1-15 · Keyboard shortcut collisions within studio logic.** (`Workspace.tsx` TOOL_LABELS)
*Problem:* M is Rectangle Marquee in Photo *and* Rectangle in Vector. E is Eraser and Ellipse. L is Lasso and Line. Ellipse Marquee has no key.
*Fix:* add Photoshop-style cycling: pressing the same key again or Shift+key cycles within a flyout group (M → rect/ellipse marquee). Give each tool exactly one documented key per studio, and list collisions in the shortcuts dialog with the studio badge.

### P2: polish

- **P2-1** Dialog primary button: "Done" in Preferences/Shortcuts is accent-filled (`dark-preferences.png`). Use a default button there, and keep the accent for commit actions (Create, Export…) only (DESIGN rule 4).
- **P2-2** Inactive segments in high contrast are grey-on-black ("New" in the marquee bar, `high-contrast-photo.png`). Use a white text + 1px white outline (CRITIQUE #23 is partly open).
- **P2-3** In the Shortcuts dialog, the keycaps are right-aligned to a column that leaves a 400px void (`dark-shortcuts-search.png`). Constrain rows to 560px, and highlight matched text in search results.
- **P2-4** On the export preview, show the actual output pixels on a checkerboard when Transparent is chosen. Currently it's always the photo on grey.
- **P2-5** New Document: Margins should be 4 linked fields with a chain toggle, and the template list needs thumbnails (CRITIQUE #17, partly open). Add "Save as preset".
- **P2-6** Hint copy: shorten every context hint to ≤ 60 characters and use the same pattern, "Drag to …  ·  Shift …", everywhere. The node-tool hint is currently 110 characters (`ContextBar.tsx:281`).
- **P2-7** Undo safety: show the destructive actions (Crop, Merge down, Rasterise, Delete page) as a toast "Cropped · Undo" with an action button (the toast action already exists in `App.tsx`).
- **P2-8** In the History panel, name entries by object ("Fill: Rectangle → #8F959E") and add hover preview.
- **P2-9** Add a native-feeling **window title bar** on macOS (`titleBarStyle: 'hiddenInset'` in `main/main.ts`) so the top bar *is* the title bar, as in Figma and Linear. On Windows, keep the menu bar but give it a "Compact menu" option (a hamburger in the top bar's left) to free the 20px.
- **P2-10** Add a theme preview of the full app in Preferences › Appearance, and a "Density: Comfortable / Compact" option (rows 28 → 24).
- **P2-11** Swatches: the "Click: fill · Shift-click: stroke" hint now lives in `title`. Move it to the P1-1 tooltip and add a 24px "+" to save the current colour.
- **P2-12** On the Studio switch, show the shortcut keycaps (Ctrl+Alt+1/2/3) in tooltips via P1-1.

---

## 3. Premium/modern gap list

The yardstick is Figma, Framer, Linear, Raycast, Canva, Pixelmator Pro and Affinity V3 as patterns. This is not a copy list. For Mobbin pattern notes, see `docs/design/refs/MOBBIN.md` (to be written per criterion 11).

| Area | Today | Gap to "best" | Fix (where) |
|---|---|---|---|
| **Density** | Rows 28, panels 288, context bar 36. About Affinity level, but there's empty void in Layers and under the Shortcuts list, and Properties wastes rows (R/S on their own row). | Pros want a compact mode. Students want comfortable. | Density setting (P2-10) via a `--row` token in `styles.css`. Make the 4-up transform row the default. |
| **Type hierarchy** | Inter 11/12/13/14 with uppercase micro labels. Prop titles ("Rectangle") are 12/600 and compete with section labels. | Too flat. The object name should be the clear anchor of the inspector, and the micro labels quieter. | Prop title 13/600 `text`. Micro labels 11/500 `text-3` (not `text-2`). Values 12 `text`, labels 12 `text-2`. Document this in DESIGN §4. |
| **Panel hierarchy** | Three equal groups (Inspector · Structure · Library) with identical tab styling. | Inspector is primary, Library is tertiary. Library should be collapsed by default for students. | `Panels.tsx`: Library collapsed on first run. Inspector tabs 12/500, other groups 12/400. Per-studio default splits (P1-11). |
| **Empty states** | One line of text in Layers. Nothing on the canvas, Swatches, Assets or Recent (when empty). | Every empty surface should say what goes there and offer the one action. | Canvas (P0-3c). Assets: "Drag images here or Place…". Recent: "Files you open appear here". History: "Your edits appear here, Ctrl+Z to undo". Use a shared `ui/controls/EmptyState.tsx` (icon 20 `text-3`, 13px line, ghost button). |
| **Contextual toolbar** | A static top context bar, far from the pointer, mixed control styles. | A floating selection toolbar, plus a unified context bar. | P1-12 + P1-5. |
| **Command palette** | None. | Ctrl+K with fuzzy search, synonyms, recents and runnable shortcuts. | P0-1. |
| **Onboarding hints** | A "Quick start guide" link on Welcome only. | A first-run checklist, one-time coach marks and studio intros, all IT-disableable. | P1-4. |
| **Tooltips with shortcuts** | Native `title` with the "(Ctrl+O)" suffix. | Custom fast tooltips with keycaps and an optional how-to line, also shown on keyboard focus. | P1-1. |
| **Motion** | Fades ≤120ms, toast rise, reduced-motion honoured (`styles.css:116`). There's no motion on panel collapse, popover open, tool switch or studio switch, so these states feel abrupt. | Purposeful 120–150ms motion that explains a change of state, still respecting reduced motion. | Popover/menu: 120ms opacity + 4px translate from the anchor side. Panel group collapse: 150ms height via `grid-template-rows: 0fr→1fr`. Studio switch: the active tile slides (transform) between segments. Selection toolbar: 100ms fade-in after pointer-up. All of these use `--dur`/`--ease`. |
| **Iconography** | A consistent custom set. But several actions are text-only buttons (Crop to selection, Mask layer, Group, Convert to curves, Place…). | Icon + label for the primary action, icon-only for the secondary ones, with tooltips everywhere. | Context bar audit during P1-5. |
| **Feedback** | Status-bar text ("Selecting subject…") and toasts. | Inline progress where the action is (a spinner chip at the cursor for ML, a progress bar in the Export button). | P0-2, `ExportDialog.tsx` button busy state. |
| **Title bar / chrome** | Native OS menu and title bar above a 44px top bar: 3 stacked bars on Windows/Linux. | One unified top bar, like Figma, Linear and Arc. | P2-9. |
| **Selection affordances** | Handles are fine now. No W×H label while dragging, no smart distances. | Live measurement labels and pink/coral spacing guides while moving (Figma). | `engine/Viewport.ts` overlay: a W×H pill during resize, gap labels during snap. |

---

## 4. Top 15 to fix first, in order

1. P0-1 Command palette (Ctrl+K)
2. P0-2 Select Subject button + Object Select tool + post-selection action strip
3. P0-3 "Edit a photo…" on Welcome, drop overlay, canvas empty state
4. P0-4 Adjustable crop with ratios and Apply/Cancel
5. P0-5 Export split button, correct label, PDF visible, Export again
6. P1-1 Custom tooltips with keycaps, shown on focus
7. P1-2 Properties order: Appearance first, Fill above the fold
8. P1-12 Floating selection toolbar
9. P1-4 First-run checklist + coach marks
10. P1-5 Unified context bar (Segmented, ghost buttons, no inline styles)
11. P1-7 One "new document" path; infer the studio
12. P1-6 Explain studios; shapes reachable in Photo
13. P1-3 One colour picker everywhere (no native `<input type=color>`)
14. P1-9 Font picker with preview and search
15. P1-13 Welcome: fluid grid, search, dark scrollbars

**Re-test protocol:** after the fixes, re-run the section 1 table with the same two personas. Add `tests/e2e/usability.spec.ts`, which scripts each core task using visible UI only (no `__quvrelo.runCommand`, no menu IPC), so "doable without help" is a regression test and not an opinion. Capture each step to `docs/design/review/usability-*.png` in all three themes.
