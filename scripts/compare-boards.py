#!/usr/bin/env python3
"""Compose side-by-side design comparison boards: Mobbin reference (left) vs a
Quvrelo capture (right), 2880 px wide, with an optional zoomed "detail" row.

Reference images are never committed (Mobbin licence). `--fetch` downloads
them from the Mobbin screen page's og:image into --refs (default
/workspace/work/refs-mobbin) and writes SOURCES-boards.md there.

Usage:
  python3 scripts/compare-boards.py --fetch                       # refs + light boards
  python3 scripts/compare-boards.py --theme dark --theme light    # several themes
  python3 scripts/compare-boards.py --only command-palette --captures /path/to/captures

Captures are looked up as <captures>/<theme>-<name>.png (e.g. light-palette.png).
Requires Pillow (pip install pillow) and curl for --fetch.
"""
import argparse, html, json, os, re, subprocess, sys, urllib.parse

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
W, M, G = 2880, 64, 64            # board width, outer margin, column gutter
COL = (W - 2 * M - G) // 2        # 1344 px per column
MAX_DETAIL_H = 1500
BG, INK, MUTED, RULE = (244, 244, 245), (24, 24, 27), (100, 100, 110), (212, 212, 216)
ACCENT_REF, ACCENT_Q = (79, 70, 229), (13, 128, 104)

FONT_DIRS = ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu",
             "/Library/Fonts", "C:/Windows/Fonts"]


def font(size, bold=False):
    names = (["Inter-Bold.ttf", "DejaVuSans-Bold.ttf", "Arial Bold.ttf", "arialbd.ttf"] if bold
             else ["Inter-Regular.ttf", "DejaVuSans.ttf", "Arial.ttf", "arial.ttf"])
    for d in FONT_DIRS:
        for n in names:
            p = os.path.join(d, n)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def mobbin_url(mid):
    return f"https://mobbin.com/explore/screens/{mid}"


def fetch_ref(mid, refs):
    """Download the full-res screen image behind a Mobbin screen page's og:image."""
    dst = os.path.join(refs, f"{mid}.png")
    if os.path.exists(dst) and os.path.getsize(dst) > 10_000:
        return dst, None
    page = subprocess.run(["curl", "-sL", "-A", "Mozilla/5.0 (compatible; Twitterbot/1.0)",
                           mobbin_url(mid)], capture_output=True, text=True).stdout
    m = re.search(r'og:image" content="([^"]+)"', page)
    if not m:
        print(f"  ! no og:image for {mid}", file=sys.stderr)
        return None, None
    q = urllib.parse.parse_qs(urllib.parse.urlparse(html.unescape(m.group(1))).query)
    screen = q.get("screenUrl", [None])[0]
    if not screen:
        return None, None
    img = re.sub(r"\?.*", "?f=png&w=2400&q=90", screen)
    subprocess.run(["curl", "-sL", img, "-o", dst], check=True)
    return dst, img


def fit(im, w, max_h=None):
    s = w / im.width
    if max_h and im.height * s > max_h:
        s = max_h / im.height
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)


def crop(im, box):
    x0, y0, x1, y1 = box
    return im.crop((round(x0 * im.width), round(y0 * im.height),
                    round(x1 * im.width), round(y1 * im.height)))


def clip(d, text, f, w):
    if d.textlength(text, font=f) <= w:
        return text
    while text and d.textlength(text + "…", font=f) > w:
        text = text[:-1]
    return text + "…"


def framed(board, im, x, y):
    d = ImageDraw.Draw(board)
    d.rectangle([x - 2, y - 2, x + im.width + 1, y + im.height + 1], outline=RULE, width=2)
    board.paste(im, (x, y))


