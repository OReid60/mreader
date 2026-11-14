Mreader APK extensions
======================

In Settings (More on Android), choose **Add Keiyoushi**, search the catalog,
and install a source. Select its language-specific **(APK)** entry in Browse.
Other repositories can be added with an HTTPS protobuf index URL and a signing
fingerprint obtained from the repository owner. Repository key changes and APK
downgrades are rejected. Install only code from repositories you trust.

Install the extension separately on each device. Reading progress and library
metadata sync through the Mreader account; executable APKs and source credentials
are device-local. The identity of an APK book is its source ID plus a hash of its
source URL, so Android and desktop do not depend on the compatibility engine's
local database row numbers. A source is separate from another source offering the
same title; progress is shared for the same source and manga URL.

Android uses the Mihon source API with a private DexClassLoader, Android networking,
preferences and cookies. It validates package, version and the APK signing
certificate before loading code. Supported catalog APIs are 1.4 and 1.6.

Windows and Linux use a lazily started local Suwayomi v2.4.2366 process. The first
install downloads the official platform runtime (roughly 340 MB) and verifies its
pinned SHA-256. Only the JVM and server are extracted; Electron is not used.
The process listens on a random loopback port with a random per-session password,
opens no windows, disables embedded Chromium and FlareSolverr, and stops when the
reader exits. The Rust core still owns reading, downloads, the library and sync.
The Java heap is capped at 384 MiB. APK compatibility adds memory use when active;
native JSON extensions and built-in sources do not start the JVM.

Source availability and chapter access depend on the website. For Kagurabachi,
MangaDex may list publisher redirects instead of hosted chapter pages. The
MANGA Plus by SHUEISHA extension can expose chapters currently available from
that publisher. Expired or restricted chapters remain subject to publisher rules.

Validation
----------

- `npm run check` and `npm run test:mobile`: frontend and mobile layout regressions.
- `npm test`: Rust library, import, download and identity tests.
- `cargo test --release --manifest-path src-tauri/Cargo.toml live_keiyoushi_kagurabachi -- --ignored --nocapture`:
  live repository, signature-aware installation, search, chapters, page and cover
  decoding through the desktop runtime. Downloads the runtime on first use.
- Android `ExtensionHostTest`: loads real signed MangaDex and MANGA Plus APKs,
  searches Kagurabachi, fetches chapter pages and an image, rejects a wrong signer.
  Run only on a dedicated emulator or test device; it requires network access.
  `scripts/test-android-extensions.ps1` stages the APK fixtures and runs the test
  on a dedicated emulator (never a connected personal phone).

Third-party source API attribution is in `third-party/mihon`.
