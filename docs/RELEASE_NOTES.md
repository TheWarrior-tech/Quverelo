## Unreleased

A new editor shell, faster photo selection and cropping, a command palette, and a redesigned start screen, merged into one release line.

### Editor shell
- **Top bar in three zones:** document name and save state on the left; studio switch, Undo/Redo and Place image in the centre; Open, Save, shortcuts, Preferences and **Export ▾** on the right. Export ▾ is the only filled button in the bar.
- **Left rail with tabs** for Layers, Pages and Assets; the right-hand **inspector** is organised by concern: **Design**, **Adjust** (Photo) and **History**.
- **Floating selection toolbar** under a selected object (fill, stroke, arrange, duplicate, delete; Boolean in Vector). <kbd>F6</kbd> moves into it. Turn it off in Preferences ▸ Canvas.
- **One colour control everywhere** (the colour chip opens the same picker in the context bar, inspector and rail), one segmented control, quieter context-bar hints, and a **font picker** with search, Recent/Bundled/System/Installed groups, previews and live arrow-key preview (<kbd>Esc</kbd> reverts).
- Clearer selection: accent handles with a white ring, a thin hover outline that never looks like a selection, and outlines on every member of a multi-selection.

### Photo
- **Object Select (<kbd>W</kbd>)** on the Photo rail: click an object to select it, click again to add, <kbd>Alt</kbd>-click to remove.
- **Select subject** is the first button for every selection tool (<kbd>Ctrl/⌘</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd>).
- After a pixel selection, a **floating action strip** offers Remove background, Mask, Copy to layer, Crop and Invert. It takes the place of the object toolbar while a pixel selection exists, so only one floating bar shows at a time.
- **Crop, rebuilt:** an adjustable box with 8 handles, ratio presets (Free, Original, 1:1, 4:3, 16:9 …) and portrait/landscape swap, exact W/H, a thirds or grid overlay, and **Apply** / **Cancel** (<kbd>Enter</kbd> / <kbd>Esc</kbd>).

### Command palette and tooltips
- **Command palette.** <kbd>Ctrl/⌘</kbd>+<kbd>K</kbd> (or <kbd>Ctrl/⌘</kbd>+<kbd>/</kbd>) searches and runs every menu command, tool, template and recent file, with synonyms ("cutout" finds Select Subject, "print" finds Export PDF), shortcut keycaps, a Recent section and a one-line reason when a command can't run yet. Fully keyboard operable and screen-reader friendly.
- **New tooltips.** Faster (400 ms), drawn in the app's own style with the shortcut as keycaps and a how-to line on tools; they also appear on keyboard focus, can be hovered, and close with <kbd>Esc</kbd>.

### Getting started
- **Welcome, redesigned:** uses the full window width, with a search box (press <kbd>/</kbd>) that filters templates and recent files, Recent as a compact list with the full folder shown and the whole path in a tooltip, and themed scrollbars in every theme.
- **Edit a photo…** on the welcome screen opens a picture straight into the Photo studio. **Poster or social post** and **A4 page** open New Document with the size already chosen.
- **One way to start a blank document:** New Document picks the studio from the category (Photo → Photo, Screen → Vector, Print and School → Layout; multi-page documents → Layout). *Open in* moved under **More options**.
- **Get started checklist:** five first steps that tick themselves as you go and link straight to each action. IT can turn it off with the new `policy.json` key `disableOnboarding`.
- **Drag and drop, visible:** dragging a file over the window shows *Drop to open* (welcome screen) or *Drop to place* (over the canvas).
- **Empty pages** show *Place image…*, *Draw a shape* and *Add text*.

### Export
- The top bar has an **Export ▾** button. Export… opens on PDF for Layout documents and remembers the last format per document; the menu lists every format, **Hand in…** and **Export again** (<kbd>Ctrl/⌘</kbd>+<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd>), which repeats the last export without the dialog. <kbd>Ctrl/⌘</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> now opens Export… (it used to open Export PNG).

---

## Quvrelo v0.3.0 — over-the-air updates

### Over-the-air updates
- **Automatic updates:** Quvrelo checks 30 seconds after launch and every 4 hours, downloads in the background (delta downloads on Windows and AppImage), verifies each update's SHA-512, and shows *"Quvrelo x.y.z is ready — Restart"*. Otherwise it installs when you quit. Unsaved work always gets the save prompt first.
- **Help ▸ Check for Updates** opens a proper dialog: your version and channel, status and download progress, release notes, *Restart Now* / *Later*.
- **Preferences ▸ General ▸ Updates:** turn background downloads off, or choose the **Stable** or **Beta** channel.
- **Per platform:** Windows installer (NSIS), AppImage and signed macOS builds update themselves. MSI, unsigned macOS builds, deb/rpm and Flatpak tell you about the new version and link to the download or show the package-manager command.
- **For IT:** new `policy.json` keys `updateFeedUrl` (host updates on your own server), `autoDownload`, `autoInstall` and `updateChannel`; `disableUpdateCheck` turns all update traffic off. See the admin guide, section "Updates".
- **Note:** while the GitHub repository is private, apps cannot read the public update feed; updates work once it is public or with an `updateFeedUrl`.

