# Source manager and user-driven verification

Browse hides source filtering and skip notices. Settings → Sources on desktop,
and More on Android, contains the Source manager. Its filter selects All or an
individual installed source for the current session. Skips, retry and re-enable
controls live here. Installed extensions and reading progress are not removed.

Website-based APK sources can open a verification browser. The user completes
any challenge or sign-in, returns to the manager, and selects Finish verification
and retry. A successful source search clears its skip. Country restrictions and
sites that reject embedded browsers remain restrictions; no challenge is solved
automatically.

On desktop, the browser uses the source's own user agent and a local verification
profile. Navigation is limited to its HTTPS origin (including its www alias),
popups and downloads are denied, and all reader IPC commands reject non-main
webviews. Finishing transfers only cookies returned for that source URL to the
extension's existing cookie store. Mreader does not return cookie values to its frontend or write them to its
logs, account sync, or metadata backups. Closing the reader destroys verification
windows so they cannot keep its runtime alive.

Android uses a separate WebView dialog with no JavaScript bridge. It shares the
same CookieManager as extension networking, rejects TLS errors and unrelated
main-frame navigation, and provides a return-to-manager button. Finish flushes
the shared cookies and retries the source.

The desktop session helper is our own 4 KB Java agent, not a source extension.
It runs inside the already required compatibility JVM. Its daemon socket binds
only loopback and requires a random per-runtime secret supplied through the
child environment. It validates cookie origins and count/frame bounds. The
checked-in helper JAR contains a Source-SHA256 manifest entry. Rebuild after
editing its source with `scripts/build-source-session-agent.ps1` and a JDK.

Availability preferences remain device/profile-local; no installed repository
catalog or source APK is distributed by Mreader.

## Native desktop validation for 0.3.31

An isolated copy of the installed source registry and library loaded 20 manga
while automatically skipping real verification and country failures. After a
restart, the skipped source was omitted from native search calls. A real Retry
kept an unavailable source skipped; Re-enable cleared the skip; checking it again
restored the skip. A second restart retained that state. The source runtime
closed cleanly between runs.

The native verification browser opened on display 2 without changing the
foreground window. A benign test cookie transferred to the existing extension
cookie store, and the source webview could not invoke reader commands. This
validates session transfer, not completion of an actual website challenge.

All 232 original reading-progress records matched the pre-test snapshot after
the isolated tests. Local test traces and copied user data remain ignored and
are not release assets. Android dialog behavior was compile-checked and covered
by shared UI tests; physical Android testing is pending.
