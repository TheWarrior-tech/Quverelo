# Data sources and licences (ML)

Every source used to train or test a Quvrelo model is listed here. A source can be added only if its licence
allows us to train on it and ship the resulting weights in an MIT-licensed app.

## Used

| Source | What | Licence | How obtained |
|---|---|---|---|
| Open Images V5, validation split: images (7,000 used) | Photos | **CC BY 2.0**. Licence is stated per image in `validation-images-with-rotation.csv`, and we keep only images whose `License` is CC BY 2.0 | `https://s3.amazonaws.com/open-images-dataset/validation/<id>.jpg` |
| Open Images V5, validation segmentation masks + `validation-annotations-object-segmentation.csv` | Instance masks | **CC BY 4.0**, © Google LLC | `http://storage.googleapis.com/openimages/v5/...` |
| Open Images `class-descriptions-boxable.csv` | Class names | CC BY 4.0 | same |

Attribution:
* CC BY 2.0 requires attribution. `ml/scripts/download_openimages.py` writes `ml/data/openimages/ATTRIBUTION.csv`, which lists the author, landing
  URL and licence for every image used.
* The one image committed to the repo is a 96×72 test thumbnail in `tests/fixtures/ml/model_parity.json`, and its
  attribution is stored inside that file.
* Credit in About/NOTICE: "Trained using Open Images V5 (Google LLC, CC BY 4.0 annotations; images CC BY 2.0 by
  their Flickr authors)".

### Added for QuvSelect v1 (2026-10-16)
| Source | What | Licence | How obtained |
|---|---|---|---|
| Open Images V5 validation split, **all** 13,524 images with segmentation masks (v0 used the first 7,000) | Photos + 24,730 instance masks | Images **CC BY 2.0** (every one checked against the per-image `License` column); masks **CC BY 4.0**, © Google LLC | `ml/scripts/fetch_openimages.py` (S3 images, GCS mask zips over http) |
| Open Images V5 **test** split segmentation subset (29,742 of its 40,386 images were fetched in this session; the script resumes the rest) | Photos + instance masks, **training only** | Images **CC BY 2.0** (all 40,386 checked); masks + `test-annotations-object-segmentation.csv` **CC BY 4.0**, © Google LLC | same script |

The held-out test split is unchanged in definition (Open Images *validation* images with `sha1(ImageID) % 100 < 7`), so
the v0 test images are a subset of the v1 test images; no Open Images test-split image is ever evaluated on.

## Pretrained weights
| Weights | Used for | Licence | Provenance notes |
|---|---|---|---|
| QuvSelect v0 | — | MIT (ours) | Trained from random initialisation. |
| `timm/mobilenetv3_large_100.ra_in1k` (Hugging Face, revision `96f46a1c52932f27492dff66c72378eb99b443a7`) | Encoder initialisation of **QuvSelect v1** | **Apache-2.0** (model card `license: apache-2.0`; timm code Apache-2.0) | Trained by Ross Wightman on ImageNet-1k. The *weights* are released under Apache-2.0, which permits commercial use and redistribution of derived weights. ImageNet's own terms of access are non-commercial research; whether that reaches weights trained on it is legally unsettled. Industry practice (and the Apache grant from the weight author) treats such weights as usable; we record it here so legal can review, and v0 remains available as a no-ImageNet fallback. |
| U2-Net-p (`u2netp.onnx`, rembg release `v0.0.0`) | **Evaluation reference only** (`ml/quvrelo_ml/evaluate_ref.py`); never trained on, distilled from, or shipped | Apache-2.0 (weights, github.com/xuebinqin/U-2-Net); rembg ONNX export MIT | Trained on DUTS-TR (research licence), which is why it is not shipped or used as a teacher. |

Training-time tools (not shipped): PyTorch (BSD-3), timm (Apache-2.0), onnx / onnxruntime (MIT/Apache-2.0).

## Considered and rejected
| Source | Reason |
|---|---|
| DUTS / DUTS-TE | No clear licence; distributed for research use. |
| ECSSD, HKU-IS, PASCAL-S, DUT-OMRON | Research-only, or no licence stated. |
| MS COCO images | Flickr images under mixed licences, some of them non-commercial (NC). |
| SA-1B (Segment Anything) | Licence restricts use to research. |
| Oxford-IIIT Pets | CC BY-SA 4.0. Share-alike conditions on derived weights are unclear, so we left it out for now. |
| ImageNet-pretrained torchvision backbones | torchvision's weight files carry no explicit weight licence. For v1 we instead use a timm checkpoint whose weights are explicitly Apache-2.0 (see Pretrained weights). |

## Good next sources (permissive)
* Open Images V7 **train** segmentation masks (2.7 M masks, same CC BY 4.0 / CC BY 2.0 terms). This is the obvious way to scale up.
* Synthetic composites built from CC0 or public-domain cut-outs on Wikimedia Commons, recording each file. Pexels and
  Unsplash licences are their own licences, not CC0, so check them before use.
