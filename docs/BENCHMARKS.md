# Benchmarks

`npm run bench` builds the app and runs `tests/bench/bench.spec.ts` (Playwright + Electron, outside the
normal e2e run). It writes `test-results/bench.json` and prints a Markdown table. Timings are wall-clock
from the test driver to "two animation frames later", so they include IPC, React and the canvas paint,
not just the algorithm.

The scenarios are generated on the fly (no large files in the repo):

- **Photo**: a 6000 × 4000 JPEG (24 MP, ~2.2 MB) with gradients and 4,000 translucent circles, written
  to disk and opened through File › Open. A live adjustment stack (Brightness/Contrast, Hue/Saturation,
  Gaussian blur r = 8, then Vibrance) is added, first at fit-to-window zoom, then at 100 %. Then a
  full-size JPEG and PNG export.
- **Layout**: a 50-page A4 document (`tests/bench/fixtures.ts`): one story of ~120 paragraphs threaded
  through 50 two-column text frames, a photo frame, a title and 10 shapes on every page. Open, page
  through all 50 pages, export a vector PDF (embedded fonts).

## Machine

The recorded runs were on the CI sandbox: Linux 6.12, **2 vCPUs**, 8 GB RAM, software GL under Xvfb,
with other test suites running at the same time (load average 9–13). Numbers vary ±40 % run to run on
that box; a teacher's laptop is typically 2–4× faster. Treat them as relative (before → after) rather
than absolute.

## Results (16 Oct 2026)

"Shown" = the canvas has painted the new look. "Full detail" = the render at the size the current zoom
needs has landed (for big photos that runs in a background worker while the app stays responsive).

| Scenario | Step | Before (ms) | After (ms) |
|---|---|---:|---:|
| Photo | open 6000 × 4000 JPEG | 1,347 | 971–1,587 |
| Photo | fit view, add Brightness/Contrast — shown | 1,503 | 451–647 |
| Photo | fit view, add Brightness/Contrast — full detail | (same) | 485–914 |
| Photo | fit view, add Hue/Saturation — shown | 8,240 | 435–593 |
| Photo | fit view, add Hue/Saturation — full detail | (same) | 456–927 |
| Photo | fit view, add Gaussian blur r = 8 — shown | **38,192** | 697–1,092 |
| Photo | fit view, add Gaussian blur r = 8 — full detail | (same) | 1,157–1,673 |
| Photo | zoom to 100 % (3 adjustments) — shown | n/a | 240–558 |
| Photo | zoom to 100 % — full 24 MP detail (worker) | n/a | 8,178–9,222 |
| Photo | at 100 %, add Vibrance — shown / full detail | n/a | 249–706 / 1,185–1,709 |
| Photo | export full-size JPEG | 962 | 686–1,266 |
| Photo | export full-size PNG | 1,974 | 1,984–2,831 |
| Layout | open 50-page document | 3,207 | 1,185–2,233 |
| Layout | page through 49 pages (total) | 6,781 | 2,983–4,821 |
| Layout | slowest single page change | 232 | 119–186 |
| Layout | export 50-page vector PDF | 14,194 | 1,065 |

Targets from the parity plan: open a 6000 × 4000 photo in under 2 s (met), a filter visible in under
1 s (met at fit zoom; Gaussian blur is at the edge on this 2-core box), 50-page layout paging smooth
(every page change under 200 ms), export reasonable (JPEG ~1 s, PNG ~2–3 s, 50-page PDF ~1 s).

## What was slow and what changed

1. **Every adjustment re-rendered the whole stack at full resolution on the main thread.** The editor
   asked for full-size pixels whenever no slider was being dragged, so adding a blur to a 24 MP photo
   froze the window for ~38 s. Now (`src/renderer/engine/assets.ts`):
   - the canvas asks for the resolution it actually shows (`renderLevel`: 1, ½, ¼… of the source,
     from zoom × device pixel ratio);
   - big images (> 4 MP) render a small level (≤ 1 MP) synchronously and the level the view needs in a
     Web Worker (`src/renderer/engine/adjustWorker.ts`, the same pure `core/pixels` code), then repaint;
   - each prefix of the adjustment stack is cached, so adding or editing the last step only computes
     that step; the cache has a pixel budget (160 MP) instead of a fixed entry count (24 full-size
     renders could reach 2.3 GB);
   - export first makes the full-size renders it needs in the worker (`prepareFull`), so the UI keeps
     painting during a big export;
   - the Adjustments panel histogram uses a small cached level instead of a separate 1600 px render on
     every change.
   If a worker can't start, the same render runs on the main thread (counted in `assets.stats`); the
   e2e `big-photo.spec.ts` checks that the worker ran and that its pixels equal the main-thread render.
2. **Gaussian blur walked memory column by column, one channel at a time.** The box passes now slide
   four accumulators along rows and keep one running sum per column for the vertical pass (identical
   output, verified bit-for-bit against the old code). 24 MP blur in Node: 20.7 s → 6.1 s.
3. **Hue/Saturation allocated two arrays per pixel.** Inlined HSL maths, same result: 2.6 s → 1.8 s
   for 24 MP in Node.
4. **PDF export shaped every line of text from scratch.** 85 % of a 50-page export was fontkit's
   OpenType shaping inside pdf-lib's `encodeText`. Lines are now shaped word by word with a per-font
   word cache (`src/core/pdfTextCache.ts`); glyphs are identical (unit-tested against full-line
   shaping for Inter and Atkinson Hyperlegible). Caveat: the bench story repeats one paragraph, so its
   cache hit rate (and the 14 s → 1 s gain) is higher than for real prose; the unit test on varied
   text shows a ≥ 3× speed-up.

## Known remaining costs

- Full 24 MP detail at 100 % zoom takes several seconds in the worker on a 2-core machine (the screen
  shows a ½-resolution version within half a second). Tiled rendering of only the visible area would
  cut this further; not done yet.
- PNG encoding of a 24 MP image (~2–3 s) is Chromium's encoder.
- Layout open time is mostly React mounting the Pages panel thumbnails and the first story flow.
