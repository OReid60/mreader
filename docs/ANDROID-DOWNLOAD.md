# Android download from desktop Settings

Open **Settings → Mobile app → Generate download code** and scan it with a phone
camera. The QR opens a temporary page served by this computer. Tap **Download APK**.
Both devices must be on the same Wi-Fi/local network, and desktop Mreader must
remain open until the transfer finishes. No public download host or internet
connection is needed for the transfer.

The desktop bundles the matching signed ARM64 installer. Install over the existing
app to retain its data. Packaging rejects a missing version-matched APK rather
than silently using the old 0.3.9 installer.

Codes expire after five minutes even if the UI is minimized. The expired QR/link
is hidden and a **Regenerate download code** button appears. Regenerating creates
a new token and invalidates the old link. **Stop sharing** invalidates it early.
The listener serves only the APK and its landing page, checks the random token,
and accepts private-network peers. An already-started transfer may finish.

Windows must allow inbound connections for the current Mreader executable. The
optional administrator script `scripts/enable-local-apk-sharing.ps1` creates a rule
for that executable, limited to local-subnet peers. It does not disable the firewall.

On Android 17, the browser may also need local-network permission. In this test,
Chrome's effective ACCESS_LOCAL_NETWORK operation was blocked although the nominal
permission appeared granted. With the user's approval, only that local-network
operation was allowed; Nearby Wi-Fi and Bluetooth operations stayed blocked.
See [Android's local-network permission guide](https://developer.android.com/privacy-and-security/local-network-permission).

Verification on Pixel 7: the actual Chrome page and APK button loaded, a complete
15,960,192-byte APK transfer matched the bundled signed installer, and regeneration
invalidated the previous link. Native expiry tests use the same server loop with
a shortened test lifetime and assert the production lifetime is 300 seconds.
