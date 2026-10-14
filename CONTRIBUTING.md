# Contributing to Quvrelo

Thanks for helping build a creative suite schools and teams can rely on.

## Ground rules
- **Keep `main` green.** Every change goes through CI (typecheck, unit tests, Electron end-to-end tests). Small, focused pull requests are easiest to review.
- **Free and open source dependencies only**, with MIT-compatible licences.
- **Offline and private.** No telemetry, analytics, remote fonts or network calls from the renderer. New network features must be opt-in and controllable by `policy.json`.
- **Accessible by default.** Every control needs a visible label or `aria-label`, keyboard access and visible focus.

## Setup
```sh
git clone https://github.com/TheWarrior-tech/Quverelo.git
cd quvrelo
npm ci
npm run dev
```

## Checks
```sh
npm run typecheck
npm test                 # Vitest unit tests for src/core
npm run build
npm run test:e2e         # Playwright + Electron (Linux: xvfb-run -a npm run test:e2e)
QUVRELO_SHOTS_DIR=docs/screenshots xvfb-run -a npx playwright test screenshots   # refresh README screenshots
```

## Architecture
```
src/
  core/        Pure TypeScript, no DOM. The single document model shared by every studio.
    types.ts         QuvreloDocument, pages, masters, stories, nodes (raster, vector, text, frames, groups)
    document.ts      factories, tree helpers, geometry of nodes
    commands.ts      pure document operations (add, group, align, booleans, pages, masters, text frames…)
    history.ts       undo/redo over immutable snapshots (structural sharing)
    textflow.ts      line breaking and story flow across linked frames and columns
    pixels.ts        adjustments, filters, histogram, flood fill (pure RGBA operations)
    boolean.ts       path booleans (paper.js, headless)
    svg.ts           SVG exporter
    serialization.ts .quvrelo zip format; migrate.ts upgrades older files
    templates.ts     built-in and classroom templates
    policy.ts        policy.json schema and validation
  renderer/
    engine/    draw.ts (the one scene renderer for editor, thumbnails and exports), Viewport (fabric.js
               canvas for selection/transform + overlay), tools, text editing, exporters, SVG import
    state/     editor state, command registry (every menu/shortcut/button runs a command id), file IO
    ui/        React components: workspace, panels, dialogs, welcome screen
  main/        Electron main process and preload (file IO, native menus, policy, recovery, hand-in)
  shared/      IPC contract and menu definition
tests/
  unit/        Vitest tests for src/core
  e2e/         Playwright tests that drive the real Electron app
```

### Principles
1. **Model first.** Features start as pure functions in `src/core` with unit tests. The UI calls them through `editor.commit(label, fn)` so they are undoable automatically.
2. **One renderer.** Anything drawn on screen must render through `engine/draw.ts`, so exports always match the canvas.
3. **Immutable pixels.** Raster edits create a new asset id instead of mutating pixels, keeping undo cheap and safe.
4. **Commands everywhere.** Register new actions in `state/commands.ts` and (if user-facing) in `shared/menu.ts`; tests can then call them by id.

## Releasing
1. Update `version` in `package.json` and `docs/RELEASE_NOTES.md`.
2. Commit, then tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. GitHub Actions builds Windows (NSIS + MSI), macOS (DMG + PKG) and Linux installers and publishes them to a GitHub Release with SHA-256 checksums.

## Reporting bugs
Open an issue with your OS, Quvrelo version (*Help ▸ About*), steps to reproduce and, if possible, the `.quvrelo` file.
