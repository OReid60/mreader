# Source repairs in 0.3.17

MangaFire's legacy Choujin X URL now resolves through its current URL using the same stable title identifier. The compatibility lookup changes; saved book IDs and reading records do not.

The current extension offers 270 individual chapters instead of the backup's volumes. The 12 saved volume entries remain alongside the current list. Their progress is retained without guessing a conversion into chapter progress. Attempting to open an unavailable volume gives a clear explanation.

The live isolated-library retest loaded the refreshed chapter list, a decoded cover (32,540 bytes) and a chapter page (473,132 bytes). All reading records compared equal before and after. Manual extension flags persisted and cleared successfully. Rust tests: 42 passed, 3 optional live tests ignored. Manual flag/clear UI tests passed.

Manganato's Last Boss Shoujo Akari and Loner Life in Another World were retested. Both still require Cloudflare verification that the desktop runtime cannot currently complete. The update improves the error message; it does not claim to solve that external challenge. A working website alone does not establish extension compatibility.

Settings → Sources provides Flag as not working and Clear flag for installed APK and native extensions. Flags are device-local notes, not automatic compatibility verdicts. They do not disable, uninstall or submit a report about an extension, and do not change reading progress.

Tests used an isolated guest library; the signed-in library was not migrated or edited.
