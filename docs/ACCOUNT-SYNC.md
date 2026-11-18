# Managed account sync

The app implements managed account sign-up/sign-in, secure desktop session storage, token refresh, per-account local profiles, automatic sync, and sign-out. It does not run a sync host on the user's devices. A managed Supabase project supplies the shared Auth and database service.

The Mreader managed project is configured in `cloud/project.json` using its public publishable key. The supplied schema has been deployed. Live checks verified that email/password sign-up is enabled, email confirmation is required, and anonymous requests cannot read the sync table or execute the commit function. Signed-in synchronization between physical devices still needs an account/device test.

## One-time application setup

1. Create or select a Supabase project under your control.
2. Run [cloud/schema.sql](../cloud/schema.sql) in that project's SQL editor.
3. Enable email/password authentication and choose the email-confirmation policy.
4. In Mreader Settings, expand **Managed service setup** and enter the HTTPS project origin and its public publishable/anon key. Never use a secret or service-role key.
5. Configure the same project on every supported client build. Create an account or sign in. If confirmation is enabled, verify the email before signing in.

Ordinary users of this configured build only need to create an account, confirm their email, and sign into the same account on each device. No device needs to run or expose a server. The setup steps above describe configuring a different managed project.

## Password recovery

In **Settings → Account & sync → Forgot password?**, request a recovery email. Copy the original password reset link from that email, paste it into Mreader, and enter and confirm the new password. Opening the link in a browser first may consume it; request a fresh email if the link is expired or already used.

The native client requests `/auth/v1/recover`, verifies the recovery token through `/auth/v1/verify`, then updates the password through `/auth/v1/user`. Only HTTPS recovery links for the configured project are accepted; unrelated hosts, non-recovery links, duplicate tokens and access-token fragments are rejected. The supplied link is parsed locally, never followed as an arbitrary URL. The recovery session is not saved or substituted for the reader's active session, and no library/profile/progress switch occurs.

Reset links and passwords are held only for the operation, are not written to preferences or backups, and are cleared from the form on success or when the dialog closes. Headless UI tests use mocked responses; they do not send real recovery emails. A live end-to-end mail-delivery/password-change check is still required before claiming production recovery has been verified.

## Data and conflict handling

Each account has one RLS-protected row keyed to `auth.uid()`. SQL grants only authenticated owner access. A compare-and-swap RPC checks `revision` before committing; conflicting writes cause the client to fetch, merge, and retry up to four times.

Documents use `schemaVersion: 1` and contain `books`, `progress`, `extensions`, `sourceChoices`, and deletion tombstones. `sourceChoices` stores independent timestamped APK subscriptions plus the active Browse source. APK subscriptions contain the package, repository URL, trusted signing fingerprint, and required version; each device validates and downloads its own copy. No new SQL deployment is required for this field. Metadata and source definitions carry update timestamps. Progress merges by chapter, preserving the newest page position and completed status. A deletion newer than the corresponding record prevents stale clients from resurrecting it. Local changes made during an in-flight sync remain in SQLite and win against older returned state.

Native session tokens use Windows Credential Manager, Android Keystore encryption, or the Linux credential service. Passwords are sent directly to the configured account service over HTTPS and are not retained. Public service configuration is saved separately from library backups. Guest and account databases are separate; switching accounts does not silently upload or mix the guest library. Signing out revokes the current device's remote session when reachable and restores its guest library.

While signed in, progress changes queue sync after 1.5 seconds without further changes. The client also polls every 30 seconds and syncs on startup. Offline changes stay local and retry after connectivity returns. **Sync now** is available before switching devices. Keep device clocks correct: metadata conflict resolution uses UTC timestamps.

Sync excludes credentials, device paths, local manga bytes, and download locations. Each device must import its own matching local files or download online chapters. Supabase row-level security is supplied as SQL; applying it and verifying isolation on the real project remain deployment requirements.

## Validation scope

Tests exercise two-device state merging, deletion propagation, preservation of device files, stable archive identities, profile isolation, and the managed REST compare-and-swap protocol using a local HTTP fixture, including a concurrent-write retry. This is not a substitute for a live managed-project test or Android real-device verification.
