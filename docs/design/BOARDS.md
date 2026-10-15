# Comparison boards (Criterion 11 evidence)

Side-by-side boards of a **Mobbin reference** (left) against a **Quvrelo capture** (right), 2880 px wide, with an optional zoomed detail row. They support critic sign-off for Criterion 11 (premium/modern/intuitive vs Figma, Framer, Linear, Pitch, Notion).

**Reference images are never committed.** Mobbin screenshots are licensed to Mobbin and the app owners; they live only in a local refs folder (default `/workspace/work/refs-mobbin/`, with `SOURCES.md` listing every URL). Generated boards also contain reference imagery, so they stay out of the repo too (default `/workspace/work/boards/`).

## Regenerate

The capture set comes from three gated specs writing into one folder (all three themes):

```sh
QUVRELO_REVIEW_DIR=/workspace/work/review-v5 xvfb-run -a npx playwright test design-review review-captures review-extra
```

`review-extra.spec.ts` adds the unobstructed `layers` frame and the 150 % / 200 % screens (`<theme>-<screen>@150.png`).

```sh
# 1. Fetch the references (once) and build light boards
python3 scripts/compare-boards.py --fetch

# 2. All three themes from a newer capture set
python3 scripts/compare-boards.py --theme light --theme dark --theme high-contrast \
  --captures /workspace/work/review-v5 --out /workspace/work/boards

# 3. One board
python3 scripts/compare-boards.py --only command-palette --theme dark
```

Needs Python 3 + Pillow (`pip install pillow`) and `curl` for `--fetch`. Captures are read as `<captures>/<theme>-<name>.png`, matching the critic capture sets (`light-`, `dark-`, `high-contrast-` prefixes).

`--fetch` opens `https://mobbin.com/explore/screens/<id>`, reads the `og:image` meta tag, takes its `screenUrl` parameter (the full-res bytescale image) and saves it as `<refs>/<id>.png` at 2400 px wide.

## Boards (`scripts/compare-boards.config.json`)

| id | pattern | reference (Mobbin) | Quvrelo capture |
|---|---|---|---|
| editor-shell | Editor shell | Figma: Design Interface | `layout-mm` |
| tool-rail | Tool rail (zoomed) | Figma: Design Interface, bottom toolbar | `layout-mm` (left rail) |
| inspector | Inspector | Framer: Design Canvas (embed selected) | `vector` |
| layers | Layers panel | Framer: Layer Editor | `layers` (populated poster, unobstructed; from `review-extra.spec.ts`) |
| command-palette | Command palette | Linear: Command menu | `palette` |
| modal-export | Export dialog | Figma: Export Tutorial | `export` |
| modal-new | New-file dialog | Linear: New Issue Dialog | `new` |
| home-welcome | Home / welcome | Notion: Workspace home | `welcome` |
| empty-state | Empty state | Pitch: Workspace Home (empty folder) | `empty-canvas` |
| tooltip | Tooltip | Pitch: Design Customization (tooltip) | `tooltip` |
| menu | Menu / tool flyout | Figma: Shape Menu | `flyout` |

To add or retune a board, edit the config: `ref.mobbin` is the Mobbin screen id, `quvrelo` the capture name without theme prefix, `ref_crop` / `quvrelo_crop` are `[x0, y0, x1, y1]` fractions for the detail row (leave both out for no detail), and `detail_independent: true` sizes each detail separately when the crop shapes differ a lot (for example a horizontal toolbar next to a vertical rail).

## Known gaps

- No Quvrelo capture shows a populated layers panel without an overlay. Add one (for example `<theme>-layers.png`) to the critic capture script and point the `layers` board at it.
- The Mobbin export reference is Figma's export *tutorial* card over the editor; Mobbin has no plain Figma export-settings dialog on a free page.
