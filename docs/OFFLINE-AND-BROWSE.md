# Offline reading and unified Browse

In a library title, use **Download all chapters** or **Download unread**. Downloads
are queued on this device, with chapter totals, current page counts, errors and a
retry option. Already downloaded chapters are skipped. Stop queue lets the current
chapter finish and stops pending work. Keep Mreader open until the queue finishes.
The **Downloads** tab shows progress even after closing the title details.

Chapters marked **✓ Offline** are available without internet. Account sync shares
reading progress and metadata, not chapter image files. Each device downloads its
own files. Queue plans are session-local; after restarting, Download all safely
rebuilds the missing-chapter queue.

Loading a later numbered chapter marks earlier numbered chapters as read. Special
chapters without a numeric chapter number are left alone. Read rows are muted;
clicking one starts it again at page 1. Continue reading retains the current page.
These read flags sync through the existing account progress service.

Update checks attach a **New** badge to titles with newly discovered chapters.
Reading those chapters (or advancing past them) clears the badge. Adding an entire
title for the first time does not treat its existing chapters as new updates.

With multiple installed sources, Browse initially uses **All installed sources**
in the selected reading language, including multilingual sources. It loads up to
three sources concurrently and displays results as they arrive. Exact normalized
title matches share one card; opening that card compares chapter availability and
marks the source with the most chapters as **Primary**. Other sources remain
selectable. This does not migrate or combine existing library/progress records.
Unavailable sources are labeled rather than silently treated as complete.

Search results are cached for five minutes, up to 40 source/query/page/language
entries. Refresh bypasses the cache. Chapter comparisons happen on opening a
matching result, so initial browsing does not fetch every title's chapters.

Komga is an optional personal manga library server. It hosts files you manage so
other devices can stream them. Extensions and local imports do not need it.
Its settings stay hidden unless a Komga URL is already configured.
