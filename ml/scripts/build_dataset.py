"""Pack the downloaded Open Images subset into fixed-size uint8 arrays for fast CPU training.

Output (ml/data/packed/):
  images.npy   uint8 [N,S,S,3]   (squash-resized to S x S, the same resize the app uses)
  masks.npy    uint8 [M,S,S]     instance masks (0/255)
  index.json   per image: id, split, mask row range, labels
Split: deterministic by ImageID hash -> ~7% held-out test ("test"), rest "train".

Usage: python ml/scripts/build_dataset.py --size 256 [--time-budget 100]   (resumable)
"""
import argparse, csv, hashlib, json, os, time
from multiprocessing import Pool
import numpy as np
from PIL import Image

_CTX = None
HERE = os.path.dirname(__file__)
OI = os.path.join(HERE, "..", "data", "openimages")
OUT = os.path.join(HERE, "..", "data", "packed")
# consolidated arrays can live on a fast local disk (QUV_PACKED); per-image parts stay under OUT
FINAL = os.environ.get("QUV_PACKED", OUT)


def split_of(image_id: str) -> str:
    h = int(hashlib.sha1(image_id.encode()).hexdigest()[:8], 16)
    return "test" if h % 100 < 7 else "train"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=256)
    ap.add_argument("--time-budget", type=float, default=100)
    a = ap.parse_args(); S = a.size; t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    have = {f[:-4] for f in os.listdir(os.path.join(OI, "images")) if f.endswith(".jpg") and ".tmp" not in f}
    per = {}
    with open(os.path.join(OI, "val-seg.csv"), newline="") as f:
        for r in csv.DictReader(f):
            if r["ImageID"] in have:
                per.setdefault(r["ImageID"], []).append((r["MaskPath"], r["LabelName"]))
    ids = sorted(per)
    part = os.path.join(OUT, f"part_{S}")
    os.makedirs(part, exist_ok=True)
    global _CTX
    _CTX = (S, part, per)
    todo = [i for i in ids if not os.path.exists(os.path.join(part, i + ".npz"))]
    if todo:
      with Pool(max(1, os.cpu_count() or 1)) as pool:
        for n, _ in enumerate(pool.imap_unordered(_pack_one, todo, chunksize=8)):
            if time.time() - t0 > a.time_budget:
                pool.terminate(); print(f"budget hit, {len(todo) - n} left; re-run"); return
    _consolidate(S, ids, part)


def _pack_one(i):
    S, part, per = _CTX
    p = os.path.join(part, i + ".npz")
    if True:
        im = Image.open(os.path.join(OI, "images", i + ".jpg")).convert("RGB").resize((S, S), Image.BILINEAR)
        ms, labs = [], []
        for mp, lab in per[i]:
            m = Image.open(os.path.join(OI, "masks", mp)).convert("L").resize((S, S), Image.BILINEAR)
            m = (np.asarray(m) > 127).astype(np.uint8) * 255
            if m.sum() == 0:
                continue
            ms.append(m); labs.append(lab)
        if not ms:
            ms = [np.zeros((S, S), np.uint8)]; labs = ["none"]
        tmp = p[:-4] + ".tmp.npz"
        np.savez(tmp, image=np.asarray(im), masks=np.stack(ms), labels=np.array(labs))
        os.replace(tmp, p)


def _consolidate(S, ids, part):
    """Compact, RAM-friendly pack: JPEG-q95 image bytes + bit-packed masks (~0.3 GB total)."""
    import io
    from concurrent.futures import ThreadPoolExecutor

    def load(i):
        z = np.load(os.path.join(part, i + ".npz"))
        return i, z["image"], z["masks"], z["labels"]

    blobs, offs, bits, index, row = [], [0], [], [], 0
    with ThreadPoolExecutor(16) as ex:  # IO-bound on network filesystems
        for i, img, ms, labs in ex.map(load, ids):
            if labs[0] == "none":
                continue
            b = io.BytesIO(); Image.fromarray(img).save(b, "JPEG", quality=95)
            blobs.append(b.getvalue()); offs.append(offs[-1] + len(blobs[-1]))
            bits.append(np.packbits(ms > 0, axis=-1)); k = len(ms)
            index.append({"id": i, "split": split_of(i), "m0": row, "m1": row + k, "labels": labs.tolist()})
            row += k
    os.makedirs(FINAL, exist_ok=True)
    with open(os.path.join(FINAL, f"images_{S}.bin"), "wb") as f:
        f.write(b"".join(blobs))
    np.save(os.path.join(FINAL, f"images_{S}_off.npy"), np.array(offs, np.int64))
    np.save(os.path.join(FINAL, f"masks_{S}_bits.npy"), np.concatenate(bits))
    json.dump(index, open(os.path.join(FINAL, f"index_{S}.json"), "w"))
    nt = sum(e["split"] == "test" for e in index)
    print(f"done: {len(index)} images ({nt} test), {row} masks")


if __name__ == "__main__":
    main()
