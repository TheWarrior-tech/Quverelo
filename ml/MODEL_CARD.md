# Model card: QuvSelect v1 (Select Subject, Object Select, Cut Out Subject)

| | |
|---|---|
| Files | `ml/models/quvselect_v1.onnx` (fp32, 12.6 MB) and `ml/models/quvselect_v1_int8.onnx` (int8 QDQ, 3.7 MB). Not in git: GitHub Release asset `ml-quvselect-v1`, fetched by `scripts/fetch-ml-models.mjs` (CI) and checked against `ml/models/manifest.json` (sha256 + bytes) |
| Version | v1, checkpoint step 1200 (`ml/checkpoints/v1_step*.pt`, gitignored), trained 2026-10-16 |
| Licence of weights | MIT (Quvrelo). Encoder initialised from `timm/mobilenetv3_large_100.ra_in1k` (Apache-2.0); see `ml/DATA_SOURCES.md` for the ImageNet note |
| Runtime | ONNX opset 17; onnxruntime-web 1.30 WASM (CPU, 1 thread) in the app, onnxruntime (Python) for evaluation |
| App choice | `src/core/ml/models.ts`: v1 fp32 if bundled, else v1 int8, else the committed v0 (`quvselect.onnx`) |

## Architecture
`ml/quvrelo_ml/model_v1.py`, 3.16 M parameters, same I/O contract as v0 (`input` float32 `[1, 6, H, W]`: ImageNet-normalised
RGB, positive-click map, negative-click map, previous mask; `logits` `[1, 1, H, W]`), so the app pipeline is unchanged.
* Encoder: MobileNetV3-Large (ImageNet-pretrained). A small prompt encoder adds click / previous-mask features at stride 4,
  8 and 16 through zero-initialised 1x1 projections, so step 0 is exactly the pretrained RGB encoder.
* Decoder: light FPN (64 channels) with global context, fused down to stride 2; prompts re-injected at stride 4.
* Stem and stages 0-1 frozen during fine-tuning (CPU budget).

