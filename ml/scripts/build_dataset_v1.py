"""Pack the v1 Open Images subset (V5 validation + test segmentation, all CC BY 2.0 images) for CPU training.

Output in ml/data/packed_v1/ (gitignored, ~1 GB):
  images_<S>.bin + images_<S>_off.npy   JPEG-q93 bytes of each image squash-resized to S x S
  masks_<S>.bin  + masks_<S>_off.npy    PNG (1-bit) bytes of each instance mask at S x S
  index_<S>.json                        per image: id, source split, train/test, mask row range, labels

Held-out test = Open Images *validation* images with sha1(ImageID) % 100 < 7 (the same rule as v0, so the
v0 test images are a subset of the v1 test images). Every Open Images *test*-split image is used for training.

    python ml/scripts/build_dataset_v1.py --size 320 [--workers 2]     # resumable (2,000-image parts); re-run after a reset
"""
import argparse, csv, hashlib, io, json, os, time, zipfile
from multiprocessing import Pool

import numpy as np
from PIL import Image

HERE = os.path.dirname(__file__)
OI = os.path.join(HERE, "..", "data", "openimages")
OUT = os.path.join(HERE, "..", "data", "packed_v1")
ZIPS = {"val": "validation", "test": "test"}


def split_of(image_id: str, source: str) -> str:
    if source != "val":
        return "train"
    h = int(hashlib.sha1(image_id.encode()).hexdigest()[:8], 16)
    return "test" if h % 100 < 7 else "train"


_Z = {}
_S = 320


def _zip(source, h):
    k = (source, h)
    if k not in _Z:
        _Z[k] = zipfile.ZipFile(os.path.join(OI, f"{ZIPS[source]}-masks-{h}.zip"))
    return _Z[k]


def _one(job):
    source, iid, masks = job
    S = _S
    p = os.path.join(OI, "images", source, iid + ".jpg")
    try:
        im = Image.open(p).convert("RGB").resize((S, S), Image.BILINEAR)
    except Exception:
        return None
    b = io.BytesIO(); im.save(b, "JPEG", quality=93)
    out, labs = [], []
    for mp, lab in masks:
        try:
            m = Image.open(io.BytesIO(_zip(source, mp[0]).read(mp))).convert("L").resize((S, S), Image.BILINEAR)
        except KeyError:
            continue
        a = np.asarray(m) > 127
        if a.sum() < 4:
            continue
        mb = io.BytesIO(); Image.fromarray(a).convert("1").save(mb, "PNG", optimize=False)
        out.append(mb.getvalue()); labs.append(lab)
    if not out:
        return None
    return source, iid, b.getvalue(), out, labs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=320)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--limit", type=int, default=0, help="first N images per source (smoke tests)")
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args()
    global _S
    _S = a.size
    t0 = time.time()
    jobs = []
    for source in ("val", "test"):
        have = {f[:-4] for f in os.listdir(os.path.join(OI, "images", source)) if f.endswith(".jpg")}
        per = {}
        with open(os.path.join(OI, f"{source}-seg.csv"), newline="") as f:
            for r in csv.DictReader(f):
                if r["ImageID"] in have:
                    per.setdefault(r["ImageID"], []).append((r["MaskPath"], r["LabelName"]))
        ids = sorted(per)[: a.limit] if a.limit else sorted(per)
        jobs += [(source, i, per[i]) for i in ids]
    print(len(jobs), "images", flush=True)
    OUTD = a.out
    S = a.size
    parts = os.path.join(OUTD, f"parts_{S}")
    os.makedirs(parts, exist_ok=True)
    CH = 2000  # resumable: each chunk of CH images is written as its own part, finished parts are skipped
    chunks = [jobs[i:i + CH] for i in range(0, len(jobs), CH)]
    with Pool(a.workers) as pool:
        for c, chunk in enumerate(chunks):
            done = os.path.join(parts, f"{c:03d}.json")
            if os.path.exists(done):
                continue
            fi = open(os.path.join(parts, f"{c:03d}.img"), "wb"); fm = open(os.path.join(parts, f"{c:03d}.msk"), "wb")
            ent = []
            for r in pool.imap(_one, chunk, chunksize=16):
                if r is None:
                    continue
                source, iid, jb, ms, labs = r
                fi.write(jb)
                for mb in ms:
                    fm.write(mb)
                ent.append({"id": iid, "source": source, "split": split_of(iid, source), "labels": labs,
                            "ilen": len(jb), "mlen": [len(mb) for mb in ms]})
            fi.close(); fm.close()
            json.dump(ent, open(done + ".tmp", "w")); os.replace(done + ".tmp", done)
            print(f"chunk {c + 1}/{len(chunks)} {round(time.time() - t0)} s", flush=True)
    # consolidate
    ioff, moff, index, row = [0], [0], [], 0
    with open(os.path.join(OUTD, f"images_{S}.bin"), "wb") as fi, open(os.path.join(OUTD, f"masks_{S}.bin"), "wb") as fm:
        for c in range(len(chunks)):
            fi.write(open(os.path.join(parts, f"{c:03d}.img"), "rb").read())
            fm.write(open(os.path.join(parts, f"{c:03d}.msk"), "rb").read())
            for e in json.load(open(os.path.join(parts, f"{c:03d}.json"))):
                ioff.append(ioff[-1] + e.pop("ilen"))
                ml = e.pop("mlen")
                for n in ml:
                    moff.append(moff[-1] + n)
                e["m0"], e["m1"] = row, row + len(ml); row += len(ml)
                index.append(e)
    np.save(os.path.join(OUTD, f"images_{S}_off.npy"), np.array(ioff, np.int64))
    np.save(os.path.join(OUTD, f"masks_{S}_off.npy"), np.array(moff, np.int64))
    json.dump(index, open(os.path.join(OUTD, f"index_{S}.json"), "w"))
    nt = sum(e["split"] == "test" for e in index)
    print(f"done: {len(index)} images ({nt} test), {row} masks in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
