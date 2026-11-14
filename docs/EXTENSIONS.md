# Mreader native extensions, schema v1

This document describes Mreader's native JSON extension format. The same manifest and stable identifiers work on desktop and Android. For executable Keiyoushi APKs and repository installation, see [APK extensions](apk-extensions.md). The supplied [MangaDex manifest](../extensions/mangadex.mreader.json) is a complete JSON example.

Install from **Settings → Native source extensions → Import manifest**. The review shows the declared hosts before installation. Import a newer version with the same `id` to update it. Export and uninstall are also available. Removing an extension preserves title metadata and progress so reinstalling can reconnect them.

## Contract

- `schemaVersion`: exactly `1`.
- `id`: a permanent, lowercase reverse-domain identifier. Letters, digits, `.`, `_`, and `-` only; maximum 100 characters. Never change this ID when updating an existing source.
- `name`, `version`, `language`: display metadata.
- `baseUrl`: HTTPS API origin/base path. Loopback HTTP is permitted for development tests only.
- `allowedHosts`: exact hostnames and optional `*.example.org` subdomain patterns. The apex is not included by a wildcard. Permissions apply to API requests, covers, page images, and every redirect destination.
- `search` and `chapters`: endpoint `path`, JSON Pointer `items`, optional JSON Pointer `total`, `batchSize` (1–500), `fields`, and optional `templates`.
- `pages`: endpoint `path`, JSON Pointer `items` naming an array of filename/URL strings, root-level `fields`, and a URL `template`.

Schema v1 supports JSON APIs. HTML selectors, arbitrary scripts, and authentication headers are outside this declarative schema; APK compatibility uses the separate source runtime. Unknown manifest properties and unsupported schema versions are rejected. Manifests are limited to 128 KiB and API JSON to 8 MiB.

## Templates and field selectors

Endpoint paths can use `{query}`, `{offset}`, `{page}`, `{limit}`, `{language}`, `{id}` (manga ID), and `{chapter}` (chapter ID), where relevant. Parameter values are percent-encoded before insertion. Offset starts at 0 and page at 1. Search and chapter endpoints are GET requests; chapter pagination stops at the reported total, an empty page, or 10,000 fetched entries.

Field values are JSON Pointers such as `"/attributes/title/en"`. Objects support localized maps or selecting a matching array relationship:

```json
{
  "title": {"path":"/attributes/title","localized":true},
  "coverFile": {
    "path":"/relationships",
    "whereField":"/type",
    "equals":"cover_art",
    "value":"/attributes/fileName"
  }
}
```

Search fields: required `id`; optional `title`, `author`, `description`, `cover`, and `status`. Templates can derive fields such as `cover` from extracted values. Chapter fields: required `id`; optional `title`, `number`, `pages`, and `group`. Page templates can reference extracted root fields plus `{file}`.

Never change the meaning of an ID or generate IDs from localized titles, list positions, page numbers, or expiring CDN URLs. Library IDs are `ext:<extension-id>:<manga-id>` and chapter IDs remain the source's own stable IDs. Progress is keyed by library ID plus chapter ID. Cosmetic manifest updates therefore keep progress intact.

## Cross-device behavior

Account sync carries installed manifests, library metadata, favorites, tombstones, and progress. Device paths and downloaded bytes are excluded. Identical CBZ/ZIP/CBR/PDF archives receive a SHA-256 identity independent of their filename; import the same file on another device to reconnect it. Image-folder chapter identities depend on their naturally ordered filenames and bytes; a folder's first chapter anchors its collection identity.

This repository produces Windows executables, Linux DEB/AppImage packages, and Android ARM64 APKs. Native JSON sources share the Rust implementation. APK sources use platform-specific execution hosts while keeping portable book and chapter identities for managed sync.
