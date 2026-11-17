# Mobile layout and navigation (0.3.24)

- Manga details use the available viewport with one scrolling panel. Source
  information and an icon for completed downloads sit to the right of the cover.
  Tapping the icon shows the count saved on this device. Queue details remain in
  Downloads rather than inside the mobile manga panel.
- Ascending/Descending chapter order is a saved device preference. It sorts a
  display copy, preserving source chapter order, IDs and reading progress.
- Favorites is a built-in category backed by the existing favorite flags. Manga
  retain their assigned category. Horizontal content swipes change categories.
- Offline Library shows locally available manga across categories and labels
  that view clearly. Reconnecting restores the normal category navigation.
- Phone bottom navigation is History, Updates, Library, Browse, More.
- Pull down from the top of Browse to force a refresh. Existing results remain
  visible during refresh. Tab navigation restores the last Browse view.
- Source requests are deduplicated. Bounded snapshots expire after five minutes
  and are scoped by account, source versions, query, page and language. Refresh
  bypasses the cache; logout/source changes clear it. Cache snapshots contain
  source metadata, not downloaded manga pages, and never replace reading data.

Headless checks cover phone and landscape bounds, source position, saved count,
chapter sorting, favorite isolation, gestures, cache reuse/deduplication, offline
filtering and navigation order. Existing reader, migration, download and cover
regressions are retained. The signed phone smoke test inspects the real WebView
without changing favorites or reading progress.

## Smooth category transitions (0.3.25)

Category swipes track the finger, animate to the adjacent category, and snap back
for short swipes or at either end. Vertical scrolling stays native. Category taps
use the same transition, and reduced-motion settings skip the animation.

## Settings cleanup (0.3.26)

Settings omit app data paths, server configuration fields, runtime implementation
details and extension API/package identifiers on both platforms. Saved server
settings remain intact when preferences are saved. Account, sync, migration,
backups, source installation and local APK sharing remain available. Repository
signing verification remains available because it protects user-added sources.
