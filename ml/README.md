# Quvrelo ML

This folder holds the code and data provenance for Quvrelo's own on-device models. Everything here is reproducible and
uses permissively licensed data only.

| File | What it is |
|---|---|
| `MODEL_CARD.md` | Architecture, data, metrics, latency and limitations of the shipped model |
| `DATA_SOURCES.md` | Every dataset with its licence, plus the ones we rejected and why |
| `TRAINING_STATE.md` | Where the current run stands and how to resume it |
| `quvrelo_ml/model.py` | QuvSelect network: one model for Select Subject and click-to-select |
| `quvrelo_ml/data.py` | Sample generation: subject targets, copy-paste composites, simulated clicks |
| `quvrelo_ml/train.py` | Resumable CPU training (time-budgeted chunks) |
| `quvrelo_ml/evaluate.py` | Held-out mIoU (subject, click@1, click@3) |
| `quvrelo_ml/export_onnx.py` | ONNX export (opset 17, dynamic H/W) plus onnxruntime parity and latency check |
| `scripts/download_openimages.py` | Fetches the Open Images V5 validation segmentation subset (resumable) |
| `scripts/build_dataset.py` | Packs images and masks into compact training arrays |
| `models/quvselect.onnx` | The shipped model (3.2 MB). It is bundled into the app by Vite |

App side:
* `src/core/ml/` holds the pure TS parts: pre/post-processing, the mask-to-path tracer, the non-ML fallbacks and the `selectSubject` / `selectObject`
  API.
* `src/renderer/engine/mlSelect.ts` holds the onnxruntime-web backend.
* The `select.subject` command is under **Select ▸ Select Subject**.
