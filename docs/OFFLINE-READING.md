# Offline reading repair in 0.3.23

The Pixel audit found no completed downloads for the current Kagurabachi entry
from MangaRead.org. Its old completed queue belonged to the removed MANGA Plus
entry. A queue's historical success count is not proof that the currently
selected source/title has saved pages.

- Downloads now identifies the source and shows a removed-library-entry status
  or missing saved-chapters status instead of claiming Ready offline.
- Some APK sources require `SChapter.memo` to construct page URLs. The Android
  bridge now returns this context with chapters, Rust stores it as `sourceMemo`,
  and page requests reconstruct it. Old entries get one exact-chapter context
  recovery when the extension requests a chapter-list refresh.
- Valid source numbers are kept. Missing numeric values are inferred from an
  explicit Chapter/Ch. label, without changing chapter IDs or reading progress.
- Source refresh and sync preserve downloaded chapters, including chapters that
  are missing from a newer remote/source list. Extension context survives sync
  and JSON serialization as source metadata; device file paths stay local.
- Continuous reading does not automatically request undownloaded chapters while
  offline. It labels the boundary and provides a useful message for explicit
  navigation, while saved pages remain readable.

Verification includes Rust preservation/serialization and chapter-number tests,
headless phone/tablet reader tests, removed-entry queue labeling, and a signed
Pixel test that downloads chapter 1 using its real source without marking pages
read. The offline test turns both radios off, reads and decodes saved pages using
the normal Rust API, compares reading progress, and restores the original radio
settings. An independent shell timer provides recovery if the test process exits.

Downloaded pages are device-local. Switching sources requires downloading the
new source's chapters on the device that will read them.
