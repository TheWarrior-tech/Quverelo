# Quvrelo — User Guide

Quvrelo is one app with three **studios**. They all edit the same document, so you can switch whenever you like using the buttons at the top of the window (or <kbd>Ctrl/⌘</kbd>+<kbd>Alt</kbd>+<kbd>1</kbd>, <kbd>2</kbd>, <kbd>3</kbd>).

- **Photo** — pixel layers, painting, selections and live adjustments.
- **Vector** — shapes, curves, gradients and booleans for logos, posters and diagrams.
- **Layout** — pages, master pages, flowing text and picture frames for worksheets, newsletters and booklets.

Press <kbd>F1</kbd> at any time to see every keyboard shortcut.

## Getting started
1. On the welcome screen choose **Edit a photo…** to open a picture, **Poster or social post** or **A4 page** to start a blank document (both open *New document* with the size picked; Quvrelo chooses the right studio for you, and *More options* lets you pick another), or a template (the **Classroom pack** has worksheets, certificates, lesson plans, timetables and more). Press <kbd>/</kbd> to search templates and recent files. You can also drop a photo or `.quvrelo` file anywhere on the window.
   - **Get started:** the checklist on the right walks you through five first steps (create a document, place an image, select a subject, add text, export). Each row takes you to that step and ticks itself when you've done it. Close it with its close button when you no longer need it.
   - An empty page shows **Place image…**, **Draw a shape** and **Add text** to get you going; it disappears once the page has something on it.
2. Use the **tools** on the left. The **context bar** under the top toolbar shows options for the current tool.
3. The **panels** on the right show properties, colours, layers, pages and history. Press <kbd>Tab</kbd> to hide/show them.
4. Save with <kbd>Ctrl/⌘</kbd>+<kbd>S</kbd>. Everything — including photos — is stored in one `.quvrelo` file.

## Moving around
| Action | How |
|---|---|
| Pan | Hold <kbd>Space</kbd> and drag, drag with the middle mouse button, scroll, or use the Hand tool (<kbd>H</kbd>) |
| Zoom | <kbd>Ctrl/⌘</kbd> + scroll (zooms at the pointer), trackpad pinch, Zoom tool (<kbd>Z</kbd>), or the zoom buttons in the status bar |
| Fit page | <kbd>Ctrl/⌘</kbd>+<kbd>0</kbd> |
| Actual size | <kbd>Ctrl/⌘</kbd>+<kbd>1</kbd> |
| Guides | Drag from the rulers onto the page. *Document ▸ Clear Guides* removes them |
| Units | Change in the status bar (px, mm, cm, in, pt) |

## Selecting and arranging
- Click with the **Move** tool (<kbd>V</kbd>) to select; drag on empty space to select several; <kbd>Shift</kbd>-click adds to the selection.
- Drag to move, use the handles to resize and rotate. Hold <kbd>Shift</kbd> to keep proportions, <kbd>Alt</kbd> to resize from the centre. Objects **snap** to the page, margins, guides and each other (hold <kbd>Alt</kbd> while dragging to stop snapping).
- Arrow keys nudge by 1 px (<kbd>Shift</kbd> for 10 px).
- Type exact values for position, size, rotation and shear in **Properties** (you can type sums such as `120+30`).
- Align and distribute with the toolbar buttons. With one object selected, alignment is relative to the page (or margins in Layout).
- Group <kbd>Ctrl/⌘</kbd>+<kbd>G</kbd>, ungroup <kbd>Ctrl/⌘</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>. Arrange with <kbd>Ctrl/⌘</kbd>+<kbd>[</kbd> / <kbd>]</kbd>.

## Photo studio
- **Open** a photo (JPG, PNG, WebP) or drag it onto the window. Use **File ▸ Place Image** to add more photos as layers. You can also paste a screenshot with <kbd>Ctrl/⌘</kbd>+<kbd>V</kbd>.
- **Brush** (<kbd>B</kbd>) and **Eraser** (<kbd>E</kbd>) paint on the selected pixel layer (the brush creates a new layer if none is selected). <kbd>[</kbd> and <kbd>]</kbd> change the size; set hardness and opacity in the context bar.
- **Selections:** Rectangle (<kbd>M</kbd>), Ellipse and Freehand (<kbd>L</kbd>). Hold <kbd>Shift</kbd> to add, <kbd>Alt</kbd> to subtract, both to intersect. Painting, filling and clearing stay inside the selection. Use the context bar to invert, crop, copy to a new layer or turn the selection into a **mask**.
- **Adjustments panel:** add Brightness/Contrast, Levels, Curves, Hue/Saturation, Exposure, Vibrance, White Balance, Black & White, Invert, Posterize, Threshold, Blur, Sharpen, Noise and Vignette. They are **live** — change or remove them at any time. *Apply to pixels* makes them permanent.
- **Crop** (<kbd>C</kbd>): drag the area and press <kbd>Enter</kbd>.
- **Flood fill** (<kbd>G</kbd>) fills similar colours; **Colour picker** (<kbd>I</kbd>) samples a colour (<kbd>Shift</kbd> for stroke).

