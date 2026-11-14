# Mreader

A manga reader with a shared Rust/Tauri core, SQLite library, and lightweight HTML/CSS interface. Uses the installed WebView2 runtime; Electron and Node are not needed at runtime.

## Start

Run `npm start` or `powershell -ExecutionPolicy Bypass -File scripts/desktop.ps1 run`.

Build: `npm run build`. The standalone executable is `src-tauri/target/release/mreader.exe`.

The script discovers the project-local Rust toolchain and Visual Studio Build Tools, copies the frontend into `dist`, and compiles an optimized release build. Subsequent starts reuse the compiled build. Prerequisites: Rust stable MSVC, Microsoft C++ Build Tools with Windows SDK, and WebView2.

## Read manga

- **MangaDex:** Browse or search, open a title, add it to the library, then select a chapter. Choose the chapter language in Settings. Only chapters hosted by the source are included; external publisher links are not scraped.
- **Komga:** Enter your personal server URL, username, and password in Settings. Choose Komga in Browse. Passwords are stored in Windows Credential Manager and excluded from SQLite settings and backups. Use HTTPS for remote connections.
- **Local:** Import CBZ/ZIP, CBR/RAR, or PDF files, or an image folder. Drag and drop also works. Nested image folders and archives become chapters; nesting is scanned up to four levels. Pages and chapters use natural numeric ordering. Local files remain in place.
- **Offline:** Use a chapter’s download button. Up to two chapter downloads run at once, each with three page transfers. A chapter becomes available offline only when every page is saved.

The reader supports keyboard arrows, Space, clickable page sides, direct page jumps, fit width/height/original, right-to-left navigation, fullscreen, and chapter navigation. Escape closes the reader. Progress is saved to SQLite as pages are opened. PDF uses WebView2’s built-in PDF viewer; PDF internal page position is managed by that viewer, and Mreader tracks document-level read status.

Library collections, favorites, history, unread chapter updates, grid/list modes, sorting, themes, and metadata backup/restore are functional. “Check updates” refreshes online library titles. A language change applies when chapters are refreshed.

## Storage and performance

Data defaults to `%APPDATA%\app.mreader.desktop` (the actual path appears in Settings). `MREADER_DATA_DIR` overrides it for isolated testing. SQLite uses WAL mode. Archives are indexed without unpacking and cached with at most 32 open indexes. Local covers are resized to cached JPEG thumbnails. The reader retains only nearby page blobs and fetches adjacent pages ahead. Source requests reuse connections and MangaDex API requests are spaced to respect its rate limit.

CBR/RAR needs 7-Zip at its standard Program Files location. Individual image pages are limited to 64 MiB, PDF documents to 256 MiB, thumbnail decoding to 128 MiB allocation, and archives to 100,000 entries. PDF rendering uses the system viewer, not a bundled browser engine.

Backups merge metadata, progress, and preferences into the library in a transaction. They exclude manga bytes and passwords. Imported local paths must still exist when restoring. Restored online chapters need downloading again. Removing a title preserves original files; downloaded cache files currently remain on disk.

## Checks

`npm run check` checks frontend JavaScript syntax. `npm test` runs Rust tests. The opt-in live source test can be run with `cargo test --manifest-path src-tauri/Cargo.toml live_mangadex -- --ignored --nocapture` after setting up the Rust/MSVC environment.

## Native extensions and account sync (0.3)

Settings includes native JSON extension import, permission review, export, update by reimport, and uninstall. It also supports the real Keiyoushi APK catalog with package installation and removal: Android loads signed APKs through its source API; desktop runs them through a lazy local JVM compatibility process. See [APK sources](docs/apk-extensions.md) and [native JSON authoring](docs/EXTENSIONS.md).

Managed account sync implements sign-up/sign-in, secure session storage, refresh, per-account local databases, automatic metadata/progress sync, and conflict retries. The Mreader Supabase project is configured and its sync schema is deployed. Public checks confirm anonymous table and RPC access are denied; signed-in cross-device verification remains pending. No device needs to host a server. See [account setup and validation limits](docs/ACCOUNT-SYNC.md).

Windows EXE, Linux DEB/AppImage, and Android APK builds are available. Android targets ARM64 phones and tablets on Android 8.0+. Keiyoushi source installation and chapter reading have been verified on a real phone with Android packaging hotfix 0.3.3. See [packaging instructions and platform limits](docs/PACKAGING.md).

`scripts/verify-desktop.ps1` runs an isolated WebView2 integration check on display 2 without mouse or keyboard injection. It verifies real cover decoding in the rendered app, local archive navigation, PDF file loading, live built-in and native-extension reading, and downloads. Test fixtures must exist under `test-artifacts`.

Independent project inspired by Mihon. Not affiliated with Mihon, MangaDex, or Komga. Source availability and chapter availability depend on those services.

Learning to code? Follow [one page turn through the app](docs/LEARNING.md).

Linux packages are built and checked through the [private GitHub Actions workflow](https://github.com/OReid60/mreader/actions/workflows/packages.yml). The `mreader-linux` artifact contains the DEB, AppImage, and SHA-256 checksums; `mreader-linux-validation` contains the packaged-reader report and virtual-display screenshot.
