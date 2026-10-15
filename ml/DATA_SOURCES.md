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

Pretrained weights: **none**. QuvSelect v0 is trained from random initialisation.

## Considered and rejected
| Source | Reason |
|---|---|
| DUTS / DUTS-TE | No clear licence; distributed for research use. |
| ECSSD, HKU-IS, PASCAL-S, DUT-OMRON | Research-only, or no licence stated. |
| MS COCO images | Flickr images under mixed licences, some of them non-commercial (NC). |
| SA-1B (Segment Anything) | Licence restricts use to research. |
| Oxford-IIIT Pets | CC BY-SA 4.0. Share-alike conditions on derived weights are unclear, so we left it out for now. |
| ImageNet-pretrained torchvision/timm backbones | The code is BSD/Apache, but ImageNet's terms of access are non-commercial research. We avoided these to keep weight provenance clean. |

## Good next sources (permissive)
* Open Images V7 **train** segmentation masks (2.7 M masks, same CC BY 4.0 / CC BY 2.0 terms). This is the obvious way to scale up.
* Synthetic composites built from CC0 or public-domain cut-outs on Wikimedia Commons, recording each file. Pexels and
  Unsplash licences are their own licences, not CC0, so check them before use.
