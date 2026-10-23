# Volumetric Time Visualizer

Open `index.html` directly or serve this directory with any static web server.
Startup is fully local: scripts, Three.js r128, OrbitControls and compiled CSS
are included. Keep the `js/`, `styles/` and `vendor/` folders beside the page.
No build step or network connection is needed to use the shipped app.

For development, run `npm ci`, then `npm run build` after changing HTML or CSS
classes in JavaScript. Commit the generated `styles/tailwind.css` with source
changes. `npm run check:assets` verifies local dependencies and vendor hashes.
Third-party source links, checksums and MIT licenses are in `vendor/`.

## Sources and physical placement

Load a video or select image frames together with `sequence.json`. Videos may
have matching sidecars, such as `example.mp4` + `example.json`. The metadata
reader accepts `volume_height_cm` / `offset_cm` aliases as well as `height_cm`
/ `start_cm`. JSON export preserves unrelated fields and keeps existing
placement aliases consistent. Video decoding depends on browser codec support;
files must expose a finite duration.

Regenerate Stack resamples the current source while preserving edited volume
height, placement and alignment. Loading a source through the file picker uses
its original metadata. Reset geometry to source explicitly restores that
placement. Preview PNG includes the active trim selection. Sampling changes
show a reminder when regeneration is needed.

Imports are staged. A failed or cancelled replacement keeps the previous
stack, source references, playback and physical settings. Folder import asks
for read access; saving JSON or previews requests write access when needed.
Source media is never rewritten by resampling. Batch details list each job's
result and error, and Retry failed previews reruns only failed jobs.

## Preferences and previews

Rendering preferences are restored locally. Named render presets save those
preferences, including FPS, resolution, exposure model and interpolation.
They do not store source files, trim ranges, or physical placement. Browser
storage restrictions leave preferences usable for the current session.

The selected Max Res is preserved regardless of frame count or estimated RAM:
Medium uses 800 × 450 textures, including large stacks. Image quality is
prioritized over frame rate; memory use is displayed as an estimate and does
not trigger automatic downscaling. Only the GPU's hard texture-size limit can
reduce the selected dimensions, with an explicit label. Frame count is capped
at 2,048. Estimates include frame canvases and GPU textures but exclude browser
overhead, original-file decoding, render targets and the framebuffer. Staged
replacements temporarily retain both the previous and incoming stack.

Static views render on changes. Scanning trails accumulate offscreen, and
Blend adjacent slices optionally crossfades images during smooth scanning.
Graphics context recovery reuses retained source pixels and resets accumulated
trails/exposure. Exposure baking requires floating-point render-target support
and remains cancellable.

Artistic preview preserves the original appearance. Linear-light estimate
integrates decoded source light over the source duration or an explicit sweep
duration. This is a relative estimate; monitor glow, reflections and camera
response are not calibrated. See [rendering notes](docs/rendering.md) for the
model, profiling results, limitations and texture-array assessment.

## Code and validation

Classic scripts keep direct `file://` opening available. `js/app.js` owns
application state, scene setup, geometry and UI events. `sources.js` handles
image/video decoding; `source-transaction.js` stages imports and owns rollback
and commit; `exports.js` handles saves; `batch.js` runs queues; `workflow.js`
coordinates presets and result UI. Settings, trails, shaders and pure math
have their own files. Shared application state is explicit in the controller;
these are not isolated ES modules.

Run `npm test` for Node tests and `npm run test:browser` for browser regressions.
See [tests/README.md](tests/README.md) for engine setup and read-only example
checks. Windows Chrome and Firefox cover the full supplied media. Windows
Playwright WebKit checks image rendering and recovery; its unsupported example
video codec is checked as a recoverable import failure. These tests do not
replace Safari/iOS, Android GPU, or physical-installation validation.
