# Bundled ICC profiles

| File | Space | Source | Licence |
| --- | --- | --- | --- |
| `sRGB-v2-magic.icc` | sRGB IEC 61966-2-1 | [Compact ICC Profiles](https://github.com/saucecontrol/Compact-ICC-Profiles) | CC0 1.0 |
| `AdobeCompat-v2.icc` | Adobe RGB (1998) compatible | Compact ICC Profiles | CC0 1.0 |
| `DisplayP3Compat-v2-magic.icc` | Display P3 | Compact ICC Profiles | CC0 1.0 |
| `QuvreloCoatedFOGRA39.icc` | CMYK, ISO 12647-2 coated (FOGRA39) | built by Quvrelo | CC0 1.0 |
| `QuvreloPremiumCoatedCRPC6.icc` | CMYK, ISO 15339 CRPC6 (GRACoL 2013) | built by Quvrelo | CC0 1.0 |

## Why we build our own CMYK profiles

The usual FOGRA39 / GRACoL profiles (ECI `ISOcoated_v2`, Adobe `Coated FOGRA39`,
IDEAlliance `GRACoL2013`) may be used freely but their licences do not allow
bundling them with an app under a permissive licence (Debian ships them in
non-free for this reason). The *characterisation data* those profiles are built
from is published in the ICC registry, so `scripts/build-cmyk-profiles.sh` builds
equivalent ICC v2 output profiles from it with ArgyllCMS `colprof`:

- FOGRA39L (1617 patches, Fogra, via registry.color.org)
- ISO/PAS 15339-2 CRPC6 (1617 patches, via standards.iso.org)

Settings: medium quality A2B/B2A tables, relative black generation, total ink
limit 330 % (FOGRA39) / 320 % (CRPC6), black limit 95 %. Profile check against
the measurement data: FOGRA39 average ΔE 0.16, peak 0.72.

These are not byte-identical to the ECI or Adobe profiles: separations (black
generation) differ, so a press that expects a specific separation should be
sent the RGB file or a PDF/X made with their profile. A PDF/X file names the
registered condition (`FOGRA39`, `CGATS21_CRPC6`) in its OutputIntent and embeds
the profile used, which is what ISO 15930 requires.
