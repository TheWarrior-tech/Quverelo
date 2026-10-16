"""Resumable download of the Open Images V5 *validation* and *test* segmentation subsets (v1 data).

Every image in both subsets is CC BY 2.0 (checked per image against the `License` column, non-CC-BY images
are skipped). Masks + annotation CSVs are CC BY 4.0 (Google LLC). See ml/DATA_SOURCES.md.

Masks are kept inside their original zip files (no extraction of ~170k PNGs); build_dataset_v1.py reads them
straight from the zips. Images are downscaled to <= 512 px on the long side.

    python ml/scripts/fetch_openimages.py --splits val test --time-budget 100     # re-run until "done"
"""
import argparse, csv, io, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..", "data", "openimages")
GCS = "http://storage.googleapis.com/openimages"  # https returns 403 through some proxies; same objects
S3 = "https://s3.amazonaws.com/open-images-dataset/{split}/{id}.jpg"
SPLIT_DIR = {"val": "validation", "test": "test"}
META = {
    "val-seg.csv": f"{GCS}/v5/validation-annotations-object-segmentation.csv",
    "val-images.csv": f"{GCS}/2018_04/validation/validation-images-with-rotation.csv",
    "test-seg.csv": f"{GCS}/v5/test-annotations-object-segmentation.csv",
    "test-images.csv": f"{GCS}/2018_04/test/test-images-with-rotation.csv",
    "class-descriptions.csv": f"{GCS}/v5/class-descriptions-boxable.csv",
}
MAX_SIDE = 512
CC_BY_2 = "creativecommons.org/licenses/by/2.0"


def fetch(url, timeout=60):
    if url.startswith("http://"):  # Python's urllib gets 404 from GCS via some HTTP proxies; curl does not
        import subprocess
        return subprocess.run(["curl", "-sfL", "-m", str(timeout), url], check=True, capture_output=True).stdout
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read()


def save_atomic(path, data):
    tmp = path + ".part"
    open(tmp, "wb").write(data)
    os.replace(tmp, path)


def ensure_meta(splits):
    os.makedirs(ROOT, exist_ok=True)
    jobs = [(os.path.join(ROOT, n), u) for n, u in META.items()]
    for sp in splits:
        for h in "0123456789abcdef":
            name = f"{SPLIT_DIR[sp]}-masks-{h}.zip"
            jobs.append((os.path.join(ROOT, name), f"{GCS}/v5/{SPLIT_DIR[sp]}-masks/{name}"))
    jobs = [j for j in jobs if not os.path.exists(j[0])]
    with ThreadPoolExecutor(8) as ex:
        for f in [ex.submit(lambda p, u: save_atomic(p, fetch(u, 300)), p, u) for p, u in jobs]:
            f.result()


def selected_ids(sp):
    lic = {}
    with open(os.path.join(ROOT, f"{sp}-images.csv"), newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            lic[r["ImageID"]] = r["License"]
    with open(os.path.join(ROOT, f"{sp}-seg.csv"), newline="") as f:
        ids = {r["ImageID"] for r in csv.DictReader(f)}
    return sorted(i for i in ids if CC_BY_2 in lic.get(i, ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--splits", nargs="+", default=["val", "test"])
    ap.add_argument("--time-budget", type=float, default=100)
    ap.add_argument("--workers", type=int, default=48)
    a = ap.parse_args()
    t0 = time.time()
    ensure_meta(a.splits)
    left = 0
    for sp in a.splits:
        out = os.path.join(ROOT, "images", sp)
        os.makedirs(out, exist_ok=True)
        have = set(os.listdir(out))
        todo = [i for i in selected_ids(sp) if i + ".jpg" not in have]
        print(f"{sp}: {len(todo)} to fetch", flush=True)

        def one(i):
            im = Image.open(io.BytesIO(fetch(S3.format(split=SPLIT_DIR[sp], id=i)))).convert("RGB")
            im.thumbnail((MAX_SIDE, MAX_SIDE), Image.BILINEAR)
            b = io.BytesIO(); im.save(b, "JPEG", quality=92)
            save_atomic(os.path.join(out, i + ".jpg"), b.getvalue())

        done = 0
        with ThreadPoolExecutor(a.workers) as ex:
            it = iter(todo); futs = set()
            while True:
                while len(futs) < a.workers * 2 and time.time() - t0 < a.time_budget:
                    i = next(it, None)
                    if i is None:
                        break
                    futs.add(ex.submit(one, i))
                if not futs:
                    break
                f = next(as_completed(futs)); futs.remove(f)
                try:
                    f.result(); done += 1
                except Exception as e:  # transient: retried on the next run
                    print("err", e, file=sys.stderr)
        rest = len(todo) - done
        left += rest
        print(f"{sp}: fetched {done}, {rest} left", flush=True)
        if time.time() - t0 > a.time_budget:
            break
    print("done" if left == 0 and time.time() - t0 <= a.time_budget else "re-run")


if __name__ == "__main__":
    main()
