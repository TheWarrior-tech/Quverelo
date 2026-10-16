# Training state

_Last updated 2026-10-16 by the ML engineer session (round 2)._

## Models
| Model | File | Status |
|---|---|---|
| QuvSelect **v1** (app default) | `ml/models/quvselect_v1.onnx` (+ `_int8`), orphan branch `ml-models`, sha256 in `ml/models/manifest.json` | **finished** at step 2000 (phase 1 to 1200, phase 2 warm restart to 2000); exported fp32 + int8; published on the `ml-models` branch, shipped in v0.6.0 |
| QuvSelect v0 (fallback, committed) | `ml/models/quvselect.onnx` | finished at step 3500 (2026-10-15); see the v0 section of `ml/MODEL_CARD.md` |

Held-out metrics are in `ml/MODEL_CARD.md` and `ml/models/eval_*.json`.

## How the v1 run is driven
Background job, resumable; safe to re-run after a sandbox reset (it does nothing if the job is alive):
```
cd ml
# phase 1 (finished):
bash scripts/run_train_v1.sh --steps 1200 --batch 8 --crop 192 --crop-hi 256 --ckpt-every 50 --threads 2
# phase 2 (warm restart from step 1200):
bash scripts/run_train_v1.sh --steps 2000 --restart-at 1200 --batch 8 --crop 224 --crop-hi 288 --hires-from 0.7 \
    --lr 1e-3 --lr-enc 2e-4 --ckpt-every 50 --threads 2
```
* Checkpoint (weights, EMA, optimiser, step, RNG): `ml/checkpoints/v1_last.pt`, frozen copies `v1_step1000.pt`,
  `v1_step1200.pt` (end of phase 1), `v1_step2000.pt`. All gitignored.
* Logs (JSON lines every 20 steps): `ml/logs/train_v1.log` (phase 1 copy: `train_v1_phase1.log`), stdout `train_v1.out`.
* Data: `ml/data/packed_v1/parts_320/` (22 parts, 43,261 images, 945 test; complete) built by
  `ml/scripts/build_dataset_v1.py --size 320` (resumable).
* Environment: `ml/.venv` (Python 3.12, torch 2.14.1+cpu, timm, onnxruntime 1.31), `HF_HOME=ml/.hf` (timm encoder weights).
* Do not `pkill -f quvrelo_ml.train_v1` from a shell whose own command line contains that string: it kills the shell too.

Export, evaluate, stage for release:
```
python -m quvrelo_ml.export_v1 --ckpt checkpoints/v1_last.pt --release-dir /workspace/work/ml-release
python -m quvrelo_ml.evaluate_v1 --onnx models/quvselect_v1.onnx --size 320 --json logs/eval_v1.json
```

## History
| Date | Steps | Note |
|---|---|---|
| 2026-10-16 | 0 -> 300 | Phase 1 on the dataset parts available at the time (build finished during the run) |
| 2026-10-16 | 300 -> 1200 | Phase 1 finished; two sandbox resets, resumed from checkpoint (steps 650, 1250). 2-12 s/step on the shared 2 vCPU |
| 2026-10-16 | 1200 -> 2000 | Phase 2 warm restart (larger crops, lower LR), finished; one more reset (resumed at 1250). Step 2000 is the shipped v1 |

## Next run (recommended)
1. The metric, not just the model, is the bottleneck for Select Subject: U2-Net-p (dedicated saliency model) scores 0.654 on
   our heuristic subject target, about what v1 scores. A cleaner subject label (human-judged "main subject" masks on a
   permissively licensed set) is the highest-value next step, before more compute.
2. More compute: phase 1+2 saw ~16k samples (< 0.4 epochs of the 43k-image pack). Unfreezing stages 0-1 and training at
   288-320 crops for several epochs needs a GPU or a quiet multi-core machine.
3. Open Images V7 train masks (same CC BY terms) to scale the data 30x.
