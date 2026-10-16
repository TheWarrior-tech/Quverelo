"""Training / eval samples for QuvSelect v1 from ml/data/packed_v1 (see scripts/build_dataset_v1.py).

Sample kinds (same definitions as v0, see data.py, plus random-resized crops):
  * subject  (p = 1 - p_click): zero prompts; target = union of instances with area >= 25 % of the largest (largest
             must cover >= 4 % of the image). With p_paste the target is instead a CC BY instance cut-out pasted onto
             a blurred, darkened copy of the image.
  * click    : one random instance, 1-3 positive clicks inside, 0-3 negatives (other instances / a ring), optionally
             a corrupted previous mask.
Click maps are computed *after* cropping at the network input size, so sigma = 0.02 * max(H, W) of the model input,
exactly what src/core/ml/clickMaps.ts does in the app.
"""
import io, json, os

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

from . import data as _d
from .data import click_map, normalise, subject_target, sample_points


def _sep_max(t, r):
    """separable (2r+1)^2 max filter: same result as max_pool2d(t, 2r+1, 1, r), ~r x faster"""
    t = F.max_pool2d(t, (2 * r + 1, 1), 1, (r, 0))
    return F.max_pool2d(t, (1, 2 * r + 1), 1, (0, r))


def dilate(mask, r):
    return _sep_max(torch.from_numpy(mask.astype(np.float32))[None, None], r)[0, 0].numpy() > 0.5


def interior(mask, r):
    return _sep_max(torch.from_numpy((~mask).astype(np.float32))[None, None], r)[0, 0].numpy() < 0.5


