#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
file=resources/mobile/Mreader-android.apk
version=$(python3 -c 'import json;print(json.load(open("src-tauri/tauri.conf.json"))["version"])')
mkdir -p resources/mobile
if test -f "releases/android/Mreader-$version-arm64.apk"; then
  cp "releases/android/Mreader-$version-arm64.apk" "$file"
  printf '%s' "$version" > resources/mobile/apk-version.txt
fi
if ! test -f "$file" || ! test -f resources/mobile/apk-version.txt || test "$(cat resources/mobile/apk-version.txt)" != "$version"; then
  temp=$(mktemp -d)
  trap 'rm -rf "$temp"' EXIT
  gh release download "v$version" --repo OReid60/mreader --pattern "Mreader-$version-arm64.apk" --dir "$temp"
  cp "$temp/Mreader-$version-arm64.apk" "$file"
  printf '%s' "$version" > resources/mobile/apk-version.txt
fi
sha256sum "$file"
