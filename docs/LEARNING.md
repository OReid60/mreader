# Learning with Mreader

Start with one small change, run it, and observe what changed. You do not need to understand the entire app first.

## Follow one action through the code

When you turn a page, `turnPage()` in `app.js` changes the reader's page number and calls `displayPage()`. That function loads the image and calls `api("save_progress", ...)`. Tauri carries that request to the Rust `save_progress()` command in `src-tauri/src/lib.rs`. The command checks that the chapter exists, then `Store` writes the progress into SQLite in `src-tauri/src/store.rs`.

This is the UI → command → database pattern. JavaScript handles interaction; Rust validates requests and owns persistent data. Treat the Rust command as the boundary where inputs must be checked, even when they came from your own UI.

## Read these Rust ideas in context

- `Result<T, String>` means the operation returns a value of type `T` or an error message. `?` returns early on an error, so the successful path stays readable.
- `Arc<Core>` lets multiple commands share the app's core without copying the whole library. A `Mutex` protects data that several tasks may change.
- `async` and `await` let the program wait for network or disk operations without freezing the interface. They do not automatically make CPU-heavy work fast; archive processing uses a blocking worker.
- `#[cfg(target_os = "android")]` selects code when compiling for Android. The common reading and sync logic stays shared, while credentials and file pickers use the platform's facilities.

## A small exercise

Find the text “Your next chapter” in `index.html`, change it, and run `npm run check`. Then build the app with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/desktop.ps1 build`. A JavaScript syntax check catches invalid code, but it cannot prove the layout looks good; that needs a running app.

Next, follow `favorite()` from `app.js` into the Rust command and then the store. Before changing it, write down what you expect to happen. Make one change and check your prediction.

## Build versus package versus deploy

- A **build** compiles the program for a specific operating system and processor.
- A **package** wraps the build into an EXE installer, APK, DEB, or AppImage.
- A **deployment** configures the shared online service. Shipping the sync code does not create the Supabase database; its schema and access policies must also be applied.

Progress sync uses a revision number to avoid overwriting another device's newer work. Think of a save request as “save this only if the server is still at revision 12.” If another device saved revision 13 first, the app fetches it, merges changes, and retries.

The 0.3.4 sync fix illustrates a second boundary: valid JSON is not always valid database input. Local progress identities used a NUL separator between book and chapter IDs. JSON can encode that separator as `\u0000`, but PostgreSQL `jsonb` rejects it. The Rust serializer now encodes the pair as printable base64url text for transport and reconstructs the local identity when reading it. This preserves existing local positions without changing the database schema. Both devices should run 0.3.4 or later before testing progress sync.

Never put a Supabase service-role key or account password into frontend code. Public project keys identify the service; database row-level security decides which signed-in user can access a row.

## Check compatibility with evidence

An APK can compile successfully and still fail on some devices. Our first native library used 4 KiB ELF alignment. Android also supports devices with 16 KiB memory pages, so `src-tauri/build.rs` adds the NDK linker flags for both maximum and common page sizes. Validate the compiled library with `llvm-readelf` and the final APK with `zipalign -c -P 16 4`. These checks complement, rather than replace, a device test.

Reference: [Android's page-size guidance](https://developer.android.com/guide/practices/page-sizes).

## Git and remote builds

`git add` selects files for the next snapshot. `git commit` records that snapshot locally. `git push` uploads committed history to the private repository. Ignored files, such as local manga and signing keys, are not part of that history.

The workflow in `.github/workflows/packages.yml` runs on a fresh Linux machine. It installs dependencies, prepares the interface assets, runs checks, and produces installers. Build order matters: Rust embeds the interface files, so they must exist before compiling native tests. The resulting DEB and AppImage files are uploaded as an Actions artifact, separate from the source commit.
