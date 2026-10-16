#!/usr/bin/env sh
# Download CC0 camera DNG samples from raw.pixls.us for the raw importer tests
# (tests/unit/raw.test.ts). They are not committed (several MB each); the tests
# skip them when absent. Target: $QUVRELO_RAW_SAMPLES or ../raw-samples.
set -eu
DIR="${QUVRELO_RAW_SAMPLES:-$(cd "$(dirname "$0")/.." && pwd)/../raw-samples}"
mkdir -p "$DIR"
fetch() { [ -s "$DIR/$2" ] || curl -fsSL -g "$1" -o "$DIR/$2"; }
# Canon EOS 5D Mark III, 14-bit lossless JPEG CFA (CC0)
fetch "https://raw.pixls.us/getfile.php/2204/nice/Canon%20-%20EOS%205D%20Mark%20III%20-%2014bit%2014bit%20(2.3471882640587).dng" canon-5d3.dng
# Canon PowerShot A410 via CHDK, 10-bit packed uncompressed (CC0)
fetch "https://raw.pixls.us/getfile.php/1327/nice/Canon%20-%20Canon%20PowerShot%20A410%20-%2010bit%2010bit%20CHDK%20ver.%201.5.0%20(4:3).DNG" canon-a410-chdk.dng
# Nikon D80 via Adobe DNG Converter, 16-bit lossless JPEG (CC0)
fetch "https://raw.pixls.us/getfile.php/1988/nice/Nikon%20-%20D80%20-%2016bit%20(3:2).dng" nikon-d80.dng
echo "Raw samples in $DIR"
