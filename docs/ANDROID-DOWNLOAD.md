# Android download from desktop Settings

Open **Settings → Mobile app → Generate download code** and scan it with a phone
camera. The QR opens the public HTTPS download page. Tap **Download Android APK**.
Your phone needs internet access; it does not need the same Wi-Fi, GitHub access,
or a running desktop computer after the QR is scanned.

The page provides the latest published signed ARM64 Android installer.
Install over the existing app to retain its data. Desktop and Android version
numbers are independent.

The desktop QR generator uses a fixed HTTPS destination and does not start a
local listener. Refreshing produces the same destination. The page remains
available until it is unpublished; the desktop does not impose a ten-minute
expiry. Source code remains in its private repository.
