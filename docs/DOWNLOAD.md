# Download Mreader

[Open the 0.3.44 release page](https://github.com/OReid60/mreader/releases/tag/v0.3.44)

This repository is private. Sign into a GitHub account with repository access to download release assets.

| Device | File | Installation |
| --- | --- | --- |
| Windows 64-bit | `Mreader-0.3.44-portable.exe` | Download and run. No installer required. |
| Android phones and tablets, ARM64 | `Mreader-0.3.44-arm64.apk` | Open the APK and allow installation from your browser or file manager when Android asks. Requires Android 8.0 or later. |
| Linux | DEB / AppImage | Published after the matching Actions build and packaged-app checks pass. Check the release assets for availability. |

## Updating

Close Mreader before replacing the Windows executable. On Android, install over the current app; do not uninstall first. Keep a backup of your library before major changes.

## First launch

- Import local manga, or add your chosen repository under **Settings → Sources** and install an extension.
- Sign in with the same Mreader account on each device for sync.
- Download chapters on each device before reading offline. Account sync does not transfer downloaded manga pages.

## Install Android from the desktop app

In desktop Settings, open **Mobile app → Generate download code**. Connect the phone and desktop to the same local network, scan the QR code, and download the bundled APK. Keep Mreader open during the transfer. The link expires after five minutes; use **Regenerate download code** for a new link.

## Verify a download

Release assets include `SHA256SUMS`. Compare the downloaded file’s SHA-256 with its entry. On Windows, use `Get-FileHash -Algorithm SHA256 <file>`; on Linux, use `sha256sum <file>`.

## Need help?

[Report an issue](https://github.com/OReid60/mreader/issues) with the app version, device, source name, and error message. Do not include passwords or account tokens.
