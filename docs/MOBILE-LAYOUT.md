# Mobile Library layout (0.3.1)

The phone Library follows the supplied Mihon reference: warm dark colors, a compact toolbar, Default/nsfw tabs, three cover columns, overlaid titles and unread badges, and Library/Updates/History/Browse/More bottom navigation. Wider Android tablets use five columns. The account and extension controls are under More.

Open a saved title and select **Move to nsfw** or **Move to Default** to assign its category. Assignments are stored with book metadata and participate in the existing account-sync protocol. A reserved metadata tag keeps this compatible with older clients; the tag is hidden from displayed genres. Reimporting a local manga preserves its assignment.

`mobile.js` contains the mobile renderer and interaction handlers. `app.js` chooses the renderer and keeps the existing reading/source logic shared. Mobile CSS is scoped under `.mobile-layout`. `npm run test:mobile` uses a hidden browser with synthetic covers to check category switching, moving books, search, account access, three columns, overflow, and desktop isolation. Set `MREADER_TEST_BROWSER` to a compatible Chromium/Edge executable on another machine.

The Android update uses the original package identifier and signing key, with version code 3001. Install it over 0.3.0 to retain the installed app's data. Physical-phone layout confirmation and live cross-device sync testing remain separate checks.
