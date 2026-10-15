"""Held-out evaluation of a QuvSelect checkpoint or ONNX model.

Test split = Open Images V5 validation images whose sha1(ImageID) % 100 < 7 (never seen in training).
Metrics (all at 256x256, threshold 0.5):
  * subject mIoU      - zero prompts vs the derived subject mask
  * click@1 mIoU      - one positive click at the instance's most interior pixel
  * click@3 mIoU      - two further corrective clicks, each placed at the centre of the largest error region
                        (positive if missed foreground, negative if false positive), RITM/NoC style,
                        feeding the previous prediction back as the prev-mask channel
Baselines for context: "centre box" subject baseline (central 50% box) and the magic-wand-free trivial baseline.

    python -m quvrelo_ml.evaluate --ckpt ml/checkpoints/last.pt [--limit 300] [--json out.json]
"""
import argparse, json, os, time

import numpy as np
import torch
import torch.nn.functional as F

from .data import click_map, normalise, eval_items, interior
from .model import QuvSelect


def iou(a, b):
    u = (a | b).sum()
    return 1.0 if u == 0 else float((a & b).sum() / u)


def deepest_point(m):
    """most interior pixel via repeated erosion (image border counts as outside)"""
    cur = np.pad(m, 1)
    while True:
        nxt = interior(cur, 2)
        if not nxt.any():
            break
        cur = nxt
    ys, xs = np.nonzero(cur)
    k = len(ys) // 2
    return float(ys[k] - 1), float(xs[k] - 1)


def build(img, pos, neg, prev):
    H, W = img.shape[:2]
    pv = prev.astype(np.float32) if prev is not None else np.zeros((H, W), np.float32)
    x = np.concatenate([normalise(img), click_map(H, W, pos)[None], click_map(H, W, neg)[None], pv[None]], 0)
    return x[None].astype(np.float32)


class Runner:
    def __init__(self, ckpt=None, onnx=None, use_ema=True):
        if onnx:
            import onnxruntime as ort
            self.sess = ort.InferenceSession(onnx, providers=["CPUExecutionProvider"])
            self.model = None
        else:
            ck = torch.load(ckpt, map_location="cpu", weights_only=False)
            self.model = QuvSelect().eval()
            self.model.load_state_dict(ck["ema" if use_ema else "model"])
            self.step = ck.get("step")

    def __call__(self, x):
        if self.model is None:
            return self.sess.run(None, {"input": x})[0][0, 0]
        with torch.no_grad():
            return self.model(torch.from_numpy(x))[0, 0].numpy()


def error_click(pred, gt):
    fn, fp = gt & ~pred, pred & ~gt
    region, positive = (fn, True) if fn.sum() >= fp.sum() else (fp, False)
    if not region.any():
        return None
    return deepest_point(region), positive


def merge(paths, out):
    agg = {"subject": [], "click1": [], "click3": [], "box": []}
    step = None
    for p in paths:
        r = json.load(open(p)); step = r.get("checkpoint_step")
        for k in agg:
            agg[k] += r["per_item"][k]
    res = {"checkpoint_step": step, "n_subject": len(agg["subject"]), "subject_mIoU": round(float(np.mean(agg["subject"])), 4),
           "centre_box_baseline_mIoU": round(float(np.mean(agg["box"])), 4), "n_click": len(agg["click1"]),
           "click1_mIoU": round(float(np.mean(agg["click1"])), 4), "click3_mIoU": round(float(np.mean(agg["click3"])), 4),
           "subject_IoU_ge_0.8_frac": round(float(np.mean(np.array(agg["subject"]) >= 0.8)), 4),
           "click3_IoU_ge_0.8_frac": round(float(np.mean(np.array(agg["click3"]) >= 0.8)), 4)}
    print(json.dumps(res))
    if out:
        json.dump(res, open(out, "w"), indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default=os.path.join(os.path.dirname(__file__), "..", "checkpoints", "last.pt"))
    ap.add_argument("--onnx", default=None)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--shard", default="0/1", help="i/n: evaluate every n-th item starting at i (merge with --merge)")
    ap.add_argument("--merge", nargs="*", default=None, help="merge per-shard --json outputs")
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    if a.merge:
        return merge(a.merge, a.json)
    torch.set_num_threads(os.cpu_count() or 2)
    run = Runner(a.ckpt, a.onnx)
    subj, click = eval_items()
    if a.limit:
        subj, click = subj[: a.limit], click[: a.limit]
    si, sn = map(int, a.shard.split("/"))
    subj, click = subj[si::sn], click[si::sn]
    t0 = time.time()
    s_iou, base = [], []
    S = 256
    box = np.zeros((S, S), bool); box[S // 4: 3 * S // 4, S // 4: 3 * S // 4] = True
    for img, gt in subj:
        p = run(build(img, [], [], None)) > 0
        s_iou.append(iou(p, gt)); base.append(iou(box, gt))
    c1, c3 = [], []
    for img, gt in click:
        pos, neg = [deepest_point(gt)], []
        logit = run(build(img, pos, neg, None)); p = logit > 0
        c1.append(iou(p, gt))
        for _ in range(2):
            e = error_click(p, gt)
            if e is None:
                break
            (pt, positive) = e
            (pos if positive else neg).append(pt)
            logit = run(build(img, pos, neg, p)); p = logit > 0
        c3.append(iou(p, gt))
    res = {
        "checkpoint_step": getattr(run, "step", None),
        "n_subject": len(s_iou), "subject_mIoU": round(float(np.mean(s_iou)), 4),
        "centre_box_baseline_mIoU": round(float(np.mean(base)), 4),
        "n_click": len(c1), "click1_mIoU": round(float(np.mean(c1)), 4), "click3_mIoU": round(float(np.mean(c3)), 4),
        "seconds": round(time.time() - t0, 1),
        "per_item": {"subject": s_iou, "click1": c1, "click3": c3, "box": base},
    }
    print(json.dumps({k: v for k, v in res.items() if k != "per_item"}))
    if a.json:
        json.dump(res, open(a.json, "w"), indent=2)


if __name__ == "__main__":
    main()
