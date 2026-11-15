# Desktop preferences (0.3.9)

Use the menu button at the top of the left sidebar to collapse or expand it.
The collapsed sidebar retains navigation icons, tooltips, Import files and
Settings. Account status sits at the bottom of that sidebar.

In Settings, choose a **Startup page** and save preferences. Library, Updates,
History, Browse and Downloads are supported. The selection takes effect on
the next app launch. Startup page and sidebar width are preferences for this
device; they do not change another device's layout.

Sources are added by the user in Settings. Paste your own extension repository
URL under APK source extensions, or import a native JSON manifest. There are no
preset repository buttons or example-extension installers in the normal UI.
Browse lists installed extensions and a Komga server only when configured.
An empty source list links to Settings. Existing installed extensions and
library entries are preserved, and account source synchronization still works.

For learning: Rust's Settings type uses serde defaults for the new fields so
older saved preferences can still load. The startup page is validated before
writing it to SQLite. The sidebar uses one CSS class for its compact state;
JavaScript updates the saved setting and renders the matching class.
