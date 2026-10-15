# Model card: QuvSelect v0 (subject + click-to-select segmentation)

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

## Latency (CPU)
| Runtime | 320×320 | 512×512 |
|---|---|---|
| onnxruntime (Python), 2 threads | 12 ms | 30 ms |
| onnxruntime-web WASM in Node 22, 1 thread | 54 ms | 126 ms |

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
* Training resolution was 224 to 256 px. Fine edges are limited by the 320 px inference size, and there is no matting or edge refinement yet.
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
