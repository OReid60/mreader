# Mreader patch notes

New releases are recorded here, newest first. Download the current build from the repository's latest GitHub release. Older release binaries may be removed; these notes and Git tags retain the version history.

## 0.3.45 — 2026-11-18

- APK source extensions always use Stacked cards; the redundant List/Stacked switches are removed, including for older saved preferences.
- The extension search field is labeled and prompted **Search Extension**.
- Browse source uses an app-themed, scrollable picker instead of Android's gray system dialog. It supports source status, outside-tap/Close/Escape dismissal and Android back navigation.
- Skipped-source and help disclosures retain their open/closed choice across app restarts as well as rerenders.
- Reading-progress identities and storage are unchanged.

Validation: physical Android and Windows app checks passed before and after restarts, including Stacked-only cards, the themed picker, disclosure persistence and unchanged reading-progress hashes. All 59 native regression tests passed; four live tests were ignored. Password recovery was tested with mocked requests and native link-validation tests; automated tests do not change real account passwords.

## Local test builds 0.3.42–0.3.43

- Grouped Settings modules, moved mobile import into Custom source extensions and removed the Settings Downloads shortcut.
- Added password recovery and improved mobile alignment and dialog back navigation.

## Archived release notes

### v0.3.44

Settings and source manager improvements for Windows and Android.

- Related Settings controls are grouped into fewer modules, with aligned Android controls.
- Account & sync includes password recovery using the original reset link from the recovery email.
- Source issues have warning badges and highlighted extension rows.
- Skipped-source and help disclosures keep their open/closed state during searches and rerenders.
- Source search and Browse source fields follow the app theme.
- APK List and Stacked views have distinct layouts and preserve the saved selection.
- Ineffective Files & backup layout switches are hidden on Android; desktop retains them.
- Includes the previous chapter/page compatibility fixes.

Validation: source disclosure, list/card layout, saved preferences, mobile layout, migration, recovery UI and frontend/distribution regression checks passed. Native recovery/core tests previously passed 59 tests with four live tests ignored; recovery email delivery/password changes were not exercised on a real account by the automated tests.

Extensions, extension repository links and manga content are not bundled. Users provide their own extensions. Country restrictions and website verification may still apply. Install the Android update over the existing app to preserve its data.

Assets: signed ARM64 Android APK, Windows portable EXE and SHA256SUMS. The EXE embeds the matching signed APK for local sharing.

### v0.3.41

Chapter and page loading fixes for user-installed source extensions.

- Desktop and Android can recognize the matching redirected chapter-reader layout when an extension returns no pages.
- Chapter requests no longer depend on summary or cover parsing.
- Desktop page images use the installed source’s own HTTP client and verification session.
- Reading-progress identities and storage remain unchanged.

Extensions, extension repositories and manga content are not bundled. Users provide their own extensions. Website verification may still be required.

Downloads: signed ARM64 Android APK and Windows portable EXE. The EXE includes the matching Android APK for local sharing.

### v0.3.40

Settings now shows the real installed app version in General.

Android source verification opens the actual challenged HTTPS resource using its original user agent. The browser supports verification cookies and a bounded chain of HTTPS server redirects; unrelated cross-site navigation, file access, insecure loads and TLS errors stay blocked. Challenge targets are source-scoped, memory-only and expire after 15 minutes. Cookie values are never added to logs, sync or backups.

Diagnostics on the paired phone reproduced a source domain redirect and a protected listing page. After visiting that page in the verification browser, the installed extension returned 24 titles and reading progress matched exactly before/after. 0.3.39 outside-cover dismissal and the extension-name browser link also passed on the physical phone.

Final 0.3.40 physical-phone tests passed: Settings displays the installed version; exact challenged resource and request agent are source-scoped; unrelated test sources remain isolated and are removed; cover enlargement/outside dismissal and the extension-name browser link pass in portrait/landscape. The production browser returned 24 source results before and after verification, with source skipping cleared and reading progress unchanged. Original phone timeout restored and diagnostic runner removed.

### v0.3.39

Approved preview changes are now packaged for Android and Windows.

- Tap outside an enlarged cover to return to the manga preview; tapping the image keeps it enlarged.
- The extension name opens its existing in-app source verification browser.
- Removed the Source / extension heading and APK extension label; Available is now Installed.

