# Android startup and cover-upload regression checks (0.3.22)

The Pixel 7 crash log showed a native abort while OkHttp decoded an extension
image response: `ClassNotFoundException: com.squareup.zstd.ZstdCompressor`.
The release optimizer's usage report confirmed that it had removed this class.
The JNI library looks up both compression and decompression classes when it
initializes, even if the app only decompresses responses.

The release rules now preserve `com.squareup.zstd` classes and members. The APK
check rejects a build missing any of the required JNI interfaces/implementations.
The paired-device regression decompresses a Zstandard frame through the optimized
release app; the instrumentation APK contains no duplicate compression classes.

The two-device test also exposed a separate upload problem. Tauri 2.12.5 uses
authenticated `postMessage` IPC on Android and serializes a binary payload as a
JSON byte array. The custom-cover command previously accepted only desktop Raw
bytes. It now validates both representations, with the same 10 MiB input limit
and byte-range checks, before the existing bounded image decoder runs.

`CoverSyncTest` is opt-in signed instrumentation, not an app automation interface.
It only edits a newly-created empty title named `Mreader cover sync test`; no
reading APIs are called. The test verifies desktop art, selects a different image
through the production `applyCustomCover` function, syncs it back, and checks
image hashes and unchanged reading progress. Cleanup confirms synced deletion of
the temporary title. The existing backup restore validation/merge path is shared
with an opt-in Rust test that restores the captured backup into a fresh profile,
reads its image without an original cover file, then reopens the database.
