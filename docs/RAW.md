# Raw photos and 16-bit editing

## What Quvrelo opens

| Format | Opens? | How |
| --- | --- | --- |
| **DNG** (Adobe Digital Negative), from any camera, phone or converter | Yes | Developed on import to a 16-bit Photo document |
| 16-bit PNG | Yes | Kept at 16 bits per channel |
| JPEG, 8-bit PNG, WebP, GIF, BMP | Yes | 8 bits per channel |
| Canon CR2 / CR3, Nikon NEF, Sony ARW, Fujifilm RAF, Olympus ORF, Panasonic RW2 and other proprietary raw files | **No** | Convert to DNG first (see below) |

### Why proprietary raw files are not supported

Camera makers do not publish their raw formats. The open-source decoders that
read them (LibRaw, rawspeed, dcraw derivatives) are licensed under the LGPL or
GPL, and Quvrelo is an MIT-licensed app that only bundles permissively
licensed code, so it does not link them. Writing and maintaining
reverse-engineered decoders for hundreds of camera models is not something we
can do reliably.

DNG is a published, royalty-free specification, and every proprietary raw file
can be turned into one without losing data:

- **Adobe DNG Converter** (free, Windows and macOS) converts a folder of CR3,
  NEF, ARW… files to DNG.
- Many phones and some cameras (Leica, Pentax, Ricoh, Hasselblad, DJI drones)
  write DNG directly.

## How a DNG is developed

Quvrelo follows the DNG 1.6 specification (code: `src/core/raw/`):

1. Decompression (uncompressed, lossless JPEG, deflate, tiled or stripped) with
   UTIF.js (MIT).
2. 8 to 16-bit samples unpacked, the LinearizationTable applied.
3. BlackLevel (with its repeat pattern and per-row/column deltas) subtracted,
   scaled by WhiteLevel.
4. Cropped to ActiveArea and DefaultCrop.
5. As-shot white balance from AsShotNeutral (or AsShotWhiteXY), highlights
   clipped so blown skies stay white.
6. Demosaic: Malvar–He–Cutler gradient-corrected interpolation for Bayer
   sensors; a neighbourhood average for other patterns (such as X-Trans);
   LinearRaw DNGs are already RGB.
7. Camera colour to the document's RGB space (sRGB, Adobe RGB or Display P3)
   through ColorMatrix and CameraCalibration, for the daylight calibration.
8. BaselineExposure, the space's transfer curve, 16 bits per channel, and the
   Orientation tag.

Not yet applied: lens corrections (OpcodeList), ProfileHueSatMap / LookTable
(DCP looks), noise reduction, and lossy-compressed DNGs. The developed photo is
an ordinary 16-bit pixel layer: use the Adjustments panel (Exposure, White
Balance, Curves…) to finish it.

## 16 bits per channel

Document setup › **Bit depth: 16-bit** (set automatically when you open a DNG
or a 16-bit PNG):

- Pixel layers keep their 16-bit originals in memory and in the .quvrelo file
  (stored as 16-bit PNG).
- Every adjustment runs at 16 bits in floating point, so strong Levels, Curves
  or Exposure changes do not band.
- Painting and retouching keep the untouched pixels at 16 bits; painted pixels
  carry the brush's 8-bit colour.
- **Export › PNG › Bit depth 16-bit** writes a 16-bit PNG. Shapes and text on
  top are drawn as on screen and blended over the 16-bit photo. JPEG is always
  8-bit; PDF and SVG embed 8-bit images.

Every PNG and JPEG export embeds the document's RGB profile (PNG `iCCP`, JPEG
`APP2 ICC_PROFILE`), so Adobe RGB and Display P3 documents look right in other
apps.
