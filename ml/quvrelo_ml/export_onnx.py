"""Export the EMA weights of a QuvSelect checkpoint to ONNX (opset 17, dynamic H/W multiples of 32),
then verify with onnxruntime: max |logit| difference vs PyTorch and CPU latency.

    python -m quvrelo_ml.export_onnx --ckpt ml/checkpoints/last.pt --out ml/models/quvselect.onnx
"""
import argparse, json, os, time

import numpy as np
import torch

from .model import QuvSelect

ML = os.path.join(os.path.dirname(__file__), "..")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default=os.path.join(ML, "checkpoints", "last.pt"))
    ap.add_argument("--out", default=os.path.join(ML, "models", "quvselect.onnx"))
    ap.add_argument("--report", default=os.path.join(ML, "models", "export_report.json"))
    a = ap.parse_args()
    ck = torch.load(a.ckpt, map_location="cpu", weights_only=False)
    m = QuvSelect().eval()
    m.load_state_dict(ck["ema"])
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    x = torch.randn(1, 6, 320, 320)
    torch.onnx.export(
        m, (x,), a.out, opset_version=17, input_names=["input"], output_names=["logits"],
        dynamic_axes={"input": {2: "height", 3: "width"}, "logits": {2: "height", 3: "width"}},
        dynamo=False,
    )
    import onnx, onnxruntime as ort

    onnx.checker.check_model(onnx.load(a.out))
    so = ort.SessionOptions(); so.intra_op_num_threads = os.cpu_count() or 2
    sess = ort.InferenceSession(a.out, so, providers=["CPUExecutionProvider"])
    rep = {"checkpoint_step": ck["step"], "opset": 17, "bytes": os.path.getsize(a.out),
           "params": sum(p.numel() for p in m.parameters()), "torch_threads": torch.get_num_threads(),
           "cpu_count": os.cpu_count()}
    for S in (256, 320, 512):
        xi = torch.randn(1, 6, S, S)
        xi[:, 3:] = (xi[:, 3:] > 1.5).float()
        with torch.no_grad():
            ref = m(xi).numpy()
        out = sess.run(None, {"input": xi.numpy()})[0]
        diff = float(np.abs(ref - out).max())
        agree = float(((ref > 0) == (out > 0)).mean())
        sess.run(None, {"input": xi.numpy()})
        t = time.time(); n = 10
        for _ in range(n):
            sess.run(None, {"input": xi.numpy()})
        rep[f"{S}"] = {"max_abs_diff": diff, "mask_agreement": agree, "ort_cpu_ms": round((time.time() - t) / n * 1000, 1)}
    print(json.dumps(rep, indent=1))
    json.dump(rep, open(a.report, "w"), indent=1)


if __name__ == "__main__":
    main()
