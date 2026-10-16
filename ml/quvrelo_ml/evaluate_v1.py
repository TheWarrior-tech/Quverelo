"""Held-out evaluation for QuvSelect v1 (and v0, on the same items, for a like-for-like comparison).

Test split: Open Images V5 *validation* images with sha1(ImageID) % 100 < 7 (never trained on; Open Images test-split
images are all training data). Ground truth at 256 x 256 as in v0's evaluation; the model input is the image
squash-resized to --size (the app's inference size), logits are resized to 256 before the 0.5 threshold.

Metrics: subject mIoU (zero prompts), click@1 (one click at the instance's most interior point), click@3 (+2 corrective
clicks at the centre of the largest error region, feeding the previous mask back), shares with IoU >= 0.8, and the
centred-box baseline.

    python -m quvrelo_ml.evaluate_v1 --ckpt checkpoints/v1_last.pt --size 320 --json models/eval_v1.json
    python -m quvrelo_ml.evaluate_v1 --onnx models/quvselect_v1.onnx --size 320
    python -m quvrelo_ml.evaluate_v1 --onnx models/quvselect.onnx --size 256        # v0 on the v1 test set
"""
import argparse, json, os, time

import numpy as np
import torch
import torch.nn.functional as F

from .data import click_map, normalise
from .data_v1 import eval_items_v1, resize_t, interior
from .evaluate import iou

G = 256


def deepest_point(m):
    cur = np.pad(m, 1)
    while True:
        nxt = interior(cur, 2)
        if not nxt.any():
            break
        cur = nxt
    ys, xs = np.nonzero(cur)
    k = len(ys) // 2
    return float(ys[k] - 1), float(xs[k] - 1)


def error_click(pred, gt):
    fn, fp = gt & ~pred, pred & ~gt
    region, positive = (fn, True) if fn.sum() >= fp.sum() else (fp, False)
    if not region.any():
        return None
    return deepest_point(region), positive


class Runner:
    def __init__(self, ckpt=None, onnx=None, size=320, threads=None):
        self.size = size
        self.step = None
        if onnx:
            import onnxruntime as ort
            so = ort.SessionOptions(); so.intra_op_num_threads = threads or os.cpu_count() or 2
            self.sess = ort.InferenceSession(onnx, so, providers=["CPUExecutionProvider"]); self.model = None
        else:
            from .model_v1 import QuvSelectV1
            ck = torch.load(ckpt, map_location="cpu", weights_only=False)
            self.model = QuvSelectV1(pretrained=False).eval(); self.model.load_state_dict(ck["ema"]); self.step = ck["step"]

    def __call__(self, img, pos, neg, prev):
        S = self.size
        im = resize_t(img.astype(np.float32), (S, S), "bilinear").numpy().transpose(1, 2, 0)
        sc = S / G
        tr = lambda pts: [((y + 0.5) * sc - 0.5, (x + 0.5) * sc - 0.5) for y, x in pts]
        pv = np.zeros((S, S), np.float32) if prev is None else (resize_t(prev.astype(np.float32), (S, S), "bilinear").numpy()[0] > 0.5).astype(np.float32)
        x = np.concatenate([normalise(np.clip(im, 0, 255).astype(np.uint8)), click_map(S, S, tr(pos))[None], click_map(S, S, tr(neg))[None], pv[None]], 0)[None].astype(np.float32)
        if self.model is None:
            lg = self.sess.run(None, {"input": x})[0]
        else:
            with torch.no_grad():
                lg = self.model(torch.from_numpy(x)).numpy()
        lg = F.interpolate(torch.from_numpy(lg), size=(G, G), mode="bilinear", align_corners=False)[0, 0].numpy()
        return lg > 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default=None)
    ap.add_argument("--onnx", default=None)
    ap.add_argument("--size", type=int, default=320)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-click", action="store_true")
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    torch.set_num_threads(os.cpu_count() or 2)
    run = Runner(a.ckpt, a.onnx, a.size)
    subj, click = eval_items_v1()
    if a.limit:
        subj, click = subj[: a.limit], click[: a.limit]
    t0 = time.time()
    box = np.zeros((G, G), bool); box[G // 4: 3 * G // 4, G // 4: 3 * G // 4] = True
    s_iou, base, ids = [], [], []
    for iid, img, gt in subj:
        s_iou.append(iou(run(img, [], [], None), gt)); base.append(iou(box, gt)); ids.append(iid)
    c1, c3 = [], []
    for iid, img, gt in ([] if a.no_click else click):
        pos, neg = [deepest_point(gt)], []
        p = run(img, pos, neg, None); c1.append(iou(p, gt))
        for _ in range(2):
            e = error_click(p, gt)
            if e is None:
                break
            pt, positive = e
            (pos if positive else neg).append(pt)
            p = run(img, pos, neg, p)
        c3.append(iou(p, gt))
    m = lambda v: round(float(np.mean(v)), 4) if len(v) else None
    res = {"model": a.onnx or a.ckpt, "checkpoint_step": run.step, "input_size": a.size,
           "n_subject": len(s_iou), "subject_mIoU": m(s_iou), "subject_median_IoU": round(float(np.median(s_iou)), 4),
           "subject_IoU_ge_0.8_frac": m(np.array(s_iou) >= 0.8), "centre_box_baseline_mIoU": m(base),
           "n_click": len(c1), "click1_mIoU": m(c1), "click3_mIoU": m(c3),
           "click3_IoU_ge_0.8_frac": m(np.array(c3) >= 0.8) if c3 else None, "seconds": round(time.time() - t0, 1)}
    print(json.dumps(res))
    if a.json:
        res["per_item"] = {"subject_ids": ids, "subject": s_iou, "click1": c1, "click3": c3}
        json.dump(res, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()
