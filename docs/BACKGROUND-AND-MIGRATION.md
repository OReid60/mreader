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
