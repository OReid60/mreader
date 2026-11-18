# Chapter loading and optional metadata

Both APK adapters previously requested details and chapters together. The installed source's shared parser starts these requests in a coroutine scope; its detail parser assumes certain HTML elements, including a thumbnail, exist. A detail exception cancels the combined update, even when the chapter API could still work. Mreader ignores the returned detail object when constructing its chapter list, so that dependency was unnecessary.

The Android host now requests `fetchDetails=false, fetchChapters=true`. The desktop adapter sends the equivalent GraphQL flags. Covers continue using their existing independent requests. Chapter identities, memo, ordering and reading progress are not changed by this fix. Genuine chapter failures, including verification requirements, still propagate.

## Validation and limits

- Android unit tests reproduce a throwing detail parser and verify that chapter loading and page metadata still work, and that chapter errors are not suppressed.
- The Rust loopback regression verifies the desktop request flags and returned chapter identity.
- The manual `LonerLifePagesTest` requires `-e sourceProbe true`. It fetches the exact saved Manganato title's chapters and decodes up to two image files without entering the reader. Missing chapters, pages or undecodable images fail the test. A final comparison checks reading progress is unchanged even on failure.

The previous diagnostic observed verification followed by a null-pointer exception, without an exact extension stack frame. On the updated physical-device build, chapter-only requests loaded 347 chapters. The remaining page failure was traced separately: the chapter URL redirected to a changed HTML layout, returning HTTP 200 with images but neither of the extension's expected reader selectors/scripts. Its parser returned no pages.

Android and desktop now have an empty-result fallback for the observed reader container only. Both use the installed source's normal HTTPS client, headers and verification session. They require 2–1000 images inside the exact container, consecutive numeric filenames beginning at 0 or 1, and a common image origin and directory. They reject unrelated images and mixed or unsafe URLs. HTML reads are limited to 8 MiB. This fallback is not installed into or bundled as a third-party extension. It also supports other installed extensions encountering that exact layout; it does not guess how to parse unrelated websites.

The desktop helper transports image bytes over its authenticated loopback connection with a 64 MiB limit. Only image URLs from a validated chapter manifest are accepted. The helper keeps no reading-progress state. The Java fixtures cover parser exclusions, the installed-source client/headers, response size bounds, binary transport and rejection of images outside the chapter manifest.

## Physical-device result, 2026-11-18

The paired Pixel 7 was reached over the user's private Tailscale network. A signed temporary update, retaining version 0.3.40 and the unchanged Rust library, was installed without uninstalling Mreader. After opening the exact challenged page in the normal verification browser, the user reported that the chapter loaded without displaying a challenge.

Final strict test: 347 chapters, chapter 1 with 38 pages, and two successfully decoded page images. Reading progress compared identically before and after. Evidence is in ignored `test-artifacts/loner-life-final-phone-proof.log`. Android's four parser regression tests passed; the Rust suite passed 58 tests with four ignored live tests. This validates the sampled Android chapter, not every chapter or desktop image loading. No new public release was created.
