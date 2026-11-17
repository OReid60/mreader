# Background downloads

The Rust queue schedules chapters independently of the WebView. Its device-local
SQLite record stores pending work, failures and completed chapter totals for each
account profile. Downloads shows current chapter/page progress; reopening or
restoring the app refreshes it from the native queue. Stop queue pauses pending
work after the current chapter; Resume retries unfinished chapters. A process
restart recovers interrupted work as paused, ready to resume.

Desktop downloads continue while minimized. Closing the window during an active
queue minimizes it instead of exiting. Restore it from the taskbar to see progress.
Closing after the queue finishes exits normally.

Android uses a dataSync foreground service with an ongoing notification and a
partial CPU wake lock while work is active. The notification opens Downloads.
It does not keep the screen lit. Android can still stop an app through Force stop,
resource/battery restrictions or foreground-service time limits; unfinished work
is retained for resumption. No device power or security settings are changed.

See [Android foreground service timeouts](https://developer.android.com/develop/background-work/services/fgs/timeout).

# Mihon / Tachiyomi migration

Settings → Files & backup offers a local .tachibk/.proto.gz preview. On phones,
the module is in More/Settings with the other backup controls. It shows manga,
read/in-progress/unread chapter counts, categories, source IDs, installed/missing
sources and repository references. Import is a separate explicit confirmation.
The parser handles gzip/protobuf with compressed and expanded size limits.
The preview distinguishes saved library titles from history-only entries. Import
defaults to saved titles; including history-only titles requires selecting its
checkbox before confirmation.

Import preserves source IDs and chapter URLs, merges identical library records,
keeps existing downloads/read completion, and does not infer additional read
chapters. Multiple categories currently map to the first category per title.
Extension APKs, downloaded images, logins and tracker credentials are not imported.
Repository references are shown for review, never automatically trusted/installed.
The supplied backup is not uploaded or included in builds or repository commits.

Field numbers follow the official Mihon [backup model](https://github.com/mihonapp/mihon/tree/main/app/src/main/java/eu/kanade/tachiyomi/data/backup/models).
# Source refresh after restoring

After confirming a Mihon/Tachiyomi migration, Mreader checks the imported online
titles against their installed sources. Mreader JSON backup restore also refreshes
online titles. Two workers refresh chapters and cover art, with visible counts
and per-title failures in Migration. Missing extensions and offline sources can
be retried after adding the matching repository or reconnecting. Before refresh,
the migration guard installs missing APK extensions matched by exact source ID
from repositories already added by the user. Installed sources are skipped;
packages serving several titles or languages are installed once per run.
Missing or ambiguous matches and install/signature failures are shown for retry.
The library also checks missing APK sources at startup and after sync. A failed
cover can trigger this check. Only exact matches in configured repositories are
installed; pending installs are shared across concurrent checks. Manga summaries
show the extension name and installation status, and distinguish a missing
extension from an installed extension whose cover/source fails. Mihon source names
are retained in metadata so summaries remain informative without an installed APK.

Metadata search matches the exact source title URL/ID; it never silently switches
to a different result with a similar name. Existing reading progress and downloaded
chapters stay intact. Cover refresh bypasses the cached image, replacing it only
after a fresh image has been fetched and decoded successfully. Local imports are
not sent to an online source. Migration never adds or trusts repository references
from a backup automatically. Installing an extension does not guarantee that its
website is reachable or that the extension is maintained; manual flags remain notes.
