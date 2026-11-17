# Reader customization in 0.3.21

- Sources lists added repositories by name, such as Keiyoushi, with an Added badge
  and Refresh list action. Common aliases for the same repository are recognized
  before adding it again.
- Files & backup has persistent List and Stacked layouts. App data location is
  collapsed under Mreader to keep the module compact.
- Click/tap a missing cover in the saved library to choose an image. The cover
  area in manga details also allows replacing the image. JPEG, PNG, WebP, GIF and
  BMP inputs up to 10 MiB are decoded with memory/dimension limits and stored as
  a bounded JPEG thumbnail. Custom art is stored in the account's manga record,
  included in JSON backups and synchronized by the existing account document.
  Cover timestamps merge independently from source metadata and reading progress;
  newer choices survive stale device sync, chapter refresh and older backups.
  Existing device-only cover files are migrated automatically on profile open.
  JPEGs are resized as needed to stay under 96 KiB each. The existing 8 MiB
  account-document limit still applies; no new public image bucket is required.
- Source information appears directly below the detail cover. Hide warning and
  Show cover warning save a preference for that manga; missing-source guidance
  remains visible.
- Browse lists/searches only English APK/native sources. Existing library titles
  and their reading data are not removed by this filter.

Library cover recovery: Android reuses exact source/URL thumbnails returned by
Browse, including extensions whose manga-details response omits an image. Desktop
retries a failed saved thumbnail once after searching the same source and resolving
the exact saved URL. Neither path changes manga identity, chapters or progress.
Fresh Browse results and restored connectivity release transient cover failure
flags. The cover warning also offers Retry source cover independently of choosing
custom art. Upstream timeouts, unavailable titles and verification blocks can still
require another source or a custom cover.

Verification: 53 Rust tests passed. Desktop/mobile UI checks cover all controls,
duplicate repository aliases, English filtering and unchanged progress. The live
native test verified the custom cover survived source refresh and app restart,
alongside saved layout/warning preferences, without changing reading progress.
Additional tests cover two-way serialized/HTTP cover synchronization, stale-cover
conflicts, portable backup restore, legacy-file migration, input validation and
one-time exact-source thumbnail recovery. UI tests verify cache invalidation after
incoming account art and Browse recovery after a previous Library cover failure.
