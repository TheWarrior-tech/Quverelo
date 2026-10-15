"""Download a resumable subset of the Open Images V5 *validation* split that has
instance segmentation masks, resizing everything to a small working resolution.

Sources (see ml/DATA_SOURCES.md):
  * images:      CC BY 2.0 (per-image licence column in validation-images-with-rotation.csv)
  * annotations: CC BY 4.0 (Google LLC, Open Images V5 segmentation masks)

Usage:  python ml/scripts/download_openimages.py --max-images 4000 --time-budget 100
Re-run until it reports "done"; already-downloaded images are skipped.
"""
import argparse, csv, io, os, sys, time, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..", "data", "openimages")
GCS = "http://storage.googleapis.com/openimages"   # https is blocked by some proxies; content is the same
S3 = "https://s3.amazonaws.com/open-images-dataset/validation/{}.jpg"
META = {
    "val-seg.csv": f"{GCS}/v5/validation-annotations-object-segmentation.csv",
    "val-images.csv": f"{GCS}/2018_04/validation/validation-images-with-rotation.csv",
    "class-descriptions.csv": f"{GCS}/v5/class-descriptions-boxable.csv",
}
MAX_SIDE = 384


def fetch(url, timeout=60):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read()


def ensure_meta():
    os.makedirs(ROOT, exist_ok=True)
    for name, url in META.items():
        p = os.path.join(ROOT, name)
        if not os.path.exists(p):
            open(p, "wb").write(fetch(url, 300))
    mdir = os.path.join(ROOT, "masks")
    if not os.path.isdir(mdir) or len(os.listdir(mdir)) < 20000:
        os.makedirs(mdir, exist_ok=True)
        for h in "0123456789abcdef":
            z = fetch(f"{GCS}/v5/validation-masks/validation-masks-{h}.zip", 300)
            zipfile.ZipFile(io.BytesIO(z)).extractall(mdir)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-images", type=int, default=4000)
    ap.add_argument("--time-budget", type=float, default=100)
    ap.add_argument("--workers", type=int, default=24)
    a = ap.parse_args()
    t0 = time.time()
    ensure_meta()
    lic = {}
    with open(os.path.join(ROOT, "val-images.csv"), newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            lic[r["ImageID"]] = r
    ids = []
    with open(os.path.join(ROOT, "val-seg.csv"), newline="") as f:
        for r in csv.DictReader(f):
            if r["ImageID"] not in ids[-1:]:
                ids.append(r["ImageID"])
    ids = sorted(set(i for i in ids if "creativecommons.org/licenses/by/2.0" in lic.get(i, {}).get("License", "")))
    ids = ids[: a.max_images]
    out = os.path.join(ROOT, "images")
    os.makedirs(out, exist_ok=True)
    todo = [i for i in ids if not os.path.exists(os.path.join(out, i + ".jpg"))]
    print(f"{len(ids)} selected, {len(todo)} to fetch")

    def one(i):
        data = fetch(S3.format(i))
        im = Image.open(io.BytesIO(data)).convert("RGB")
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.BILINEAR)
        tmp = os.path.join(out, i + ".tmp.jpg")
        im.save(tmp, quality=92)
        os.replace(tmp, os.path.join(out, i + ".jpg"))
        return i

    done = 0
    with ThreadPoolExecutor(a.workers) as ex:
        futs = [ex.submit(one, i) for i in todo]
        for fu in as_completed(futs):
            try:
                fu.result(); done += 1
            except Exception as e:  # network hiccup: retried on next run
                print("fail", e, file=sys.stderr)
            if time.time() - t0 > a.time_budget:
                print(f"time budget hit after {done}; re-run to continue")
                ex.shutdown(wait=False, cancel_futures=True)
                return
    # attribution manifest (CC BY 2.0 requires attribution)
    with open(os.path.join(ROOT, "ATTRIBUTION.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["ImageID", "Author", "OriginalLandingURL", "License"])
        for i in ids:
            r = lic[i]
            w.writerow([i, r["Author"], r["OriginalLandingURL"], r["License"]])
    print(f"done: fetched {done}")


if __name__ == "__main__":
    main()
