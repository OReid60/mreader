# Reading progress conflicts

Progress is stored per manga and chapter, with millisecond timestamps.
Sync chooses the newer timestamp. If timestamps are equal, it keeps the farther
page, regardless of which device initiated sync. Completed status is preserved.
The same tie rule applies when writing the merged result to SQLite, so a local
page change during a network request cannot be replaced by an older response.

A genuinely newer reread may have a lower page number; it remains the resume
position. Choosing the maximum page unconditionally would break rereading.

The service already uses revision checks and retries concurrent writes. These
changes require no database schema update. Both devices should use the updated
client for the equal-timestamp rule. Device clocks still need to be accurate;
timestamps cannot establish true event order between badly skewed offline clocks.

Tests cover merge order, equal timestamps, completed status, newer rereads,
in-flight local reading and HTTP revision conflicts.

The two-client HTTP regression also sends stale progress in both directions:
phone page 12 survives an older desktop page 4, desktop page 15 survives the
stale phone page 12, and a newer reread at page 2 survives stale page 15.
These fixtures use an isolated HTTP service rather than editing personal history.

Mreader JSON backup restores now apply the same timestamp/tie rules and retain
existing downloaded chapter paths. Unknown page counts do not truncate a saved
resume position to page zero during restore.
