# Training state

_Last updated 2026-10-15 00:30 BST by the ML engineer session._

## Current shipped model
* `ml/models/quvselect.onnx` comes from checkpoint step **3500 of 3500**, run **finished**. Metrics are in `ml/models/eval_test.json`
  and `ml/MODEL_CARD.md`: subject mIoU 0.458, click@1 0.391, click@3 0.481.

## How the run was driven
The sandbox has no background execution (`nohup` and `&` are not allowed), so training is resumable. Each invocation trains
for `--time-budget` seconds, writes a checkpoint, and exits. Re-run the same command until it prints `finished`:

```
cd ml
python -m quvrelo_ml.train --steps 3500 --batch 8 --crop 224 --time-budget 100
```
* Log (JSON lines, every 20 steps): `ml/logs/train.log`. A copy for provenance is in `ml/models/training_log.jsonl`.
* Checkpoint (weights + EMA + optimiser + RNG): `ml/checkpoints/last.pt`. A frozen copy is at
  `ml/checkpoints/quvselect_v0_step3500.pt`.
* Data:
  * `ml/data/openimages/` holds the raw images and masks.
  * `ml/data/packed/{images_256.bin, images_256_off.npy, masks_256_bits.npy, index_256.json}` is about 290 MB.
  * All of these are gitignored and reproducible with `ml/scripts/`.
* Environment: Python 3.12, torch 2.14.1+cpu, onnxruntime 1.31. The sandbox reset twice during the run and wiped
  the pip packages; the run resumed from the checkpoint each time. Reinstall with `pip install -r ml/requirements.txt`.

## History
| Date | Steps | Note |
|---|---|---|
| 2026-10-14 | 0 → 1113 | `--steps 2000` cosine schedule |
| 2026-10-14 | 1113 → 3500 | Extended to `--steps 3500`, which raised the learning rate (0.9e-3 → 1.5e-3), then cosine decay to 1e-5 |

## Next run (recommended)
1. Continue from `quvselect_v0_step3500.pt` with a new schedule:
   * Copy it to a new checkpoint path and pass `--steps 15000`.
   * The model is underfitting, so more steps is the cheapest gain.
   * Run it on a machine with more cores or a GPU. On 2 vCPU, ~1,100 steps take about 20 minutes.
2. Add the Open Images V7 **train** masks (same licences) to get from 6.5k to 100k+ images.
3. Widen the model (`QuvSelect(width=1.5)`) once compute allows. At 320 px, ONNX latency still has a lot of headroom
   under the 1 s budget.
