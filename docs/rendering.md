# Rendering and validation

The regular stack and viewport trail are artistic previews. The trail stores
pixels in an offscreen render target and presents that texture on demand. It
does not require `preserveDrawingBuffer`. Repainting a paused slice does not
add it again. Camera changes, resize, geometry changes, and context recovery
invalidate the trail. The display-volume guide is drawn separately.

Smooth Motion moves the scanner between slice positions. Blend adjacent
slices optionally interpolates their displayed colors. It is an artistic
crossfade; the exposure bake integrates the original sampled slice images.

Linear-light estimate decodes source sRGB values using the sRGB transfer
function, integrates each frame with weight `sweepDuration / frameCount`, and
then applies `1 - exp(-energy)` tone mapping and sRGB encoding. Opacity scales
the relative light contribution. This keeps a constant image's exposure
consistent when the preview frame count changes. An explicit sweep duration
overrides source timing. The legacy artistic model remains the default.

This is a relative light estimate, not a calibrated camera simulator. It does
not model display luminance, LCD bleed, camera auto-exposure, response curves,
reflections, or actuator acceleration. Comparing with installation photographs
requires the actual display, camera, motion timing and exposure settings.

Browser regressions compare the linear-light GPU result against an analytic
reference, test adjacent-slice interpolation and retained trail pixels, and
exercise the real WebGL context-loss lifecycle. The optional full example
sequence also prints a headless rendering profile. Those timings describe
the test host, not mobile hardware or the installation.

Before automatic memory downscaling was removed, the supplied 654-frame sequence
on the Windows test host recorded 654 draw calls and roughly 254 MiB of estimated
texture/canvas storage at 301 × 169. Median render time, including GPU completion over three warmed
frames, was 1.7–1.8 ms in Chrome, 52 ms in Firefox, and 3 ms in Playwright
WebKit. These small headless samples are diagnostic observations, not browser
rankings or on-device benchmarks. Static views submit no further frames while
idle. Those historical timings apply to the reduced 301 × 169 textures, not
the current Medium setting of 800 × 450. Run the browser suite to profile the
selected full resolution. Profiling reads and `gl.finish()` are confined to tests.

Texture arrays could reduce draw calls on WebGL 2 (the test host supports
2,048 layers), but an additional array alongside the per-frame textures would
duplicate GPU storage. A useful array backend must replace that storage and
serve scanning, baking, export and context restoration as well. It must also
preserve transparency order when viewing the stack from either side and keep
a WebGL 1 fallback. That backend is deferred; the measured pass keeps the
existing slice renderer and removes unnecessary idle/default-buffer work.
