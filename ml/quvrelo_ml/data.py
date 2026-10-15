"""Training samples for QuvSelect, built from the packed Open Images subset.

Two kinds of sample, mixed per batch:
  * subject  - prompt channels are zero; target = the image's main subject(s): the union of annotated
               instances whose area is >= 25% of the largest instance (largest must cover >= 4% of the image).
               With probability `p_paste` we instead copy-paste an instance cutout from another training image
               onto a blurred version of this image ("portrait mode" composite): target = the pasted cutout.
  * click    - target = one random instance; positive clicks sampled inside it, negative clicks outside
               (biased to near the boundary and to other instances); optionally a corrupted previous mask.

The click encoding MUST match src/core/ml/clickMaps.ts:
    value(x, y) = max_k exp(-d_k^2 / (2 sigma^2)),  sigma = CLICK_SIGMA_FRAC * max(H, W)
"""
import json, os
import numpy as np
import torch
import torch.nn.functional as F

CLICK_SIGMA_FRAC = 0.02
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)
PACKED = os.environ.get("QUV_PACKED", os.path.join(os.path.dirname(__file__), "..", "data", "packed"))


def click_map(h, w, pts):
    """pts: list of (y, x) in pixels -> float32 [h, w]"""
    m = np.zeros((h, w), np.float32)
    if not pts:
        return m
    s = CLICK_SIGMA_FRAC * max(h, w)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    for y, x in pts:
        m = np.maximum(m, np.exp(-((yy - y) ** 2 + (xx - x) ** 2) / (2 * s * s)))
    return m


def normalise(img_u8):
    return ((img_u8.astype(np.float32) / 255.0 - MEAN) / STD).transpose(2, 0, 1)


class _Images:
    """JPEG blobs decoded on demand (keeps the whole training set in ~180 MB of RAM)"""

    def __init__(self, blob, off):
        self.blob, self.off = blob, off

    def __len__(self):
        return len(self.off) - 1

    def __getitem__(self, r):
        from PIL import Image
        import io
        return np.asarray(Image.open(io.BytesIO(self.blob[self.off[r]:self.off[r + 1]])).convert("RGB"))


class _Masks:
    """bit-packed masks; indexing returns uint8 0/255 like the unpacked array would"""

    def __init__(self, bits):
        self.bits = bits

    def __getitem__(self, k):
        return np.unpackbits(self.bits[k], axis=-1) * np.uint8(255)


def load_packed(size=256):
    blob = open(os.path.join(PACKED, f"images_{size}.bin"), "rb").read()
    off = np.load(os.path.join(PACKED, f"images_{size}_off.npy"))
    bits = np.load(os.path.join(PACKED, f"masks_{size}_bits.npy"))
    index = json.load(open(os.path.join(PACKED, f"index_{size}.json")))
    return _Images(blob, off), _Masks(bits), index


def subject_target(masks, e):
    ms = masks[e["m0"]:e["m1"]] > 0
    areas = ms.reshape(len(ms), -1).mean(1)
    if areas.max() < 0.04:
        return None
    keep = areas >= 0.25 * areas.max()
    return ms[keep].any(0)


