"""Export QuvSelect v1 (EMA weights) to ONNX fp32 + an int8 (static QDQ, per-channel) variant, then check parity and
CPU latency with onnxruntime.

    python -m quvrelo_ml.export_v1 --ckpt checkpoints/v1_last.pt
writes models/quvselect_v1.onnx, models/quvselect_v1_int8.onnx and models/export_report_v1.json.

int8: onnxruntime.quantization.quantize_static, QDQ format, per-channel weights, activations calibrated (MinMax) on 64
*training* samples (subject and click prompts, seed 7). The held-out test split is never used for calibration.
"""
import argparse, json, os, time

import numpy as np
import torch

from .model_v1 import QuvSelectV1

ML = os.path.join(os.path.dirname(__file__), "..")


class _Calib:
    def __init__(self, n, size):
        from .data_v1 import SamplerV1
        s = SamplerV1("train", crop=size, seed=7)
        self.items = [s.one()[0][None].astype(np.float32) for _ in range(n)]
        self.i = 0

    def get_next(self):
        if self.i >= len(self.items):
            return None
        self.i += 1
        return {"input": self.items[self.i - 1]}

    def rewind(self):
        self.i = 0


def bench(path, S, n=10, threads=None):
    import onnxruntime as ort
    so = ort.SessionOptions(); so.intra_op_num_threads = threads or os.cpu_count() or 2
    sess = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
    x = np.random.randn(1, 6, S, S).astype(np.float32); x[:, 3:] = 0
    sess.run(None, {"input": x})
    t = time.time()
    for _ in range(n):
        sess.run(None, {"input": x})
    return sess, round((time.time() - t) / n * 1000, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default=os.path.join(ML, "checkpoints", "v1_last.pt"))
    ap.add_argument("--out", default=os.path.join(ML, "models", "quvselect_v1.onnx"))
    ap.add_argument("--int8", default=os.path.join(ML, "models", "quvselect_v1_int8.onnx"))
    ap.add_argument("--report", default=os.path.join(ML, "models", "export_report_v1.json"))
    ap.add_argument("--calib", type=int, default=64)
    ap.add_argument("--repo", default="TheWarrior-tech/Quverelo")
    ap.add_argument("--branch", default="ml-models")
    ap.add_argument("--release-dir", default=None, help="also copy the ONNX files + manifest here (release staging)")
    ap.add_argument("--manifest-only", action="store_true", help="only (re)write manifest.json for existing files")
    a = ap.parse_args()
    if a.manifest_only:
        return write_manifest(a, json.load(open(a.report)).get("checkpoint_step"))
    ck = torch.load(a.ckpt, map_location="cpu", weights_only=False)
    m = QuvSelectV1(pretrained=False).eval(); m.load_state_dict(ck["ema"])
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    torch.onnx.export(m, (torch.randn(1, 6, 320, 320),), a.out, opset_version=17, input_names=["input"], output_names=["logits"],
                      dynamic_axes={"input": {2: "height", 3: "width"}, "logits": {2: "height", 3: "width"}}, dynamo=False)
    import onnx
    onnx.checker.check_model(onnx.load(a.out))
    from onnxruntime.quantization import CalibrationMethod, QuantFormat, QuantType, quantize_static
    from onnxruntime.quantization.shape_inference import quant_pre_process
    pre = a.out.replace(".onnx", ".pre.onnx")
    quant_pre_process(a.out, pre, skip_symbolic_shape=True)
    quantize_static(pre, a.int8, _Calib(a.calib, 320), quant_format=QuantFormat.QDQ, per_channel=True,
                    activation_type=QuantType.QUInt8, weight_type=QuantType.QInt8, calibrate_method=CalibrationMethod.MinMax)
    os.remove(pre)
    rep = {"checkpoint_step": ck["step"], "opset": 17, "params": sum(p.numel() for p in m.parameters()),
           "fp32_bytes": os.path.getsize(a.out), "int8_bytes": os.path.getsize(a.int8), "cpu_count": os.cpu_count()}
    for S in (320, 384, 512):
        xi = torch.randn(1, 6, S, S); xi[:, 3:] = 0
        with torch.no_grad():
            ref = m(xi).numpy()
        for tag, path in (("fp32", a.out), ("int8", a.int8)):
            sess, ms = bench(path, S)
            out = sess.run(None, {"input": xi.numpy()})[0]
            rep[f"{tag}_{S}"] = {"max_abs_diff_vs_torch": round(float(np.abs(ref - out).max()), 6),
                                  "mask_agreement_vs_torch": round(float(((ref > 0) == (out > 0)).mean()), 5), "ort_cpu_ms": ms}
    print(json.dumps(rep, indent=1))
    json.dump(rep, open(a.report, "w"), indent=1)
    write_manifest(a, ck["step"])


def sha256(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def write_manifest(a, step):
    """ml/models/manifest.json: what scripts/fetch-ml-models.mjs copies from the ml-models branch and checks."""
    models = [{"id": i, "file": os.path.basename(p), "bytes": os.path.getsize(p), "sha256": sha256(p)}
              for i, p in (("quvselect-v1", a.out), ("quvselect-v1-int8", a.int8))]
    m = {"repo": a.repo, "branch": a.branch, "checkpoint_step": step, "licence": "MIT (weights, Quvrelo); "
         "encoder initialised from timm mobilenetv3_large_100.ra_in1k (Apache-2.0); data Open Images (CC BY), see ml/DATA_SOURCES.md",
         "models": models}
    json.dump(m, open(os.path.join(os.path.dirname(a.out), "manifest.json"), "w"), indent=1)
    if a.release_dir:
        import shutil
        os.makedirs(a.release_dir, exist_ok=True)
        for p in (a.out, a.int8):
            shutil.copy2(p, os.path.join(a.release_dir, os.path.basename(p)))
        shutil.copy2(os.path.join(os.path.dirname(a.out), "manifest.json"), os.path.join(a.release_dir, "manifest.json"))
    print(json.dumps(m, indent=1))


if __name__ == "__main__":
    main()