---

## Quvrelo v0.2.0 — premium redesign

A top-to-bottom redesign of how Quvrelo looks and feels, plus our first in-house machine-learning feature.

### What's new
- **Design system:** one set of colour, spacing, radius and type tokens across every surface, in Dark, Light and High contrast.
- **Icons:** a redrawn, consistent icon set and re-rendered app icons that stay crisp at small sizes.
- **Dialogs:** a shared dialog frame for New Document, Export, Preferences, Keyboard Shortcuts and About.
- **Welcome screen:** Recent files first with real thumbnails, quick starts per studio and redrawn classroom templates.
- **Colour picker:** a proper picker with fill/stroke chips, recent colours, number scrub fields and sliders.
- **Panels:** a rebuilt Layers panel and resizable, collapsible panel groups.
- **Curves editor:** a real Curves adjustment with draggable points on a histogram, per-channel RGB/R/G/B.
- **Canvas selection:** selection box and handles in Vector and Layout; the pixel selection (marching ants) only in Photo; one active studio segment in a centred top bar; toasts bottom-centre.
- **Layout context:** page guides and rulers, and a page-setup context bar (margins, bleed, columns, page navigation).
- **Accessibility and contrast audit:** every icon button has a name, tooltip and keyboard shortcut for assistive tech; control borders and secondary text meet WCAG 2.2 AA; visible keyboard focus in every theme; reduced-motion respected (including the OS setting).
- **Flatpak:** Linux builds are now also offered as a Flatpak.
- **Select Subject (preview):** our first in-house, fully on-device ML model (v0). In the Photo studio, **Select ▸ Select Subject** makes a pixel selection of the main subject. This is an **early model**: it scores 0.458 mean IoU on our held-out test set, so expect blotchy or incomplete edges and refine the selection by hand. It runs offline, sends nothing anywhere, and falls back to a simple colour-based selection if the model can't load. Better models will follow.

---

## Quvrelo — first public preview

Photo editing, vector design and page layout in **one** offline app, built for schools and professional teams.

### Highlights
- **Three studios, one document:** Photo, Vector and Layout share the same file — switch at any time.
- **Photo:** pixel layers, brush/eraser, flood fill, rectangle/ellipse/freehand selections, crop, masks and 15 **live, non-destructive** adjustments and filters with a histogram.
- **Vector:** shapes, pen and pencil, node editing, gradients, strokes, boolean operations, align/distribute, SVG import and export.
- **Layout:** multi-page documents, master pages, linked text frames with flowing columns, picture frames, margins/bleed and multi-page PDF export with crop marks.
- **Classroom pack:** worksheets, certificates, lesson plans, timetables, exit tickets, name badges, flashcards, reading logs, rules posters, newsletters and more.
- **School-ready:** no accounts, no telemetry, assignment brief + Hand In, admin `policy.json`, silent per-machine installers (MSI `/qn`, NSIS `/S /allusers`, macOS `.pkg`), high-contrast theme, scalable UI and dyslexia-friendly fonts.

### Downloads
| | Installer |
|---|---|
| Windows | `Quvrelo-Setup-*-x64.exe` (or `-arm64.exe`) · managed: `Quvrelo-*-x64.msi` |
| macOS | `Quvrelo-*-mac-arm64.dmg` (Apple silicon) or `-mac-x64.dmg` (Intel) · managed: `.pkg` |
| Linux | `.AppImage` · `.deb` (Debian/Ubuntu) · `.rpm` (Fedora/RHEL/openSUSE) |

Verify downloads with `SHA256SUMS.txt`.

### First launch on unsigned builds
- **Windows SmartScreen:** click **More info ▸ Run anyway**.
- **macOS Gatekeeper:** right-click the app in Applications ▸ **Open** ▸ **Open** (macOS 15+: *System Settings ▸ Privacy & Security ▸ Open Anyway*).

### Known limitations
- PDF export is high-resolution raster per page (vector PDF and PDF/X are on the roadmap).
- Text styling applies to a whole text object/story (per-character styles are coming).
- PSD/IDML/Affinity file import is not available yet.

See the [IT admin guide](https://github.com/TheWarrior-tech/Quverelo/blob/main/docs/ADMIN_GUIDE.md) and [user guide](https://github.com/TheWarrior-tech/Quverelo/blob/main/docs/USER_GUIDE.md).
