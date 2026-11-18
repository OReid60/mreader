<div align="center">

<img src="src-tauri/icons/icon.png" width="88" alt="Mreader icon">

# Mreader

**Your manga. Your progress. Across your devices.**

A reader for Windows, Android phones and tablets, and Linux.

[**Download Mreader 0.3.46**](https://github.com/OReid60/mreader-downloads/releases/tag/v0.3.46) · [Patch notes](docs/PATCH-NOTES.md) · [Installation guide](docs/DOWNLOAD.md) · [Report an issue](https://github.com/OReid60/mreader/issues)

</div>

## Read your way

- Fullscreen single-page reading or a continuous chapter strip.
- Offline chapter downloads with progress and background downloading.
- Library categories, Favorites, history, and chapter updates.
- Account sync for reading progress, library choices, sources, and custom covers.
- Mihon / Tachiyomi migration with a preview before importing.
- Your choice of source extensions, plus local manga file import.

## Get started

1. [Download the app for your device](docs/DOWNLOAD.md).
2. Import local manga or add an extension repository in **Settings → Sources**.
3. Sign in with the same Mreader account on your devices to sync your library and progress.
4. Download chapters before going offline. Downloads are stored separately on each device.

Installer releases are in the separate private [distribution repository](https://github.com/OReid60/mreader-downloads); sign in with an invited GitHub account to download. This source repository remains public.

Install Android updates over the existing app to keep its data. Source extensions, repository links, and manga content are not included. Users obtain and verify repositories independently. Source availability depends on the provider and extension author.

## What’s new in 0.3.46

The source picker now stays above mobile navigation and fits within the screen. Long source lists scroll inside the dialog without cutting off its top or bottom. See the [patch notes](docs/PATCH-NOTES.md) for the full release history.

See the [release page](https://github.com/OReid60/mreader-downloads/releases/tag/v0.3.46) for downloads and validation notes.

## Google Play readiness

See the [Google Play publishing pack](docs/GOOGLE-PLAY-PUBLISHING.md) for draft store copy, verified build details and requirements still to resolve. The current extension-enabled APK is not ready for Play submission.

## Build and contribute

Mreader uses a shared Rust core with Tauri and an HTML/CSS interface. See [packaging](docs/PACKAGING.md), [source extensions](docs/apk-extensions.md), and [the code walkthrough](docs/LEARNING.md).

Run `npm run check` for frontend checks. Windows builds use `scripts/desktop.ps1`; Android builds use `scripts/build-android.ps1`. Desktop packaging requires the matching signed Android APK under `releases/android` so local download sharing includes the correct version. Linux packages are built through [GitHub Actions](https://github.com/OReid60/mreader/actions/workflows/packages.yml).

Independent project inspired by Mihon. Not affiliated with Mihon or any manga source.
