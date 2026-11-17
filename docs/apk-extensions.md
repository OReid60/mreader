# User-provided source extensions

Mreader publishes a reader, not an extension catalog. It does not provide third-party repository links, extension downloads, recommended sources, or pretrusted repository signing keys.

## Add your own sources

In Settings → Sources, expand **Add extension repository**. Enter the HTTPS index URL you obtained independently. For a new repository, enter its signing fingerprint after verifying it independently. Mreader checks that fingerprint and rejects key changes and APK downgrades. Install only code you trust.

Existing user-added repositories retain their saved fingerprints. Account sync can prepare extensions the user previously selected on another device. Migration checks only repositories the user has already added; it does not add backup repository references automatically.

## Compatibility

Android validates APK package, version, and signer before loading it. Desktop uses a local compatibility runtime downloaded on first use. These mechanisms provide compatibility checks, not an endorsement of a repository or its content. Availability depends on the extension author and source provider.

## Testing with your own fixtures

Frontend and native tests use synthetic data. Opt-in desktop integration tests require independently supplied `MREADER_TEST_REPOSITORY`, `MREADER_TEST_FINGERPRINT`, `MREADER_TEST_PACKAGE`, `MREADER_TEST_SOURCE`, and `MREADER_TEST_QUERY` values. Run `live_user_supplied_extension` explicitly; it is ignored in normal tests and excluded from automatic CI.

For an emulator test, supply `scripts/test-android-extensions.ps1 -FixtureFile <local-json-file>`. The JSON needs `apkPath`, `package`, `versionCode`, `signingKey`, `sourceId`, and `query`. No source APKs or repository URLs are downloaded or provided by that script. Local fixture files must not be committed.

Third-party source API attribution is retained in `third-party/mihon`.
