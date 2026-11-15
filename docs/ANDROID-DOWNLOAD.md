# Android installer from desktop Settings

Open **Settings → Mobile app → Generate download code**. Connect the phone
and computer to the same Wi-Fi/local network, scan the QR code, and download
the APK. The link works without access to the private GitHub repository.
Install over an existing Mreader installation to keep its data.

Sharing starts only after the button is pressed. The Rust worker serves only
the bundled APK, behind a random link, for ten minutes. **Stop sharing** ends
new downloads; closing Mreader also ends sharing. If there are several local
network adapters, choose the computer address reachable by the phone.

The bundled Android installer is the signed ARM64 0.3.9 release. Its SHA-256 is
checked before desktop builds, and the desktop packages embed the verified
bytes. The installer is independent of desktop version numbers.

To update the bundled mobile release, update the version/hash in both
`scripts/prepare-mobile-apk` helpers and the displayed/server version constants,
then replace `resources/mobile/Mreader-android.apk` with the signed APK. APKs
are ignored by Git; private Actions downloads the pinned release with its
repository token. No account token or library data is included in a QR code.

Desktop Settings is organized into General, Account & sync, Sources, Mobile
app, and Files & backup. APK extensions have List and Stacked views; that
preference is saved on the device. Managed service configuration is fixed in
the app and cannot be changed by the settings command. Data saver stays
available in the mobile layout and is omitted from desktop preferences.
