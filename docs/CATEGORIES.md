# Library categories (0.3.8)

Open **Library → + Categories** to create your own groups, such as Action,
Romance, or To read. On phones, **Library → ⋮ → Manage categories** opens the
same manager. Tap a category tab to view its titles; scroll the tabs sideways
when there are several groups.

Open a saved manga's details and tap **Category: …** to move it to a group.
Each title has one category. Default contains uncategorized titles and cannot
be renamed or deleted. Existing nsfw assignments are preserved.

The manager can rename a group or delete it after confirmation. Renaming moves
its assigned titles with it. Deleting moves them to Default without removing
manga or progress. Empty categories and assignments sync through the existing
Mreader account; both devices should run 0.3.8 or later. No database changes in
the Supabase dashboard are required.

For readers learning the implementation: `categories.rs` validates names and
updates the local SQLite library in one transaction. Assignments use reserved
book tags so source refreshes preserve them. The cloud document merges category
definitions and deletion timestamps independently, allowing empty groups to
sync while preventing an older device snapshot from reviving a deleted group.
The JavaScript renders the manager and category tabs from the Rust snapshot.