def _box_blur(img, k):
    t = torch.from_numpy(np.ascontiguousarray(img)).float().permute(2, 0, 1)[None]
    t = F.avg_pool2d(F.pad(t, (k // 2,) * 4, mode="replicate"), k, 1)
    return t[0].permute(1, 2, 0).numpy()


def sample_points(rng, region, n):
    ys, xs = np.nonzero(region)
    if len(ys) == 0 or n == 0:
        return []
    idx = rng.choice(len(ys), size=min(n, len(ys)), replace=False)
    return [(float(ys[i]), float(xs[i])) for i in idx]


def interior(mask, r):
    """erode by r px (cheap, via max-pool on the inverse)"""
    t = torch.from_numpy((~mask).astype(np.float32))[None, None]
    t = F.max_pool2d(t, 2 * r + 1, 1, r)
    return t[0, 0].numpy() < 0.5


def dilate(mask, r):
    t = torch.from_numpy(mask.astype(np.float32))[None, None]
    return F.max_pool2d(t, 2 * r + 1, 1, r)[0, 0].numpy() > 0.5


def corrupt_prev(rng, gt):
    """simulate an imperfect previous prediction"""
    r = int(rng.integers(2, 12))
    m = dilate(gt, r) if rng.random() < 0.5 else interior(gt, r)
    if rng.random() < 0.5:  # drop or add a blob
        h, w = gt.shape
        cy, cx, rr = rng.integers(0, h), rng.integers(0, w), rng.integers(8, 40)
        yy, xx = np.ogrid[:h, :w]
        blob = (yy - cy) ** 2 + (xx - cx) ** 2 < rr * rr
        m = m & ~blob if rng.random() < 0.5 else m | blob
    return m


class Sampler:
    def __init__(self, split="train", size=256, crop=224, seed=0, p_click=0.5, p_paste=0.3):
        self.imgs, self.masks, index = load_packed(size)
        self._index = index
        self.entries = [e for e in index if e["split"] == split]
        self.subj = [(e, None) for e in self.entries]
        self.size, self.crop, self.p_click, self.p_paste = size, crop, p_click, p_paste
        self.rng = np.random.default_rng(seed)
        # big-enough instances for copy-paste donors
        self.donors = []
        for e in self.entries:
            for k in range(e["m0"], e["m1"]):
                self.donors.append(k)
        self.donor_img = {}
        for e in self.entries:
            for k in range(e["m0"], e["m1"]):
                self.donor_img[k] = e

    def _paste(self, img):
        rng = self.rng
        for _ in range(20):
            k = int(rng.choice(self.donors))
            m = self.masks[k] > 0
            a = m.mean()
            if 0.05 < a < 0.6:
                break
        else:
            return None
        src = np.asarray(self.imgs[self.imgs_index(k)])
        bg = _box_blur(img, int(rng.choice([9, 15, 21]))) * rng.uniform(0.6, 1.1)
        # random shift of the donor
        S = self.size
        ys, xs = np.nonzero(m)
        dy = int(rng.integers(-ys.min(), S - ys.max())) if ys.max() - ys.min() < S - 1 else 0
        dx = int(rng.integers(-xs.min(), S - xs.max())) if xs.max() - xs.min() < S - 1 else 0
        m2 = np.roll(np.roll(m, dy, 0), dx, 1)
        s2 = np.roll(np.roll(src, dy, 0), dx, 1)
        soft = _box_blur(m2[..., None].astype(np.float32), 3)
        out = s2 * soft + bg * (1 - soft)
        return np.clip(out, 0, 255).astype(np.uint8), m2

    def imgs_index(self, k):
        return self._row_of[self.donor_img[k]["id"]]

    def prepare(self):
        index = self._index
        self._row_of = {e["id"]: r for r, e in enumerate(index)}
        self._erow = [self._row_of[e["id"]] for e in self.entries]
        return self

    def one(self, j=None):
        rng = self.rng
        while True:
            j = int(rng.integers(len(self.entries))) if j is None else j
            e = self.entries[j]
            img = np.asarray(self.imgs[self._erow[j]])
            click = rng.random() < self.p_click
            pos, neg, prev = [], [], None
            if not click:
                if rng.random() < self.p_paste:
                    r = self._paste(img)
                    if r is None:
                        j = None; continue
                    img, gt = r
                else:
                    gt = subject_target(self.masks, e)
                    if gt is None:
                        j = None; continue
            else:
                ms = self.masks[e["m0"]:e["m1"]] > 0
                areas = ms.reshape(len(ms), -1).mean(1)
                ok = np.nonzero(areas > 0.002)[0]
                if len(ok) == 0:
                    j = None; continue
                k = int(rng.choice(ok))
                gt = ms[k]
                inner = interior(gt, 3)
                if not inner.any():
                    inner = gt
                pos = sample_points(rng, inner, int(rng.integers(1, 4)))
                nneg = int(rng.choice([0, 0, 1, 2, 3]))
                if nneg:
                    others = ms[np.arange(len(ms)) != k].any(0) & ~gt if len(ms) > 1 else np.zeros_like(gt)
                    ring = dilate(gt, 20) & ~dilate(gt, 4)
                    region = others if (others.any() and rng.random() < 0.5) else ring
                    if not region.any():
                        region = ~dilate(gt, 4)
                    neg = sample_points(rng, region, nneg)
                if rng.random() < 0.3:
                    prev = corrupt_prev(rng, gt)
            break
        return self._finish(img, gt, pos, neg, prev)

    def _finish(self, img, gt, pos, neg, prev):
        rng, S, C = self.rng, self.size, self.crop
        H = W = S
        pm, nm = click_map(H, W, pos), click_map(H, W, neg)
        pv = prev.astype(np.float32) if prev is not None else np.zeros((H, W), np.float32)
        x = np.concatenate([normalise(img), pm[None], nm[None], pv[None]], 0)
        y = gt.astype(np.float32)[None]
        if C < S:  # random crop
            oy, ox = rng.integers(0, S - C + 1, 2)
            x, y = x[:, oy:oy + C, ox:ox + C], y[:, oy:oy + C, ox:ox + C]
        if rng.random() < 0.5:
            x, y = x[:, :, ::-1], y[:, :, ::-1]
        # photometric jitter on RGB
        x = x.copy()
        x[:3] = x[:3] * rng.uniform(0.8, 1.2) + rng.uniform(-0.2, 0.2)
        return x, y.copy()

    def batch(self, n):
        xs, ys = zip(*(self.one() for _ in range(n)))
        return torch.from_numpy(np.stack(xs)), torch.from_numpy(np.stack(ys))


def eval_items(split="test", size=256, seed=123):
    """Deterministic eval set: for every test image, one subject item (if it has a subject) and one
    single-click item on a random instance (click at the instance's most interior point)."""
    imgs, masks, index = load_packed(size)
    row_of = {e["id"]: r for r, e in enumerate(index)}
    rng = np.random.default_rng(seed)
    subj, click = [], []
    for e in index:
        if e["split"] != split:
            continue
        img = np.asarray(imgs[row_of[e["id"]]])
        gt = subject_target(masks, e)
        if gt is not None:
            subj.append((img, gt))
        ms = masks[e["m0"]:e["m1"]] > 0
        areas = ms.reshape(len(ms), -1).mean(1)
        ok = np.nonzero(areas > 0.01)[0]
        if len(ok):
            k = int(rng.choice(ok))
            click.append((img, ms[k]))
    return subj, click
