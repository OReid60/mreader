#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
file=resources/mobile/Mreader-android.apk
expected=d65d8cefb0a37169bf6a43ce768bfc80b1093ef755724ebc3770680cc9cc069b
mkdir -p resources/mobile
if ! test -f "$file"; then
  temp=$(mktemp -d)
  trap 'rm -rf "$temp"' EXIT
  gh release download v0.3.9-desktop-preferences --repo OReid60/mreader --pattern Mreader-0.3.9-arm64.apk --dir "$temp"
  cp "$temp/Mreader-0.3.9-arm64.apk" "$file"
fi
printf '%s  %s\n' "$expected" "$file" | sha256sum -c -