def compose(b, ref_path, cap_path, theme, out):
    ref, cap = Image.open(ref_path).convert("RGB"), Image.open(cap_path).convert("RGB")
    rf, cf = fit(ref, COL), fit(cap, COL)
    detail = None
    if b.get("ref_crop") and b.get("quvrelo_crop"):
        rd, cd = crop(ref, b["ref_crop"]), crop(cap, b["quvrelo_crop"])
        if b.get("detail_independent"):
            # very different crop shapes (e.g. horizontal toolbar vs vertical rail):
            # fit each on its own, never upscaling more than 3x
            def own(im):
                s = min(COL / im.width, MAX_DETAIL_H / im.height, 3.0)
                return im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
            detail = (own(rd), own(cd))
        else:
            # give both details the same display height so sizes read comparably
            h = min(MAX_DETAIL_H, round(COL * rd.height / rd.width), round(COL * cd.height / cd.width))
            detail = (fit(rd, COL, h), fit(cd, COL, h))

    f_t, f_n, f_l, f_s = font(64, True), font(34), font(34, True), font(26)
    head_h, lab_h = 210, 70
    row1 = max(rf.height, cf.height)
    row2 = (lab_h + max(detail[0].height, detail[1].height) + 40) if detail else 0
    H = M + head_h + lab_h + row1 + 40 + row2 + 150
    board = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(board)

    d.text((M, M), b["title"], font=f_t, fill=INK)
    d.text((M, M + 92), b.get("note", ""), font=f_n, fill=MUTED)
    tag = f"{theme.upper()} THEME"
    tw = d.textlength(tag, font=f_l)
    d.text((W - M - tw, M + 14), tag, font=f_l, fill=MUTED)
    y = M + head_h
    d.line([M, y - 24, W - M, y - 24], fill=RULE, width=2)

    xl, xr = M, M + COL + G
    r = b["ref"]
    d.text((xl, y), clip(d, f"REFERENCE · {r['app']} — {r['screen']}", f_l, COL), font=f_l, fill=ACCENT_REF)
    d.text((xr, y), clip(d, f"QUVRELO · {os.path.basename(cap_path)}", f_l, COL), font=f_l, fill=ACCENT_Q)
    y += lab_h
    framed(board, rf, xl, y)
    framed(board, cf, xr, y)
    y += row1 + 40
    if detail:
        d.text((xl, y), "Detail (zoomed)", font=f_l, fill=ACCENT_REF)
        d.text((xr, y), "Detail (zoomed)", font=f_l, fill=ACCENT_Q)
        y += lab_h
        framed(board, detail[0], xl, y)
        framed(board, detail[1], xr, y)
        y += max(detail[0].height, detail[1].height) + 40
    d.line([M, y, W - M, y], fill=RULE, width=2)
    d.text((M, y + 24), f"Reference: {mobbin_url(r['mobbin'])} (via Mobbin; © {r['app']}). "
           "Internal design review only — do not commit or distribute reference imagery.",
           font=f_s, fill=MUTED)
    board.save(out, optimize=True)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=os.path.join(HERE, "compare-boards.config.json"))
    ap.add_argument("--refs", default="/workspace/work/refs-mobbin")
    ap.add_argument("--captures", default="/workspace/work/review-v4")
    ap.add_argument("--out", default="/workspace/work/boards")
    ap.add_argument("--theme", action="append", help="light | dark | high-contrast (repeatable; default light)")
    ap.add_argument("--only", action="append", help="board id (repeatable)")
    ap.add_argument("--fetch", action="store_true", help="download missing reference images from Mobbin")
    a = ap.parse_args()
    themes = a.theme or ["light"]
    cfg = json.load(open(a.config))
    os.makedirs(a.out, exist_ok=True)
    os.makedirs(a.refs, exist_ok=True)
    sources, made, missing = {}, [], []
    for b in cfg["boards"]:
        if a.only and b["id"] not in a.only:
            continue
        mid = b["ref"]["mobbin"]
        ref_path = os.path.join(a.refs, f"{mid}.png")
        if a.fetch:
            p, img = fetch_ref(mid, a.refs)
            sources[mid] = (b, img)
        if not os.path.exists(ref_path):
            missing.append(f"{b['id']}: reference {mid}.png not in {a.refs} (run with --fetch)")
            continue
        for t in themes:
            cap = os.path.join(a.captures, f"{t}-{b['quvrelo']}.png")
            if not os.path.exists(cap):
                missing.append(f"{b['id']}: capture {cap} missing")
                continue
            made.append(compose(b, ref_path, cap, t, os.path.join(a.out, f"{b['id']}-{t}.png")))
    if a.fetch and sources:
        with open(os.path.join(a.refs, "SOURCES-boards.md"), "w") as fh:
            fh.write("| file | app | screen | Mobbin URL | board |\n|---|---|---|---|---|\n")
            for mid, (b, img) in sources.items():
                fh.write(f"| {mid}.png | {b['ref']['app']} | {b['ref']['screen']} | {mobbin_url(mid)} | board: {b['id']} |\n")
    for m in made:
        print("board:", m)
    for m in missing:
        print("missing:", m, file=sys.stderr)
    return 1 if missing and not made else 0


if __name__ == "__main__":
    sys.exit(main())