Validation: frontend/distribution checks, desktop/mobile custom-cover tests, mobile interaction checks and the live isolated preview tests passed. Reading progress is unchanged in cover tests.

### v0.3.38

Fixed a confirmed narrow-phone layout issue: Favorites, downloaded-chapters and trash icons now stay together when the action row wraps.

Validation: the 320px, 360px and landscape mobile interaction checks pass, including geometric adjacency of Favorites/download icons; desktop/mobile cover checks and frontend/distribution checks pass. Reading progress remains unchanged in cover tests.

Android source-browser controls now respect system bars, cutouts and the keyboard. This fixes the Return button overlapping the phone status bar.

Paired Pixel 7 validation: 0.3.37 and 0.3.38 cover enlargement, portrait/landscape preview geometry, actual native HTTPS source browser, and exact before/after reading-progress comparison passed. The 0.3.38 browser Return control is verified below the status bar. Tests opened/canceled the website session without attempting human-verification challenges. Original screen timeout was restored and temporary test components removed.

### v0.3.37

Approved preview layout is now packaged for Android and Windows.

- Cover taps enlarge artwork. Custom cover uploads remain in Find cover art.
- Search cover images and Source / extension appear below the cover.
- Cover guidance hides when a source or custom cover exists.
- Installed APK source links open the existing in-app source verification browser, with Finish/Cancel controls in the manga preview. Sites may still refuse verification.
- Start reading appears first. Remove from library is a trash icon; on mobile, the download icon follows Favorites.

Validation: frontend/distribution checks, desktop/mobile cover tests and mobile interaction/layout checks passed in the isolated preview. Cover tests preserve reading progress. No source extensions, repositories or manga content are bundled.

### v0.3.36

Mobile cover warnings and the Show cover warning button now appear below the cover art in the manga preview. Source information remains beside the cover. Added guidance explaining that users can add their own cover through Search cover images; guidance respects the cover-search visibility setting.

Validation: frontend/distribution checks, desktop/mobile custom-cover tests (including warning placement, hide/show, upload and unchanged reading progress), and mobile interaction/layout checks passed.

### v0.3.35

Search cover images is available directly in saved manga previews, independent of cover-loading warnings. Settings > General > Cover image search toggles its visibility (enabled by default); save preferences to apply.

Library now has a + category-management button before Default on desktop and mobile. The old General categories button has moved to that shortcut. Visible category, chapter-order, migration, and cover labels were checked for spelling.

Validation: frontend/distribution checks, desktop/phone cover search preference and retry tests, mobile/tablet/desktop layout tests, category creation/rename/delete, smooth swipes, and migration layout checks passed. Reading progress is unchanged in the cover tests.

### v0.3.34

Retry source cover has moved from the manga preview warning into the Find cover art dialog. Clicking it closes the dialog and retries the source cover. Search cover images and Hide warning remain in the preview.

Validation: frontend checks and desktop/phone-width cover tests passed, including an actual retry request from the new location and unchanged reading progress. No extensions, repository links, or manga content are bundled.

### v0.3.33

Missing-cover Library taps open the manga preview. Only the preview cover offers custom-cover upload.

The cover warning now includes Search cover images between Retry source cover and Hide warning. Search Google Images for the title, save an image in the browser, then return and choose the saved image. Saved covers persist, are included in backups, and use account sync across desktop and Android.

Validation: paired Pixel 7 cover-tap test passed on 0.3.32 with reading progress unchanged. Desktop and phone-width headless cover/search tests passed. No source extensions, repository links, or manga content are bundled.

### v0.3.32

# Mreader 0.3.32

## Downloads

- Android ARM64 APK
- Windows portable EXE

Sign into GitHub with repository access to download.

## Cover tap fix

Tapping a manga without cover art in Library now opens its preview on Android and desktop. Cover upload is available only by tapping the cover inside that preview. Reading progress and installed sources are unchanged.

Frontend, phone/desktop cover interaction and mobile layout regressions passed. Tests verify Library taps do not upload, preview taps still open the image chooser, and reading progress stays unchanged. Physical phone testing is pending.

Install the APK over your current app; do not uninstall. The Windows EXE bundles this exact signed APK for local QR download. Compare files with the attached SHA256SUMS. Linux assets are added after their own packaging checks pass.

### v0.3.31

# Mreader 0.3.31

A cleaner Browse page and a Settings Source manager with user-driven browser verification.

