Run `npm test` for dependency-free Node regression tests and `npm run
check:assets` to verify the offline distribution and vendor checksums.

For browser tests, run `python -m pip install -r tests/requirements.txt`, then
`npm run test:browser`. The runner uses installed Chrome/Edge on Windows;
otherwise install Chromium with `python -m playwright install chromium`, or
set `CHROME_PATH` to a Chromium browser executable.

Set `BROWSER_ENGINE=firefox` or `BROWSER_ENGINE=webkit` to exercise another
Playwright engine after installing it with `python -m playwright install
firefox webkit`. Playwright WebKit on Windows is not Safari on Apple hardware.
The suite checks an unsupported example codec as a recoverable import failure,
with the previous stack retained, rather than claiming successful video import.

External HTTP(S) requests are blocked during all checks. Generated images test
metadata, regeneration, exposure, trails, interpolation, cancelled/failed
imports, settings reload, blocked storage, batch retries and context recovery.
If `examples/` is present, its media is read to check actual video import and
the full sequence. Batch writes are mocked. No test writes to source folders.
The final profile includes GPU completion and is a headless host measurement.

If `meander_test.mp4` is present at the project root, the browser suite checks
that its missing seek index is repaired: all 300 frames must be distinct, as
must the 30 frames regenerated from a one-second trim between keyframes.
Node tests use generated MP4 structures to cover index repair, preserved media,
audio offsets, front/end metadata, 32/64-bit offsets, cancellation and malformed
input, without needing the supplied clip.
