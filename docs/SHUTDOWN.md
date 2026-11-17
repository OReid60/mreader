# Windows lifecycle diagnosis

The reproduced shutdown failure came from the PowerShell test/restart driver,
not a Java shutdown deadlock. `Process.CloseMainWindow()` uses a heuristic that
can choose Tao's invisible `Tao Thread Event Target` after the reader minimizes.
Closing that helper destroys event routing. Closing the actual reader afterward
reaches `ExitRequested` but never reaches final `Exit`, so Java cleanup is skipped.

The corrected lifecycle module selects a window by the exact process ID,
`Tauri Window` class and Mreader title, even when minimized. The PowerShell entry
point also validates the executable path. It revalidates ownership before
posting `WM_CLOSE`, rejects helper windows, never sends mouse/keyboard input,
and never force-kills a reader that remains alive for background downloads.

Use `scripts/launch-desktop.ps1 -BinaryPath <absolute-executable-path>` to launch
on display 2 without activation. Add `-Restart` for a graceful restart; if active
downloads keep the app alive, it stops without launching a replacement.
Use `scripts/close-desktop.ps1 -ProcessId <pid> -ExpectedBinaryPath <path>` for
an explicit graceful close. Do not use `CloseMainWindow()` for Mreader.

## Verification

Run `powershell -NoProfile -File tests/windows-lifecycle.ps1`. It creates hidden
native fixtures, checks selection, rejects the framework helper and a wrong
process owner, and accepts the actual reader target.

Two live tests used an isolated guest library and the unchanged original close
behavior with opt-in tracing. Each queued a real chapter, closed the reader
while downloading, verified completion while minimized, loaded the saved page
through the offline path, and checked that reading progress was unchanged.
The page payloads were 268,512 and 317,902 bytes. A second close targeted the
actual reader: both Mreader processes exited and neither Java child remained.
Java kill/wait completed in approximately 38 ms in each cycle.

The failing Windows heuristic was observed directly: its handle referred to
`Tao Thread Event Target` with an empty title, while the actual minimized reader
was a separate `Tauri Window`. The corrected helper rejected the former.
Speculative application shutdown changes were reverted before the passing tests.

Set `MREADER_SHUTDOWN_TRACE` to an absolute JSONL path before launching a
diagnostic build to record lifecycle stages, timestamps and process IDs.
Tracing is disabled by default and records no titles, URLs, credentials or
reading data. Local raw traces and guest fixtures remain in ignored
`test-artifacts`; these tests do not modify the signed-in user library.

Android code was not changed by this Windows helper correction. Its prior
screen-off download test is separate from these desktop regressions.
