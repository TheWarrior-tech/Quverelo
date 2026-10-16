"""Fine-tune QuvSelect v1 (pretrained MobileNetV3-Large encoder) on CPU. Resumable, meant to run as a background job.

    cd ml && setsid nohup python -m quvrelo_ml.train_v1 --steps 6000 > logs/train_v1.out 2>&1 &

* Checkpoint (weights, EMA, optimiser, step, RNG) every --ckpt-every steps to checkpoints/v1_last.pt, plus a frozen copy
  every 1000 steps (checkpoints/v1_step<N>.pt). Re-running the same command resumes.
* Optimiser: AdamW; pretrained encoder stages at --lr-enc, new layers (prompt encoder, injections, decoder) at --lr.
  Linear warm-up 200 steps, then cosine decay. Stem + stages 0-1 frozen (BN statistics too).
* From --hires-from (fraction of steps) the crop grows to --crop-hi so the decoder sees closer to inference scale.
* Loss: BCE + soft IoU (as v0) + 0.5 x boundary-weighted BCE (pixels within 3 px of the GT edge x5).
"""
import argparse, copy, json, os, time

import numpy as np
import torch
import torch.nn.functional as F

from .data_v1 import SamplerV1
from .model_v1 import QuvSelectV1

ML = os.path.join(os.path.dirname(__file__), "..")


def loss_fn(logits, y):
    bce = F.binary_cross_entropy_with_logits(logits, y, reduction="none")
    edge = (F.max_pool2d(y, 7, 1, 3) - (-F.max_pool2d(-y, 7, 1, 3))) > 0.5
    w = 1 + 4 * edge.float()
    p = torch.sigmoid(logits)
    inter = (p * y).sum((1, 2, 3)); union = (p + y - p * y).sum((1, 2, 3))
    return bce.mean() + (1 - (inter + 1) / (union + 1)).mean() + 0.5 * (bce * w).sum() / w.sum()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=6000)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--crop", type=int, default=224)
    ap.add_argument("--crop-hi", type=int, default=288)
    ap.add_argument("--hires-from", type=float, default=0.8)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--lr-enc", type=float, default=4e-4)
    ap.add_argument("--ckpt-every", type=int, default=100)
    ap.add_argument("--ckpt", default=os.path.join(ML, "checkpoints", "v1_last.pt"))
    ap.add_argument("--log", default=os.path.join(ML, "logs", "train_v1.log"))
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--threads", type=int, default=os.cpu_count() or 2)
    a = ap.parse_args()
    torch.set_num_threads(a.threads)
    os.makedirs(os.path.dirname(a.ckpt), exist_ok=True); os.makedirs(os.path.dirname(a.log), exist_ok=True)

    model = QuvSelectV1(pretrained=True); model.freeze_early(True)
    ema = copy.deepcopy(model).eval()
    enc = [p for n, p in model.named_parameters() if p.requires_grad and n.startswith("b.")]
    new = [p for n, p in model.named_parameters() if p.requires_grad and not n.startswith("b.")]
    opt = torch.optim.AdamW([{"params": enc, "base": a.lr_enc}, {"params": new, "base": a.lr}], lr=a.lr, weight_decay=1e-4)
    sampler = SamplerV1("train", crop=a.crop, seed=a.seed)
    step = 0
    if os.path.exists(a.ckpt):
        ck = torch.load(a.ckpt, map_location="cpu", weights_only=False)
        model.load_state_dict(ck["model"]); ema.load_state_dict(ck["ema"]); opt.load_state_dict(ck["opt"])
        step = ck["step"]; sampler.rng.bit_generator.state = ck["rng"]; torch.set_rng_state(ck["torch_rng"])
        print("resumed at", step, flush=True)
    else:
        torch.manual_seed(a.seed)

    def lr_mult(s):
        if s < 200:
            return (s + 1) / 200
        return 0.5 * (1 + np.cos(np.pi * min(1.0, (s - 200) / max(1, a.steps - 200)))) + 0.005

    def save(path):
        tmp = path + ".tmp"
        torch.save({"model": model.state_dict(), "ema": ema.state_dict(), "opt": opt.state_dict(), "step": step,
                    "rng": sampler.rng.bit_generator.state, "torch_rng": torch.get_rng_state(), "args": vars(a)}, tmp)
        os.replace(tmp, path)

    model.train()
    log = open(a.log, "a")
    run, n, t0 = 0.0, 0, time.time()
    while step < a.steps:
        hi = step >= a.hires_from * a.steps
        sampler.crop = a.crop_hi if hi else a.crop
        bs = max(4, int(a.batch * (a.crop / a.crop_hi) ** 2)) if hi else a.batch
        for g in opt.param_groups:
            g["lr"] = g["base"] * lr_mult(step)
        x, y = sampler.batch(bs)
        loss = loss_fn(model(x), y)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], 5.0)
        opt.step()
        d = min(0.999, (1 + step) / (10 + step))
        with torch.no_grad():
            for pe, pm in zip(ema.parameters(), model.parameters()):
                pe.mul_(d).add_(pm.detach(), alpha=1 - d)
            for be, bm in zip(ema.buffers(), model.buffers()):
                be.copy_(bm)
        step += 1; run += loss.item(); n += 1
        if step % 20 == 0:
            log.write(json.dumps({"step": step, "loss": round(run / n, 4), "lr": round(a.lr * lr_mult(step), 6),
                                  "crop": sampler.crop, "bs": bs, "s_per_it": round((time.time() - t0) / n, 2)}) + "\n")
            log.flush(); run, n, t0 = 0.0, 0, time.time()
        if step % a.ckpt_every == 0 or step == a.steps:
            save(a.ckpt)
        if step % 1000 == 0:
            save(os.path.join(os.path.dirname(a.ckpt), f"v1_step{step}.pt"))
    print("finished", step, flush=True)


if __name__ == "__main__":
    main()