def _box_blur(img, k):
    t = torch.from_numpy(np.ascontiguousarray(img)).float().permute(2, 0, 1)[None]
    t = F.pad(t, (k // 2,) * 4, mode="replicate")
    t = F.avg_pool2d(F.avg_pool2d(t, (k, 1), 1), (1, k), 1)
    return t[0].permute(1, 2, 0).numpy()


# the v0 helpers call data.dilate / data.interior internally (corrupt_prev): point them at the fast versions
_d.dilate, _d.interior = dilate, interior
corrupt_prev = _d.corrupt_prev

PACKED = os.environ.get("QUV_PACKED_V1", os.path.join(os.path.dirname(__file__), "..", "data", "packed_v1"))


class Blobs:
    def __init__(self, path, off):
        self.blob = open(path, "rb").read()
        self.off = np.load(off)

    def raw(self, r):
        return self.blob[self.off[r]:self.off[r + 1]]


class Pack:
    def __init__(self, size=320):
        self.size = size
        self.im = Blobs(os.path.join(PACKED, f"images_{size}.bin"), os.path.join(PACKED, f"images_{size}_off.npy"))
        self.mk = Blobs(os.path.join(PACKED, f"masks_{size}.bin"), os.path.join(PACKED, f"masks_{size}_off.npy"))
        self.index = json.load(open(os.path.join(PACKED, f"index_{size}.json")))

    def image(self, r):
        return np.asarray(Image.open(io.BytesIO(self.im.raw(r))).convert("RGB"))

    def masks(self, e):
        return np.stack([np.asarray(Image.open(io.BytesIO(self.mk.raw(k)))) > 0 for k in range(e["m0"], e["m1"])])


def resize_t(a, size, mode):
    t = torch.from_numpy(np.ascontiguousarray(a)).float()
    t = t[None, None] if t.ndim == 2 else t.permute(2, 0, 1)[None]
    kw = {"align_corners": False, "antialias": True} if mode == "bilinear" else {}
    return F.interpolate(t, size=size, mode=mode, **kw)[0]


class SamplerV1:
    def __init__(self, split="train", size=320, crop=224, seed=0, p_click=0.5, p_paste=0.25, pack=None):
        self.pack = pack or Pack(size)
        self.rows = [r for r, e in enumerate(self.pack.index) if e["split"] == split]
        self.size, self.crop, self.p_click, self.p_paste = size, crop, p_click, p_paste
        self.rng = np.random.default_rng(seed)

    def _paste(self, img):
        rng = self.rng
        for _ in range(20):
            r = self.rows[int(rng.integers(len(self.rows)))]
            e = self.pack.index[r]
            ms = self.pack.masks(e)
            k = int(rng.integers(len(ms)))
            m = ms[k]
            if 0.05 < m.mean() < 0.6:
                break
        else:
            return None
        src = self.pack.image(r).astype(np.float32)
        bg = _box_blur(img, int(rng.choice([9, 15, 21]))) * rng.uniform(0.6, 1.1)
        S = self.size
        ys, xs = np.nonzero(m)
        dy = int(rng.integers(-ys.min(), S - ys.max())) if ys.max() - ys.min() < S - 1 else 0
        dx = int(rng.integers(-xs.min(), S - xs.max())) if xs.max() - xs.min() < S - 1 else 0
        m2 = np.roll(np.roll(m, dy, 0), dx, 1)
        s2 = np.roll(np.roll(src, dy, 0), dx, 1)
        soft = _box_blur(m2[..., None].astype(np.float32), 3)
        return np.clip(s2 * soft + bg * (1 - soft), 0, 255).astype(np.uint8), m2

    def one(self):
        rng = self.rng
        while True:
            r = self.rows[int(rng.integers(len(self.rows)))]
            e = self.pack.index[r]
            img = self.pack.image(r)
            pos, neg, prev = [], [], None
            click = rng.random() < self.p_click
            if not click:
                if rng.random() < self.p_paste:
                    out = self._paste(img)
                    if out is None:
                        continue
                    img, gt = out
                else:
                    gt = subject_target(self.pack.masks(e), {"m0": 0, "m1": e["m1"] - e["m0"]})
                    if gt is None:
                        continue
            else:
                ms = self.pack.masks(e)
                areas = ms.reshape(len(ms), -1).mean(1)
                ok = np.nonzero(areas > 0.002)[0]
                if len(ok) == 0:
                    continue
                k = int(rng.choice(ok))
                gt = ms[k]
                inner = interior(gt, 3)
                pos = sample_points(rng, inner if inner.any() else gt, int(rng.integers(1, 4)))
                nneg = int(rng.choice([0, 0, 1, 2, 3]))
                if nneg:
                    others = ms[np.arange(len(ms)) != k].any(0) & ~gt if len(ms) > 1 else np.zeros_like(gt)
                    ring = dilate(gt, 24) & ~dilate(gt, 5)
                    region = others if (others.any() and rng.random() < 0.5) else ring
                    if not region.any():
                        region = ~dilate(gt, 5)
                    neg = sample_points(rng, region, nneg)
                if rng.random() < 0.3:
                    prev = corrupt_prev(rng, gt)
            return self._finish(img, gt, pos, neg, prev, click)

    def _finish(self, img, gt, pos, neg, prev, click):
        rng, S, C = self.rng, self.size, self.crop
        # random-resized crop. Subject samples see the whole frame half the time (that is what the app sends).
        if not click and rng.random() < 0.5:
            y0 = x0 = 0; ch = cw = S
        else:
            lo = 0.75 if not click else 0.45
            ch = int(S * rng.uniform(lo, 1)); cw = int(np.clip(ch * rng.uniform(0.8, 1.25), S * lo, S))
            y0 = int(rng.integers(0, S - ch + 1)); x0 = int(rng.integers(0, S - cw + 1))
            if click and pos:  # keep the first positive click inside the crop
                py, px = pos[0]
                y0 = int(np.clip(y0, py - ch + 2, py - 1)); y0 = int(np.clip(y0, 0, S - ch))
                x0 = int(np.clip(x0, px - cw + 2, px - 1)); x0 = int(np.clip(x0, 0, S - cw))
        sy, sx = C / ch, C / cw
        tr = lambda pts: [((y - y0 + 0.5) * sy - 0.5, (x - x0 + 0.5) * sx - 0.5) for y, x in pts
                          if y0 <= y < y0 + ch and x0 <= x < x0 + cw]
        pos, neg = tr(pos), tr(neg)
        im = resize_t(img[y0:y0 + ch, x0:x0 + cw].astype(np.float32), (C, C), "bilinear").numpy()
        y = (resize_t(gt[y0:y0 + ch, x0:x0 + cw].astype(np.float32), (C, C), "bilinear").numpy() > 0.5).astype(np.float32)
        pv = np.zeros((1, C, C), np.float32) if prev is None else \
            (resize_t(prev[y0:y0 + ch, x0:x0 + cw].astype(np.float32), (C, C), "bilinear").numpy() > 0.5).astype(np.float32)
        rgb = normalise(np.clip(im.transpose(1, 2, 0), 0, 255).astype(np.uint8))
        x = np.concatenate([rgb, click_map(C, C, pos)[None], click_map(C, C, neg)[None], pv], 0)
        if rng.random() < 0.5:
            x, y = x[:, :, ::-1], y[:, :, ::-1]
        x = x.copy()
        x[:3] = x[:3] * rng.uniform(0.8, 1.2) + rng.uniform(-0.2, 0.2)
        return x, y.copy()

    def batch(self, n):
        xs, ys = zip(*(self.one() for _ in range(n)))
        return torch.from_numpy(np.stack(xs)), torch.from_numpy(np.stack(ys))


def eval_items_v1(split="test", size=320, seed=123, pack=None, gt_size=256):
    """Deterministic held-out items: per test image one subject item (if it has a subject) and one single-click item
    (an instance covering > 1 % of the image). Image at pack resolution, GT at gt_size (256, as v0's eval)."""
    pack = pack or Pack(size)
    rng = np.random.default_rng(seed)
    subj, click = [], []
    for r, e in enumerate(pack.index):
        if e["split"] != split:
            continue
        img = pack.image(r)
        ms = pack.masks(e)
        ms = (resize_t(ms.astype(np.float32).transpose(1, 2, 0), (gt_size, gt_size), "bilinear").numpy() > 0.5)
        gt = subject_target(ms, {"m0": 0, "m1": len(ms)})
        if gt is not None:
            subj.append((e["id"], img, gt))
        areas = ms.reshape(len(ms), -1).mean(1)
        ok = np.nonzero(areas > 0.01)[0]
        if len(ok):
            k = int(rng.choice(ok))
            click.append((e["id"], img, ms[k]))
    return subj, click
