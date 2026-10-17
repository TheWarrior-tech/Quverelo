# Offline operation — audit evidence

Quvrelo works with no network connection, and the only part of the app that ever opens
a network connection by itself is the updater, which policy can switch off. This page
lists the controls that make that true, where each one sits in the source, and the tests
that check it, so an IT or data-protection review can verify the claim rather than take
it on trust.

| Control | Where | Test |
| --- | --- | --- |
| Renderer Content Security Policy | `src/renderer/index.html` | `tests/e2e/offline.spec.ts` |
| Session request filter (blocks every remote request) | `src/core/requestFilter.ts`, wired in `src/main/main.ts` | `tests/unit/requestFilter.test.ts`, `tests/e2e/offline.spec.ts` |
| Fonts, ML model and WASM bundled and loaded locally | `src/renderer/engine/pdfFontFiles.ts`, `src/renderer/engine/mlSelect.ts` | `tests/e2e/export-pdf.spec.ts`, `tests/e2e/ml.spec.ts` |
| Links open in the browser only if policy allows | `src/main/main.ts` (`setWindowOpenHandler`, `shell:open-external`) | code review (section 3) |
| Linux spell-check dictionaries never downloaded | `src/main/main.ts` (`setSpellCheckerDictionaryDownloadURL`) | code review (section 2) |
| Scripts run in a sandbox with no network | `src/core/scripting/runner.ts` | `tests/unit/scripting.test.ts` |
| Updater: the only network client, with policy switches | `src/main/updates/` | `tests/unit/updates.test.ts`, `tests/e2e/updates.spec.ts` |

## 1. The renderer cannot reach the network

The user interface (the renderer) runs with `sandbox: true`, `contextIsolation: true`
and `nodeIntegration: false`, and it is protected by two independent layers.

**Layer 1: Content Security Policy** (`src/renderer/index.html`):

```
default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline';
font-src 'self' data:; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' blob: data:
```

`'self'` is the app's own `file://` bundle. Nothing remote can be fetched, framed, loaded
as an image or font, or opened as a WebSocket. Navigation away from the app is also
cancelled (`will-navigate` → `preventDefault`), and `window.open` is always denied (see 3).

**Layer 2: session request filter.** Every request from the default session goes through
`session.defaultSession.webRequest.onBeforeRequest`, which calls `isRequestAllowed()` in
`src/core/requestFilter.ts`. Only these are allowed:

- `file:`, `data:`, `blob:` and `devtools:` URLs (the app's own bundle and in-memory data);
- **development runs only**: the Vite dev server's exact origin, over http and its
  hot-reload WebSocket (for example `http://localhost:5173` and `ws://localhost:5173`).
  This applies only when the app is **not packaged** (`app.isPackaged === false`) **and**
  `VITE_DEV_SERVER_URL` names a localhost address. In a packaged build (every installer,
  MSI, AppImage, deb/rpm, dmg) no http, https, ws or wss URL is ever allowed, even
  `localhost`, and whatever the environment variables say.

Everything else is cancelled before a connection is made.

Evidence:

- `tests/unit/requestFilter.test.ts` checks that packaged builds block `ws://localhost`,
  `http://localhost` and remote URLs even with `VITE_DEV_SERVER_URL` set; that unpackaged
  runs without a dev server block them as well; that dev runs allow only the dev server's
  exact origin (another port, or tricks like `localhost:5173.evil.com`, are blocked); and
  that a dev server URL that is not on localhost is ignored.
- `tests/e2e/offline.spec.ts` starts a real HTTP/WebSocket server on localhost and checks:
  (a) from the app window, `fetch`, `new WebSocket('ws://localhost:…')` and an `<img>` are
  all blocked; (b) from a window with **no** CSP in the same session (so only the request
  filter stands in the way), the same requests are blocked and recorded by the filter; and
  (c) the server receives **zero** connections.

## 2. Fonts, models and engines are local files

- **Interface fonts** come from `@fontsource/*` packages that are bundled into the app by
  Vite. No font CDN is used.
- **PDF export** embeds fonts by `fetch`-ing the bundled `.woff` files by their local asset
  URL (`src/renderer/engine/pdfFontFiles.ts` → `fontUrl()`, used in
  `src/renderer/engine/export.ts` → `loadFont()`). These URLs resolve inside the app
  (`file://…/dist/assets/…`), so the fetch never leaves the machine and goes through both
  layers above. If a file cannot be read, the export draws that text as an image and
  names the reason in the export report; it never goes online.
- **System fonts** are listed through the Local Font Access API, which reads the fonts
  already installed on the computer. Policy can switch it off (`local-fonts` in
  `disabledFeatures`), and the main process then refuses the permission.
- **Spell checking** uses the operating system's spell checker on Windows and macOS. On
  Linux, Chromium would normally download Hunspell dictionaries from Google; Quvrelo
  points that download at a local folder instead (`<install>/resources/dictionaries/`,
  where IT may place `<language>.bdic` files), so nothing is fetched. Without those files,
  spell checking on Linux is simply off.
- **Subject selection (ML)** uses the bundled `ml/models/quvselect.onnx` and the
  `onnxruntime-web` WASM file, both loaded by local URL (`src/renderer/engine/mlSelect.ts`).
  Images are never uploaded.
- **Scripting** runs in QuickJS compiled to WebAssembly (`src/core/scripting/runner.ts`).
  A script has no DOM, Node, file system or network access. It can only make the document
  calls listed in `docs/SCRIPTING.md`.

## 3. Opening links in the browser is a policy decision

The app never shows web pages itself. A link (Help ▸ Documentation, a link in an
imported file, the releases page) can only be passed to the system browser by the main
process, and only if both of these hold:

- the `external-links` feature is enabled (it is unless policy lists it in
  `disabledFeatures`), and
- the URL is `http://` or `https://` (no `file:`, `javascript:` or custom schemes).

There are two code paths, both in `src/main/main.ts`: `setWindowOpenHandler` (always
returns `deny`, and opens the browser only if the checks pass) and the
`shell:open-external` IPC handler that the renderer uses. With `external-links` disabled,
links do nothing.

One related path: the update dialog's **Download update** button (when an install cannot
update itself, for example a Linux tarball or a Mac app run from its disk image) opens the release download page through
`UpdateService.openDownload()` (`src/main/updates/updater.ts`). It is controlled by the
update switches below: with update checks off, no update is ever found, so the button
never appears.