## Downloads

| Device | Download |
| --- | --- |
| Android ARM64 phones and tablets | Android APK |
| Windows 64-bit | Portable EXE |
| Linux | Matching DEB / AppImage packages are added after their build and packaged-app checks pass. |

Installation guide · Source manager details

Sign into GitHub with repository access to download these private assets.

## What changed

- Browse hides the source dropdown and skipped-source notice.
- The Source manager in Settings → Sources on desktop, and More on Android, contains source filtering, status, Retry and Re-enable controls.
- Website-based APK sources can open a verification browser. Complete any challenge yourself, return to Mreader, and choose Finish verification and retry. The source is enabled only if its search succeeds.
- The desktop browser shares only its source-bound session cookies with extension networking. Remote source pages cannot invoke reader commands. Popups, downloads and unrelated top-level navigation are blocked.
- Android uses a separate verification dialog sharing the extension cookie store, with no reader JavaScript bridge.

Verification is user-driven, may still be rejected by a website, and does not remove country restrictions. Source choices and installed extensions remain intact; skip decisions stay device-local. No extension catalogs or packages are supplied by Mreader.

## Native desktop verification

An isolated copy of the desktop library and installed sources loaded 20 manga and automatically skipped real verification and country failures. Two app restarts retained skip state. Native search tracing confirmed skipped sources were omitted from All. Real Retry, Re-enable and a subsequent failure behaved correctly.

The native browser opened entirely on display 2 without changing foreground focus. Reader IPC was denied from the source page and a benign test cookie transferred into the extension session. The source runtime closed cleanly. All 232 original reading-progress records matched their pre-test snapshot. Actual challenge completion remains a user step.

JavaScript, distribution-policy, mobile/desktop manager, download and continuous-reader checks passed. Android compiled and signed successfully; physical Android testing is pending. The Windows EXE bundles this exact signed APK.

## Update

Install Android over the existing app; do not uninstall first. Close Mreader before replacing the Windows EXE. Source website sessions stay on the device and are not shared through account sync or metadata backups. Checksums are attached as `SHA256SUMS`.

### v0.3.30

# Mreader 0.3.30

Automatically skip unavailable sources in All installed sources, without uninstalling them.

## Downloads

| Device | Download |
| --- | --- |
| Android ARM64 phones and tablets | Android APK |
| Windows 64-bit | Portable EXE |
| Linux | Matching DEB / AppImage packages are added after their build and packaged-app checks pass. |

Installation guide · Distribution policy

Sign into GitHub with repository access to download these private release assets.

## Automatic source availability

- A source that fails in Browse is automatically omitted from subsequent All installed sources requests.
- Country restrictions, browser verification, and other source failures stay skipped until a successful retry, manual re-enabling, or a newer installed extension version.
- Network and server failures use a five-minute cooldown. A device-wide offline error does not permanently disable its sources. Empty search results alone never disable a source.
- Skipped sources remain installed and listed in the source dropdown. Selecting one directly performs a fresh check; success enables it again.
- Source availability controls provide **Retry source** and **Re-enable**. Find them in Settings → Sources on desktop and More → Source availability on Android. Browse also shows recovery controls in its compact skip notice.

Availability is saved locally for each device and account profile, since connections and country availability can differ. It is not synced or included in metadata backups. Library entries, downloaded manga, installed extensions, and reading progress are preserved. Users still provide and verify their own repositories.

## Update and validation

Install Android over the existing app; do not uninstall first. Close Mreader before replacing the Windows portable EXE. The desktop app bundles this exact signed APK for five-minute local QR downloads.

JavaScript and distribution-policy checks passed. Phone/desktop tests cover persistence after reload, profile isolation, extension-version changes, cooldown expiry, offline protection, empty results, recovery controls, all-skipped behavior without network requests, and preservation of installed extensions and reading progress. Reader, download, source-merge, and mobile layout regressions also passed. Signing and exact embedded APK checks run during packaging. Physical phone testing is still pending.

Compare downloads with the attached `SHA256SUMS` file. Source restrictions are not bypassed.

### v0.3.29

# Mreader 0.3.29

Keep browsing when an individual source is unavailable.

## Downloads

| Device | Download |
| --- | --- |
| Android ARM64 phones and tablets | Android APK |
| Windows 64-bit | Portable EXE |
| Linux | Matching DEB / AppImage packages are added after their build and packaged-app checks pass. |

