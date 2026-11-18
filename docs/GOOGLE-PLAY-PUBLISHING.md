# Mreader — Google Play publishing pack

Assessment date: 2026-11-18. Build inspected: 0.3.46, package `app.mreader.desktop`, version code 3046. This pack prepares a Google Play submission; it is not a submission or approval. Other Android stores have different rules.

## Readiness verdict

**Not ready to submit the current APK to Google Play.** Target SDK is current, but downloadable executable extensions are a policy blocker. Privacy/account deletion, store assets, declarations, and Play packaging remain incomplete. A separate Play-compatible edition is the recommended route; keep the current full extension-enabled edition in private distribution. User-supplied extensions and disclaimers alone do not resolve policy compliance or content-rights obligations.

## Evidence and actions

| Area | Finding for 0.3.46 | Required action |
| --- | --- | --- |
| Target API | `compileSdk=36`, `targetSdk=36`, `minSdk=26` in Android Gradle config. Meets current phone/tablet target requirement. | Recheck at upload time. |
| Packaging | Signed ARM64 APK exists; no submission AAB was found in release output. | Produce and validate a release Android App Bundle and enroll in Play App Signing. |
| Executable extensions | `ExtensionHost.kt` loads extension APK classes through `DexClassLoader`; the app supports downloading these APKs from external repositories. | Remove this entire download/load path and associated dependencies from the Play build. A hidden switch is insufficient. Do not assume the interpreter exception covers Android DEX access. |
| Updates | No general automatic updater is shipped. | Play edition must update through Google Play; use Play In-App Updates if desired. Keep direct APK updates restricted to non-Play distribution. |
| Accounts | Sign-up, sign-in and managed cloud sync exist. No account-deletion UI/API was found in reviewed app code. | Add an in-app deletion request path and a public working web deletion-request page; implement removal of Auth identity and associated cloud data, with retention rules. Signing out is not deletion. |
| Privacy | Cloud document contains library metadata, progress, categories, source choices and custom-cover data/references. Authentication uses email and account identifiers. No verified public privacy-policy endpoint was established. | Publish a public, accessible privacy policy and link it in-app and in Play Console. Complete an accurate Data safety assessment, including service providers and logs. |
| Native 16 KB pages | All three packaged ARM64 libraries have ELF LOAD segment alignment of 16384: mreader, QuickJS and zstd. This is a static check only. | Validate ZIP/bundle alignment with current Android tools and run the final Play build on a 16 KB emulator/device. This inspection does not certify runtime compatibility. |
| Background downloads | Manifest declares dataSync foreground service, notifications and wake lock. DownloadService shows ongoing progress and implements `onTimeout`. | Complete the foreground-service declaration with purpose and demonstration video. Verify user initiation, notification behavior and timeout handling for the final build. |
| Content and rights | No source lists or manga are bundled. Users can import files and install sources; unrestricted sources can expose copyrighted or adult content. | Design a compliant Play scope and review source access, content safeguards and rights. Use only owned/licensed/public-domain material in listing assets. No assurance of approval follows from disclaimers. |
| Phone/tablet quality | Previous phone tests and responsive layout checks exist. | Run Play pre-launch reports and accessibility, tablet, rotation, offline, account, deletion, background-download and restore tests on the final Play edition. |
| TV | Manifest includes Leanback launcher support, but TV quality is not assessed. | Remove TV targeting from the phone/tablet Play edition unless separately validated with required TV assets. |
| Account eligibility | Play Console account status is unknown; no account was accessed. | Complete identity verification, applicable registration/payment steps, contact details and any organization verification. For eligible new personal accounts, closed testing requires at least 12 continuously opted-in testers for 14 days before requesting production access. |
| Signing continuity | Existing privately signed installs are being updated in place. | Plan Play signing carefully before enrollment. Existing users need compatible app signing certificates/package identity to update without uninstalling; upload-key identity alone is not sufficient. Never commit keystores or credentials. |

## Recommended submission sequence

1. Create a Play build flavor that excludes external executable-extension downloading/loading and direct self-update paths. Keep authorized local-file reading, library, backups and sync as appropriate.
2. Implement and test account/data deletion. Set up public privacy and deletion URLs with truthful retention details and a real support contact.
3. Review dependency licenses and notices, security, content rights and safeguards. Choose a package/signing strategy before the first Play upload.
4. Build a signed release AAB with increasing version code; validate native/bundle alignment and 16 KB runtime behavior.
5. Finish listing assets, App access instructions, Data safety, ads declaration, target audience, content rating and foreground-service declarations. Do not claim an age rating before completing the questionnaire.
6. Use internal testing and the pre-launch report, then the applicable closed-test/production-access process. Provide reviewer access to account features without supplying personal credentials in this document.
7. Resolve review findings and submit for production only after the gaps above are closed. Google decides eligibility and approval.