## Vector studio
- Draw with **Rectangle** (<kbd>M</kbd>), **Ellipse** (<kbd>E</kbd>), **Polygon** (<kbd>Y</kbd>), **Star** (<kbd>S</kbd>) and **Line** (<kbd>L</kbd>). Corner radius, sides and points are in the context bar and Properties panel.
- **Pen** (<kbd>P</kbd>): click to add corner points, click-and-drag for smooth curves, click the first point to close the shape, <kbd>Enter</kbd> to finish an open line, <kbd>Backspace</kbd> removes the last point.
- **Pencil** (<kbd>N</kbd>) draws smooth freehand lines.
- **Node tool** (<kbd>A</kbd>): drag points and handles; double-click a point to switch between smooth and corner; <kbd>Delete</kbd> removes a point; hold <kbd>Alt</kbd> to move one handle independently. Shapes are converted to curves automatically when you edit their points.
- **Colour panel:** pick Fill or Stroke, then None, Solid, Linear or Radial gradient. Click swatches to apply; <kbd>Shift</kbd>-click for stroke.
- **Booleans** (toolbar, Vector studio): Add, Subtract, Intersect, Exclude, Divide two or more shapes.
- **Artistic text** (<kbd>T</kbd>): click and type. Change font, size, weight, alignment, leading and tracking in the context bar.
- **SVG:** import with *File ▸ Import SVG* (shapes stay editable) and export with *File ▸ Export SVG*.

## Layout studio
- **Frame Text** (<kbd>X</kbd>): drag a box and type. Text that doesn't fit shows a red ➕ in the corner. Select two frames and choose **Link frames** (Properties panel or *Document ▸ Link Text Frames*) to flow the story on. Frames can have several columns.
- **Picture Frame** (<kbd>F</kbd>): drag a frame, then double-click it (or *File ▸ Place Image*) to fill it with a photo. Choose Fill, Fit, Stretch or Original size, then zoom and offset the image.
- **Pages panel:** add, duplicate, reorder and delete pages; give pages names.
- **Master pages:** add a master, put headers/footers/backgrounds on it, then choose it for each page under *This page ▸ Master*. Click **Done** in the purple banner to stop editing a master.
- **Document Setup** (<kbd>Ctrl/⌘</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd>): page size, margins, bleed, column guides and background.

## Exporting
Click **Export** at the right of the top bar (<kbd>Ctrl/⌘</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd>), or *File ▸ Export…*. Layout documents start on PDF; after that Quvrelo remembers the format you last used for each document. The **▾** next to Export lists every format, **Hand in…** (when assignments are on) and **Export again** (<kbd>Ctrl/⌘</kbd>+<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd>), which repeats your last export with the same settings and files without opening the dialog.
Formats (PNG, JPEG, SVG or PDF):
- **PNG / JPEG** — choose the scale (1×–4× or print 300 dpi) and transparency.
- **SVG** — keeps shapes and text as vectors.
- **PDF** — all pages or the current page, 96/150/300 dpi, optional bleed and crop marks for professional printers.

## Assignments (for teachers and students)
- Teachers: *File ▸ Assignment Details* stores the title, class, due date and instructions inside the document. Save it in your school's template folder or share it.
- Students: *File ▸ Hand In*, type your name, and a timestamped copy is placed in your class's hand-in folder.

## Safety net
- **Undo** <kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd>, **Redo** <kbd>Ctrl/⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>, or click any step in the **History** panel.
- Work is **autosaved** for recovery every minute. If the app closes unexpectedly, the welcome screen offers to restore your work.

## Updates
Quvrelo checks for updates in the background and downloads them for you. When one is ready you'll see **"Quvrelo x.y.z is ready — Restart"** at the bottom of the canvas and *Restart to update* in the status bar. Click **Restart**, or keep working: it installs the next time you quit. You never lose work: if your document has unsaved changes you're asked to save first.
- *Help ▸ Check for Updates* shows your version, what's new and the download progress.
- *Preferences ▸ General ▸ Updates*: turn off automatic downloads, or switch to the **Beta** channel to try new features early.
- If you installed Quvrelo with an MSI, a Linux package (deb/rpm) or Flatpak, or your copy isn't signed (macOS), Quvrelo tells you about new versions and links to the download (or shows the command to run) instead of installing them itself.
- At school or work your IT team may manage updates; those settings then show *Set by your organisation*.

## Accessibility
*File ▸ Preferences* (<kbd>Ctrl/⌘</kbd>+<kbd>,</kbd>): dark, light and high-contrast themes, interface size (75–200%), dyslexia-friendly interface font and reduce motion. The bundled **Atkinson Hyperlegible** and **OpenDyslexic** fonts are also available for your documents.