## Training data
Open Images V5 segmentation (validation + test splits, 43,261 CC BY 2.0 images, 79,155 CC BY 4.0 instance masks, packed at
320 px by `ml/scripts/build_dataset_v1.py`). Held-out test split: Open Images *validation* images with
`sha1(ImageID) % 100 < 7` (945 images, never trained on; a superset of v0's test images). Targets and prompt simulation as
v0 (`ml/quvrelo_ml/data_v1.py`): subject = union of instances >= 25 % of the largest (largest >= 4 % of the frame), 25 %
of subject samples are CC BY cut-outs pasted on a blurred background; click samples get 1-3 positive and 0-3 negative
clicks and, 30 % of the time, a corrupted previous mask. Random-resized crops, flips, brightness jitter.

## Training recipe (2 vCPU, no GPU, shared machine)
`ml/quvrelo_ml/train_v1.py`, AdamW (wd 1e-4), BCE + soft IoU + 0.5 x boundary-weighted BCE, EMA weights exported.
| Phase | Steps | Batch / crop | LR (new layers / encoder) |
|---|---|---|---|
| 1 | 0 -> 1200 | 8 @ 192, last 20 %: 4 @ 256 | 2e-3 / 4e-4, 200-step warm-up, cosine |
| 2 (warm restart, `--restart-at 1200`) | 1200 -> 2000 | 8 @ 224, last 30 %: 4 @ 288 | 1e-3 / 2e-4, 50-step warm-up, cosine |

Phase 1 is about 9,600 samples (0.22 epochs of the pack); the run was CPU-bound at 2-9 s per step depending on the
other jobs on the machine, and resumed from its checkpoint after two sandbox resets. Loss log: `ml/logs/train_v1*.log`
(gitignored); history in `ml/TRAINING_STATE.md`.

## Metrics (held-out test split, GT at 256 x 256, model input 320, threshold 0.5)
`python -m quvrelo_ml.evaluate_v1 --onnx models/<model>.onnx --size 320`; results in `ml/models/eval_v1_test.json`,
`eval_v0_on_v1test.json`, `eval_ref_u2netp_v1test.json`.

| Model | Subject mIoU (n=717) | Subject IoU >= 0.8 | Click@1 mIoU (n=843) | Click@3 mIoU | Click@3 IoU >= 0.8 |
|---|---|---|---|---|---|
| **QuvSelect v1** (step 1200) | **0.658** | 44 % | **0.592** | **0.663** | 43 % |
| QuvSelect v0 (same items, input 320) | 0.444 | 5 % | 0.304 | 0.474 | 4 % |
| Reference: U2-Net-p (not shipped) | 0.654 | 46 % | n/a | n/a | n/a |
| Centred 50 % box baseline | 0.335 | | | | |

How to read this:
* v1 is a large step over v0 on every task (subject +0.21 IoU, click@1 roughly doubled).
* **It does not reach the 0.80 subject-IoU target.** The reference row is the reason we think the target is not reachable
  *on this metric*: U2-Net-p, a dedicated salient-object model trained on DUTS-TR (research licence; evaluated, never
  shipped or distilled), scores 0.654 on the same items. Our "subject" label is a heuristic over non-exhaustive Open Images
  instance annotations (e.g. a person and their bicycle, or one of three equal-size people), so a perfect saliency model is
  still penalised; v1 already matches U2-Net-p on it. Closing the rest needs a better-defined subject label (human-judged
  subject masks, permissively licensed) rather than more steps, plus far more compute (published models train for GPU-days).
* The median subject IoU is ~0.74 and ~44 % of subject results are >= 0.8, i.e. the mean is pulled down by a tail of
  "wrong subject" picks rather than by ragged edges.

### Showcase regression (`tests/unit/mlObjectSelect.test.ts`, hand-traced cottage in `tests/fixtures/sample-photo.jpg`)
| Pipeline (`ml/bench/objsel_variants.ts`, 7 clicks) | v0 | v1 |
|---|---|---|
| Single pass, no refine | 0.110 (review click) | 0.374-0.842 (0.842 review click) |
| Single pass + edge refine (**v1 default**) | | **0.929-0.938** |
| Focus passes + edge refine (**v0 default**) | 0.931-0.938 | 0.758-0.938 |

v1 localises small objects in the single 320 px pass, and the tight focus crops (0.5-1.25x the object; its training crops
never zoom that far) make it worse, so `models.ts` turns focus passes off for v1 (`focusPasses: false`) and keeps them for v0.

## Export and parity (`ml/models/export_report_v1.json`)
* fp32: max |logit diff| vs PyTorch 6e-6 at 320 (1.4e-5 at 384/512), 100 % mask agreement.
* int8 (static QDQ, per-channel weights, MinMax calibration on 64 *training* samples): 98.4 % mask agreement at 320, 3.5x
  smaller. onnxruntime (Python, 2 threads): fp32 113 ms / int8 68 ms at 320. In onnxruntime-web WASM the int8 kernels are
  slower than fp32, so the app prefers fp32 and keeps int8 as the smaller fallback asset.

## Latency (Select Subject at the app's 1024 px analysis size)
Step-1200 model, measured while other jobs loaded the 2-vCPU sandbox (load average ~7); final figures follow below.
* Electron app, `tests/e2e/ml-v1.spec.ts`, 1024x687 analysis: first use 2672 ms (WASM session creation + JIT), warm 592 / 702 ms.
* Node, same WASM binary (`ml/bench/subject_breakdown.ts`), CPU time per call: model 103 ms, matte (subsample 2) 70 ms, pre/post 45 ms, `selectSubject` total 194 ms.


---

# Model card: QuvSelect v0 (fallback model, committed) (subject + click-to-select segmentation)

| | |
|---|---|
| File | `ml/models/quvselect.onnx` (3.2 MB, sha256 `a7d6ea38b4b181bb2690de03b8ccdcb84dd0cbdeedc53c7accb46ab4d88430aa`) |
| Version | v0, checkpoint step 3500, trained 2026-10-14/15 |
| Licence of weights | MIT (same as Quvrelo), trained by us from random initialisation |
| Runtime | ONNX opset 17, onnxruntime (Python, CPU) and onnxruntime-web 1.30 (WASM, in the app) |
| Status | **First trained checkpoint. Works, but it is not production quality yet** (see Metrics, Limitations) |

## What it does
A single network handles both Photo-studio features:

* **Select Subject**: all prompt channels are zero, and the model predicts the main subject(s).
* **Click-to-select object**: you give positive and negative click maps, plus an optional previous mask for
  iterative refinement, and the model predicts the clicked object.

## Architecture
`ml/quvrelo_ml/model.py`. This is a compact U-Net-style encoder-decoder with **0.79 M parameters**.

* Input `input`: float32 `[1, 6, H, W]`, where H and W are multiples of 32. The six channels are:
  * RGB, normalised with ImageNet mean/std
  * a positive-click map
  * a negative-click map
  * the previous mask (0/1)
* Click maps: `max_k exp(-d_k² / 2σ²)`, with `σ = 0.02 · max(H, W)`. The same encoding is in
  `src/core/ml/clickMaps.ts`, and a fixture test checks the two match.
* Output `logits`: float32 `[1, 1, H, W]`.
* Encoder: a stride-2 stem, then Fused-MBConv residual stages (16-24-40-80-128 channels, strides 2/4/8/16/32).
  We used dense 3×3 and 1×1 convolutions because depthwise convolutions train several times slower on CPU.
* Context: 1×1, 3×3 and global-pool branches at stride 32. We avoided dilated convolutions because their CPU backward pass is very slow.
* Decoder: depthwise-separable fusion blocks at strides 16, 8, 4 and 2, with skip connections. The click and previous-mask
  maps are fed in again at stride 4 so clicks keep their spatial precision. Bilinear upsampling to the input size.
* No pretrained weights are used, so there is no third-party weight licence to track.

## Training data and licences
See `ml/DATA_SOURCES.md` for the full list. In short:

* **Open Images V5, validation split, segmentation subset.** The first 7,000 image IDs in sorted order that have
  instance masks (12,783 masks).
  * Images: **CC BY 2.0**. The licence is listed per image, and every one we used is CC BY 2.0. Per-image attribution
    is in `ml/data/openimages/ATTRIBUTION.csv`, which the download script regenerates.
  * Masks and annotations: **CC BY 4.0**, © Google LLC.
* Split: an image is in the **test** split when `sha1(ImageID) % 100 < 7`. That gives 505 held-out images, never used in training.
  The other 6,494 images are for training.
* Targets:
  * Subject: the union of instances whose area is at least 25 % of the largest instance, provided the largest covers at least 4 % of the image.
    In 30 % of subject samples we instead paste a CC BY instance cut-out onto a blurred, darkened copy of another
    training image, and the target is the cut-out.
  * Click: one random instance. 1 to 3 positive clicks inside it. 0 to 3 negative clicks, taken from other instances or
    from a ring around the object. In 30 % of samples a corrupted previous mask is added.
* Augmentation: random 224 crop from 256, horizontal flip, brightness and contrast jitter.
* We did **not** use DUTS, DUTS-TE, ECSSD, COCO or SA-1B. Their licences are research-only, mixed per image, or
  too restrictive for shipping weights in an MIT app.

## Training recipe
`python -m quvrelo_ml.train --steps 3500 --batch 8 --crop 224`
* AdamW, weight decay 1e-4, peak learning rate 2e-3.
  * Warm-up for 100 steps, then cosine decay.
  * The schedule was set for 2,000 steps up to step 1,113. We then extended it to 3,500, which raised the learning rate from 0.9e-3 to 1.5e-3.
* Loss: BCE plus soft-IoU. Gradient clipping at 5.
* EMA of the weights with decay 0.998. The exported weights are the EMA.
* Hardware: 2 vCPU sandbox, no GPU. About 65 minutes of wall time, run in ~100 s resumable chunks. 28,000 samples in total, about 4.3 epochs.
* The loss curve is in `ml/models/training_log.jsonl`. Loss fell from 1.46 to about 1.0.

## Metrics (held-out test split, 256×256, threshold 0.5)
Command: `python -m quvrelo_ml.evaluate --onnx ml/models/quvselect.onnx`. Results are in `ml/models/eval_test.json`.

| Task | n | mIoU |
|---|---|---|
| Select Subject (no clicks) | 388 | **0.458** |
| Baseline: centred 50 % box | 388 | 0.342 |
| Click@1 (one click at the object's most interior point) | 455 | **0.391** |
| Click@3 (+2 corrective clicks at the centre of the largest error) | 455 | **0.481** |
| Share of subject results with IoU ≥ 0.8 | | 4.4 % |
| Share of click@3 results with IoU ≥ 0.8 | | 7.0 % |

How to read this:
* The model is clearly learning. It beats the box baseline, extra clicks help, and the masks it predicts follow real object
  shapes.
* It is **undertrained**. The training loss is close to the test metrics, so it is underfitting, not
  overfitting. Masks are blotchy, and object edges are often incomplete.
* For context, published interactive-segmentation models reach about 0.85 or more at 3 clicks. Those models start from
  ImageNet-pretrained backbones and train for GPU-days.

## Export and parity
`python -m quvrelo_ml.export_onnx` writes `ml/models/export_report.json`.
* PyTorch against onnxruntime (Python): max |Δlogit| ≈ 3e-6 at 256, 320 and 512, with 100 % mask agreement.
* TS pre/post-processing plus onnxruntime-web against Python onnxruntime: more than 97 % pixel agreement on a held-out image
  (`tests/unit/mlModel.test.ts`). Resizing in `src/core/ml/tensor.ts` reproduces PIL BILINEAR, the resize used in training,
  to within 1e-3 (fixture test).

## Click-to-select pipeline in the app (zoom + edge refine)
A single squash-resized pass over the whole photo is not enough for small objects. At 320 px the showcase
cottage in `tests/fixtures/sample-photo.jpg` is only about 22×16 model pixels. On an object that small, v0 returns a blob the size of its
click Gaussian, not the object (critique 3, N0: IoU 0.11, 9× the cottage's area). The pipeline in
`src/core/ml/selectSubject.ts` is therefore:

1. **Coarse pass.** The whole image goes in at 320, and we keep the component under the click. This only *localises* the object.
2. **Focus passes.** When that component spans less than 75 % of the image's longer side, the model runs again on four square
   crops of 0.5, 0.75, 1 and 1.25 × its size. The crops are centred on the click, shifted to stay inside the image and never padded.
   They run at **256**, the training resolution, and their probabilities are averaged.
3. **Edge refine** (`src/core/ml/refine.ts`). This is a GrabCut-style min cut. The averaged probability is the prior, and colour GMMs plus a
   contrast-sensitive 8-neighbour smoothness term place the edge. Clicks are hard constraints. If the cut keeps less
   than 25 % of the model's region, which happens in "stuff" like water, sky or grass, we keep the model's region instead.

Logits are always upsampled bilinearly *before* the sigmoid and threshold. The click mapping (document → layer →
analysis pixel → crop → model grid, a squash with no letterbox) is in `src/core/ml/coords.ts`.

| Showcase regression (`tests/unit/mlObjectSelect.test.ts`) | IoU vs hand-traced cottage |
|---|---|
| Single pass (before) | 0.110 |
| Zoom + refine (now), 7 clicks over walls and roof | 0.931–0.938 (the test requires ≥ 0.80 and an area ≤ 1.5× the cottage bbox) |

Cost: 1 pass at 320 and 4 at 256, plus the cut on a region of at most 40k px. In the Electron app, one click on the showcase photo
takes about 0.7 s end to end on the 2-vCPU sandbox (`tests/e2e/objsel-c3.spec.ts`).

## Latency (CPU)
| Runtime | 320×320 | 512×512 |
|---|---|---|
| onnxruntime (Python), 2 threads | 12 ms | 30 ms |
| onnxruntime-web WASM in Node 22, 1 thread | 54 ms | 126 ms |
| Quvrelo Electron app, **Select ▸ Select Subject** end to end on a 1264×848 photo (`tests/e2e/ml.spec.ts`) | 225 ms total | |

* In the app, the image is analysed at up to 1024 px on its longest side, and the model runs at 320.
* TS pre-processing of a 1024×768 image takes about 30 ms. Post-processing, which covers upsampling, clean-up and contour tracing to a selection path, takes about 40 ms.
* Measured on the 2-vCPU sandbox, one Select Subject takes about 130 ms end to end. That is well inside the "<1 s per click" goal.

## Intended use and limitations
* **Intended use:** a starting selection for students that they then refine. Every result becomes an ordinary pixel
  selection they can edit.
* The quality of v0 is modest. Expect holes, spill into high-contrast backgrounds, and missed thin parts
  (limbs, straws, hair).
* "Subject" was derived from Open Images instance annotations, which are not exhaustive. The model has no notion of
  photographic saliency beyond what those annotations imply.
* Training resolution was 224 to 256 px. Select Subject is limited by the 320 px inference size. Click-to-select zooms in and snaps to colour edges (see above), but there is no matting, so hair and fur stay rough. The edge refine relies on colour contrast, so an object the same colour as its surroundings keeps the model's coarser mask.
* Data bias: Open Images is Flickr-sourced and skews toward Western, everyday scenes. We have not done a fairness evaluation across
  people.
* It is CPU only today. Nothing in the model prevents the WebGPU or GPU execution providers, but they are untested.

## Reproduce
```
pip install -r ml/requirements.txt          # torch CPU wheel from download.pytorch.org
python ml/scripts/download_openimages.py --max-images 7000   # re-run until "done"
python ml/scripts/build_dataset.py --size 256                # re-run until "done"
cd ml && python -m quvrelo_ml.train --steps 3500 --batch 8   # re-run until "finished" (resumable)
python -m quvrelo_ml.export_onnx && python -m quvrelo_ml.evaluate --onnx models/quvselect.onnx
```
