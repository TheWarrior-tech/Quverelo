# Little CMS (WebAssembly)

`lcms.js` and `lcms.wasm` are the unmodified `dist/` files of
[lcms-wasm](https://github.com/mattdesl/lcms-wasm) 1.0.5 (MIT, Matt DesLauriers),
an Emscripten build of [Little CMS 2](https://github.com/mm2/Little-CMS) (MIT,
Marti Maria Saguer). They are vendored rather than installed from npm because the
npm package lists a test runner (`tape`) as a runtime dependency. Licences:
`LICENSE-lcms-wasm.md`, `LICENSE-Little-CMS.txt`.

Quvrelo uses it for every ICC conversion (core/colour/cms.ts): RGB to CMYK for
print PDFs, soft-proofing and gamut checks, and RGB profile conversions.
