# Building installable Mreader packages

The Rust library is shared across Windows, Linux, and Android. Each platform still needs its own compiler and packaging tools; changing a filename does not convert an executable between operating systems.

Current coordinated release: [0.3.6 continuous reader](https://github.com/OReid60/mreader/releases/tag/v0.3.6-continuous-reader). It includes centered single pages and a saved choice of Single page or Continuous strip, with labeled separators and lazy image loading. Pixel 7 and Windows have been updated in place. Frontend reader tests, 27 Rust tests, a live APK source check, and 13 packaged Linux checks passed. Centering, page separators, and continuous chapter transitions were confirmed on the Pixel 7.

Progress sync baseline: [0.3.4 progress sync fix](https://github.com/OReid60/mreader/releases/tag/v0.3.4-progress-sync) removed PostgreSQL-incompatible NUL-separated wire keys. Existing local positions and accounts are preserved; no Supabase schema change is required. Cross-device progress was confirmed with the installed Pixel 7 and Windows apps: Kagurabachi chapter 2 resumed at page 3 from phone to desktop, then page 4 from desktop to phone.

## Windows x64

Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/desktop.ps1 package`.

Prerequisites: Rust MSVC, Visual Studio C++ Build Tools, Windows SDK, Node/npm, and WebView2. The script discovers the local toolchain. Output is an NSIS EXE installer and a portable EXE under `releases/windows`. The Windows package is not signed with a commercial publisher certificate.

## Android ARM64 phones and tablets

Version 0.3.6 adds **Reader layout → Single page / Continuous strip** in the reader controls (tap the page center to reveal them). Continuous strip places all chapters supplied by the selected source in one vertical scroll, with black separators showing the current page and the next page/chapter. Images load near the viewport instead of downloading the whole title. Layout preference lives in the shared Rust/SQLite settings, with old profiles defaulting to Single page. Single pages are centered vertically and horizontally. PDF chapters continue to use the single-page/PDF reader.

[Android reader update 0.3.5](https://github.com/OReid60/mreader/releases/tag/v0.3.5-fullscreen-reader) adds immersive reading. Mobile readers open with app navigation, reader toolbars, and Android system bars hidden. Tap the center third to reveal controls; tap the edges to change pages in the selected reading direction. Android Back reveals controls from immersive mode, and closing the reader restores normal navigation. Install over the existing app to retain its account, extensions, and saved positions. Frontend phone/tablet checks and signed-APK checks passed. Fullscreen and center-tap controls were confirmed on the Pixel 7.

Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1`.

Prerequisites: Java 21, Android SDK 36, Android NDK, Rust's `aarch64-linux-android` target, and `cargo install cargo-ndk --locked`. Set `JAVA_HOME`, `ANDROID_HOME`, and optionally `NDK_HOME` for other machines. The current script also discovers this workstation's installed tools.

The script compiles the optimized Rust library, copies it into `jniLibs`, and packages it with Gradle. Copying avoids the symbolic-link privilege required by the standard Tauri Android CLI on this Windows machine. The generated Android project must already exist; `tauri android init --ci` creates it for a fresh checkout. Keep the customized `MainActivity.kt` and `Secrets.kt` when regenerating it.

Output: `releases/android/Mreader-<version>-arm64.apk`, for Android 8.0+ ARM64 devices, including phones and tablets. A debug build is available with `-Debug`; use the optimized release for normal reading. Android-only packaging hotfixes can set `-Version 0.3.3` independently of the Rust core version.

The first release creates a local signing key under `.secrets/android-release.p12`; its password is protected with Windows DPAPI for the current Windows user. Preserve the signing key and its recoverable password to publish install-compatible updates. These files must remain outside source control. The script verifies the final APK signature. Signing does not itself prove runtime behavior on a physical device.

Android imports CBZ, ZIP, and PDF through its file picker, copying selected files into app-private storage. Folder and CBR/RAR imports remain desktop features. Android and Linux render PDF pages with the bundled Apache-licensed PDF.js; Windows retains its system PDF viewer. File-based metadata backup dialogs currently remain desktop-only. Account progress sync and native JSON extensions share the Rust implementation.

## Linux x64

Run `bash scripts/build-linux.sh` on Linux. It generates a DEB installer for Debian/Ubuntu and an AppImage for portable execution under `releases/linux`.

Build dependencies include GTK 3, WebKitGTK 4.1, SSL, D-Bus development headers, patchelf, and librsvg. The included `.github/workflows/packages.yml` provisions these on an Ubuntu runner and uploads build artifacts. Linux builds run in the private repository https://github.com/OReid60/mreader. The packaging workflow checks JavaScript and Rust before building, then the reusable verification workflow opens the packaged AppImage on a virtual display and checks local imports, PDF rendering, navigation, and saved progress. Artifacts are retained for 14 days; downloaded copies are kept locally under `releases/linux`.

The current packages target Linux x64 and are built on Ubuntu 22.04. Older distributions have not been validated. Install the DEB with `sudo apt install ./Mreader_0.3.6_amd64.deb`, or make the AppImage executable with `chmod +x Mreader_0.3.6_amd64.AppImage` and run it.

## Validation

- `npm run check`: JavaScript syntax and frontend behavior checks.
- `npm test`: Rust tests, including local files, sources, offline recovery, profiles, and sync conflict handling.
- `scripts/verify-desktop.ps1`: isolated rendered-app checks on display 2, using no mouse or keyboard injection.
- Android: `apksigner verify --verbose APK`, `aapt dump badging APK`, and `zipalign -c -P 16 4 APK`. Inspect native ELF alignment with the NDK's `llvm-readelf`.

The public Supabase configuration is bundled from `cloud/project.json`. A public key can ship with clients; authorization depends on the deployed database policies. See `ACCOUNT-SYNC.md` for live validation limits.
