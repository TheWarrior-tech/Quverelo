"""Reference point only (never shipped, never trained on): how a public salient-object model scores on *our* held-out
subject target. U2-Net-p (Qin et al. 2020; weights Apache-2.0, github.com/xuebinqin/U-2-Net; ONNX export from
github.com/danielgatis/rembg, MIT) is trained on DUTS-TR, a research dataset, which is why we do not ship it.
This tells us how much of the remaining gap is our "subject" label definition rather than the model.

    python -m quvrelo_ml.evaluate_ref --onnx data/ref/u2netp.onnx
"""
import argparse, json

import numpy as np
import torch
import torch.nn.functional as F

from .data_v1 import eval_items_v1, resize_t
from .evaluate import iou


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", default="data/ref/u2netp.onnx")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    import onnxruntime as ort
    s = ort.InferenceSession(a.onnx, providers=["CPUExecutionProvider"])
    name = s.get_inputs()[0].name
    subj, _ = eval_items_v1()
    if a.limit:
        subj = subj[: a.limit]
    mean, std = np.array([0.485, 0.456, 0.406]), np.array([0.229, 0.224, 0.225])
    res = []
    for _, img, gt in subj:
        im = resize_t(img.astype(np.float32), (320, 320), "bilinear").numpy().transpose(1, 2, 0)
        im = im / max(im.max(), 1e-6)
        x = ((im - mean) / std).transpose(2, 0, 1)[None].astype(np.float32)
        p = s.run(None, {name: x})[0][:, :1]
        p = (p - p.min()) / max(p.max() - p.min(), 1e-6)  # rembg's normalisation
        p = F.interpolate(torch.from_numpy(p), size=gt.shape, mode="bilinear", align_corners=False)[0, 0].numpy()
        res.append(iou(p > 0.5, gt))
    print(json.dumps({"model": a.onnx, "n_subject": len(res), "subject_mIoU": round(float(np.mean(res)), 4),
                      "subject_IoU_ge_0.8_frac": round(float(np.mean(np.array(res) >= 0.8)), 4)}))


if __name__ == "__main__":
    main()
