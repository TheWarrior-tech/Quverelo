"""Resumable CPU training for QuvSelect.

Runs for at most --time-budget seconds, then checkpoints and exits, so it can be driven in short chunks
(re-run the same command until it prints "finished"). Everything needed to resume (weights, EMA weights,
optimiser, step, RNG) is in the checkpoint.

    python -m quvrelo_ml.train --steps 2400 --batch 12 --crop 224 --time-budget 100
"""
import argparse, copy, json, os, time

import numpy as np
import torch
import torch.nn.functional as F

from .data import Sampler
from .model import QuvSelect

ML = os.path.join(os.path.dirname(__file__), "..")


def loss_fn(logits, y):
    bce = F.binary_cross_entropy_with_logits(logits, y)
    p = torch.sigmoid(logits)
    inter = (p * y).sum((1, 2, 3))
    union = (p + y - p * y).sum((1, 2, 3))
    soft_iou = 1 - (inter + 1) / (union + 1)
    return bce + soft_iou.mean()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=2400)
    ap.add_argument("--batch", type=int, default=12)
    ap.add_argument("--crop", type=int, default=224)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--time-budget", type=float, default=100)
    ap.add_argument("--ckpt", default=os.path.join(ML, "checkpoints", "last.pt"))
    ap.add_argument("--log", default=os.path.join(ML, "logs", "train.log"))
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    t0 = time.time()
    torch.set_num_threads(os.cpu_count() or 2)
    os.makedirs(os.path.dirname(a.ckpt), exist_ok=True)
    os.makedirs(os.path.dirname(a.log), exist_ok=True)

    model = QuvSelect()
    ema = copy.deepcopy(model).eval()
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=1e-4)
    step = 0
    sampler = Sampler("train", crop=a.crop, seed=a.seed).prepare()
    if os.path.exists(a.ckpt):
        ck = torch.load(a.ckpt, map_location="cpu", weights_only=False)
        model.load_state_dict(ck["model"]); ema.load_state_dict(ck["ema"]); opt.load_state_dict(ck["opt"])
        step = ck["step"]; sampler.rng.bit_generator.state = ck["rng"]; torch.set_rng_state(ck["torch_rng"])
    else:
        torch.manual_seed(a.seed)
    if step >= a.steps:
        print("finished"); return

    def lr_at(s):  # linear warm-up then cosine
        w = 100
        if s < w:
            return a.lr * (s + 1) / w
        return a.lr * 0.5 * (1 + np.cos(np.pi * (s - w) / max(1, a.steps - w))) + 1e-5

    model.train()
    log = open(a.log, "a")
    run_loss, n = 0.0, 0
    while step < a.steps and time.time() - t0 < a.time_budget:
        for g in opt.param_groups:
            g["lr"] = lr_at(step)
        x, y = sampler.batch(a.batch)
        loss = loss_fn(model(x), y)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
        opt.step()
        d = min(0.998, (1 + step) / (10 + step))
        with torch.no_grad():
            for pe, pm in zip(ema.parameters(), model.parameters()):
                pe.mul_(d).add_(pm.detach(), alpha=1 - d)
            for be, bm in zip(ema.buffers(), model.buffers()):
                be.copy_(bm)
        step += 1; run_loss += loss.item(); n += 1
        if step % 20 == 0:
            log.write(json.dumps({"step": step, "loss": round(run_loss / n, 4), "lr": round(lr_at(step), 6), "t": round(time.time() - t0, 1)}) + "\n"); log.flush()
            run_loss, n = 0.0, 0
    tmp = a.ckpt + ".tmp"
    torch.save({"model": model.state_dict(), "ema": ema.state_dict(), "opt": opt.state_dict(), "step": step,
                "rng": sampler.rng.bit_generator.state, "torch_rng": torch.get_rng_state(), "args": vars(a)}, tmp)
    os.replace(tmp, a.ckpt)
    print(f"step {step}/{a.steps}" + (" finished" if step >= a.steps else ""))


if __name__ == "__main__":
    main()