## Draft Google Play store listing

Use this copy only after checking that every feature remains present in the final Play edition. It intentionally does not advertise downloadable APK extensions.

**App name** (30-character maximum):

Mreader

**Short description** (80-character maximum):

Read your manga, organize your library, and sync progress across devices.

**Full description** (4,000-character maximum):

Mreader brings your manga library and reading progress together on Android phones and tablets, with a companion desktop reader.

READ YOUR WAY
Enjoy fullscreen reading with single-page and continuous-strip layouts. Choose your reading direction and chapter order, reveal controls with a tap, and resume where you left off.

ORGANIZE YOUR COLLECTION
Group manga into categories, keep Favorites close, and find recent reading in History and Continue reading. Import supported local manga files you own or have permission to read.

PREPARE FOR OFFLINE READING
Save supported chapters to your device and follow download progress in Downloads. Background transfers can continue while you use another app or turn off the screen, subject to Android system restrictions. Download chapters on each device before going offline.

KEEP YOUR PLACE
Optionally sign in with the same Mreader account on Android and desktop to sync your library metadata, reading progress and custom covers. Downloaded manga pages are stored separately on each device and are not transferred by account sync.

BRING YOUR LIBRARY WITH YOU
Create backups of your library, progress, preferences and custom covers. Preview compatible Mihon or Tachiyomi backups before importing. Manga files are not included in metadata backups.

Mreader does not include manga content. Import and access only material you are authorized to use. Feature availability may differ between platforms and distribution editions.

## Listing assets and owner-supplied fields

- App icon: 512 × 512 PNG, following Google's current icon specifications.
- Feature graphic: 1024 × 500 JPEG or 24-bit PNG without alpha.
- At least two compliant screenshots; prepare accurate phone and tablet screenshots for supported form factors. Use licensed sample content, not the user's real library/account.
- Suggested captions: Your library, your way; Read without distractions; Keep your place across devices; Prepare for offline reading; Bring your library with you.
- Developer display name: **OWNER TO SUPPLY**.
- Support email and public support website: **OWNER TO SUPPLY**.
- Public privacy-policy URL: **NOT DEPLOYED/VERIFIED**.
- Public account-deletion request URL: **NOT DEPLOYED/VERIFIED**.
- Category suggestion: Comics; confirm in Play Console.
- Ads, pricing, countries, audience and rating: owner decisions plus accurate final-build declarations; do not guess.
- Reviewer instructions: document local-file import and provide authorized sample content. Supply a dedicated reviewer account privately through Play Console if account access is needed.

A private GitHub README is not an adequate public privacy-policy or deletion page.

## Data safety preparation — not final answers

Inventory the final build and backend before completing the form:

| Data flow | Known use | Review before declaring |
| --- | --- | --- |
| Email and account/user ID | Account authentication, recovery and matching sync profiles | Required vs optional account use, retention and deletion; authentication provider handling. |
| Library, reading history/progress, categories, preferences and source choices | Cross-device sync | User-content/app-activity classifications, collection purposes and service-provider treatment. |
| Custom cover images | Optional cover sync and backups | Photos/images classification, retention and deletion. |
| Network requests to selected sources | Search, metadata, images and browser verification | IP address, user agent, cookies, source-side collection and any diagnostics/logging. |
| Local imports and downloads | Local reading | Distinguish on-device storage from data actually sent off-device; do not classify all local files as uploaded. |

Do not claim “no data collected” or “email only.” Sync requires storing data. Passwords are handled by the authentication service; verify the complete authentication, token, transport and storage design instead of promising that no account data is stored. No full network/SDK privacy audit was performed for this document.

## Official sources checked

- [Target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878)
- [Device and Network Abuse — executable code and updates](https://support.google.com/googleplay/android-developer/answer/16559646)
- [Account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)
- [User Data and privacy disclosures](https://support.google.com/googleplay/android-developer/answer/10144311)
- [Android App Bundles](https://developer.android.com/guide/app-bundle)
- [16 KB page-size compatibility](https://developer.android.com/guide/practices/page-sizes)
- [New personal account testing](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Store listing fields](https://support.google.com/googleplay/android-developer/answer/9859152)
- [Preview assets](https://support.google.com/googleplay/android-developer/answer/9866151)
- [Foreground-service declarations](https://support.google.com/googleplay/android-developer/answer/13392821)
- [Intellectual property](https://support.google.com/googleplay/android-developer/answer/9888072)
- [Inappropriate content](https://support.google.com/googleplay/android-developer/answer/9878810)

Policy pages and Console requirements change. Recheck these official sources immediately before submission. No Play Console upload, account purchase, policy deployment or compliance-related app behavior change was made during this assessment.
