## Unreleased

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