Installation guide · Distribution policy

Sign into GitHub with repository access to download these private release assets.

## What changed

- Replaced long combined source exception messages with a compact, collapsible source-status notice.
- Healthy manga results stay visible when other sources require browser verification, are unavailable in your country, time out, or cannot be reached.
- **Retry failed sources** contacts only those sources and preserves existing results and pagination.
- Cached Browse views retain source-status information. Single-source Browse shows the appropriate status and clears it after a successful load.
- All installed sources remains the Browse default on Android and desktop.

This update improves error handling. It does not bypass source verification or country restrictions, and it does not automatically disable or flag extensions. Users continue to supply and verify their own repositories.

## Update and validation

Install Android over the existing app; do not uninstall first. Close Mreader before replacing the Windows portable EXE. The desktop app bundles this exact signed APK for five-minute local QR downloads.

JavaScript checks, distribution-policy checks, and headless phone/desktop tests passed. Dedicated cases verify partial failures, readable status messages, failed-only retry, preservation of healthy results, cache restoration, single-source recovery, and unchanged reading progress. Mobile layout and interaction regressions also passed. APK signing and the exact APK embedded in Windows are checked during packaging. A physical phone test is still pending.

Compare downloads with the attached `SHA256SUMS` file. Downloaded manga pages remain separate on each device.

### v0.3.28

# Mreader 0.3.28

Browse all of your installed sources by default on Android and desktop.

## Downloads

| Device | Download |
| --- | --- |
| Android ARM64 phones and tablets | Android APK |
| Windows 64-bit | Portable EXE |
| Linux | Matching DEB / AppImage packages are added after the packaging and verification workflow passes. |

Installation guide · Distribution policy

This repository is private. Sign into GitHub with repository access to download.

## What changed

- Android and desktop Browse default to **All installed sources**, even with one eligible source.
- Account sync and initial source preparation retain the default instead of switching Browse to a single source.
- You can still choose an individual source from the dropdown. Existing English-language filtering and progressively loaded results remain.
- On desktop, clicking a missing cover in Library opens manga details. Custom cover uploads are available inside that panel.

## Updating

Install Android over the existing app; do not uninstall first. Close Mreader before replacing the Windows portable EXE. No database or account migration is required.

The desktop EXE bundles this exact signed Android APK for the five-minute local QR download. Downloaded manga pages remain separate on each device. Mreader provides no extension packages or repository links; users obtain and verify their own sources.

## Validation

JavaScript checks, the extension distribution-policy check, and headless phone/tablet and desktop tests passed. Tests cover all-source defaults at startup and after sync, individual source selection, cover upload inside details, Library click behavior, and unchanged reading progress. Release APK signing and the desktop’s bundled APK are checked during packaging.

Compare downloads with the attached `SHA256SUMS` file. Linux assets are pending until their own build and packaged-app validation complete.

### v0.3.27

# Mreader 0.3.27

Mreader publishes the reader application. Users obtain and verify their own extension repositories.

## Downloads

| Device | Download |
| --- | --- |
| Windows 64-bit | Portable EXE |
| Android ARM64 phones and tablets | Android APK |
| Linux | Matching DEB and AppImage packages are added after build and packaged-app checks pass. |

Installation guide · Distribution policy

This repository remains private. Sign into GitHub with repository access to download.

## Changes

- Removed built-in third-party repository links, URL shortcuts, and pretrusted repository signing keys.
- Removed the bundled working example extension and its installation command.
- New repositories require an independently obtained index URL and verified signing fingerprint.
- Existing user-added repositories, installed extensions, account data, and reading progress are retained.
- Documentation and automated tests no longer provide catalog download links. Optional live tests require externally supplied fixtures.

Mreader does not distribute extension packages, recommend catalogs, or provide manga content. Source availability depends on the user-selected provider and extension author. Account sync and migration can prepare sources only from repositories the user has already supplied.

## Update

Install Android over your current app; do not uninstall first. Close Mreader before replacing the Windows executable. Downloads are stored separately on each device. The Windows executable bundles this exact signed Android installer for five-minute local QR-code sharing.

Checksums are attached as `SHA256SUMS`. Older releases and tags have been removed. Published Git history has been sanitized of the third-party extension repository links. Existing clones or GitHub caches may retain earlier copies.
