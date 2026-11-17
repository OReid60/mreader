# Distribution policy

Mreader distributes the reader application. It does not supply third-party extension packages, repository URLs, recommended catalogs, or default repository trust keys.

Users obtain repository addresses independently and verify signing fingerprints before adding a new repository. Previously user-added trust decisions remain saved. Sync and migration can prepare a matching extension only from repositories the user has already supplied.

Documentation and automated tests use synthetic fixture domains. Optional live tests require externally provided repository details or local APK fixtures. No test fixture source APK is shipped in production releases.

Older published releases, their tags, and old build artifacts have been removed. Published branch and release-tag history has been rewritten to remove the extension repository links. Existing clones, cached commit pages, or other copies may still retain earlier contents. After the rewrite, collaborators should clone again instead of pushing an old branch.
