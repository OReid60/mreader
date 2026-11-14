#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist releases/linux
cp index.html app.js features.js style.css dist/
if [ -f mobile.js ]; then cp mobile.js dist/; fi
cp -R vendor dist/
npm exec --yes --package=@tauri-apps/cli@2 -- tauri build --bundles deb,appimage
find src-tauri/target/release/bundle -type f \( -name '*.deb' -o -name '*.AppImage' \) -exec cp '{}' releases/linux/ \;
(cd releases/linux && sha256sum *.deb *.AppImage > SHA256SUMS)