## 4. The updater is the only network client

The updater in the main process (`src/main/updates/`) is the only code that opens network
connections. `electron-updater` reads a small YAML feed (`latest.yml` / `beta.yml`) and, if
allowed, the new version is downloaded with its checksum (SHA-512) verified: by
electron-updater for NSIS / AppImage, and by Quvrelo's own downloader (`files.ts`, a
dedicated Electron session separate from the UI's) for macOS, MSI and deb/rpm. Both only
contact the feed host (GitHub Releases and its download CDN, or `updateFeedUrl`). The
renderer never sees remote content.
Release notes are reduced to plain text in the main process (`releaseNotesToText()` in
`src/main/updates/config.ts`).

When it runs:

- one check shortly after start, then periodically while the app is open, and when the
  user picks Help ▸ Check for Updates;
- **never in development builds** (unpackaged), and never in portable or App Store
  copies (`src/main/updates/strategy.ts`).

Policy switches (`policy.json`, see `docs/ADMIN_GUIDE.md` › Updates):

| Key | Effect |
| --- | --- |
| `"disableUpdateCheck": true` or `"update-check"` in `disabledFeatures` | No update connection at all, automatic or manual. Help ▸ Check for Updates says updates are managed by your organisation. **With this set, Quvrelo makes no network connections.** |
| `"updateFeedUrl": "https://updates.school.internal/quvrelo/"` | Use an internal server (electron-builder "generic" feed) instead of GitHub Releases. The app then only contacts that host. |
| `"updateRepository": "owner/repo"` | Read another public GitHub repository's Releases. |
| `"autoDownload": false` | Check only; never download in the background. |
| `"autoInstall": false` | Install a downloaded update only when the user clicks Restart. |
| `"updateChannel": "stable"` | Lock the channel (no beta builds). |

Default (no policy): the GitHub Releases of the repository named in `RELEASES_REPO` (`src/main/updates/config.ts`), currently `https://github.com/TheWarrior-tech/Quverelo/releases`.

## 5. Checking it yourself

- Install with `"disableUpdateCheck": true` and run the app with outbound traffic logged
  (a firewall log, Wireshark, or `Little Snitch` / Windows Firewall audit mode): there are
  no connections.
- Without that switch, the only destination is `github.com` / `objects.githubusercontent.com`
  (or the host in `updateFeedUrl`), and only at the times listed in section 4.
- `npx vitest run tests/unit/requestFilter.test.ts` and
  `xvfb-run -a npx playwright test tests/e2e/offline.spec.ts` repeat the checks above.

## Known limits

- Remote references inside files the user opens (for example an SVG that links to an
  image on a website) are never fetched: both layers in section 1 block them.
- The operating system itself (its spell checker on Windows and macOS, font services,
  file dialogs on network drives) is outside Quvrelo's control.
- Loading Linux dictionaries from the local `dictionaries` folder relies on Chromium
  accepting a `file://` dictionary URL; this is not covered by an automated test. The
  guarantee that matters for the audit (no download from Google) holds either way.
