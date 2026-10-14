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
