# ml-models (orphan branch)

QuvSelect model weights that are too large for the main history (the repo does not use git LFS).
CI checks this branch out into `ml-models/` and `scripts/fetch-ml-models.mjs` copies each file into
`ml/models/` after verifying it against the sha256 pinned in `ml/models/manifest.json` on the code branch.
A mismatch fails the build. Never rewrite a file in place: add a new file name and pin it in the manifest.

- quvselect_v1.onnx: QuvSelect v1 fp32 (shipped, preferred)
- quvselect_v1_int8.onnx: QuvSelect v1 int8 QDQ (shipped as an alternative)
- manifest.json: copy of the manifest these files were exported with
