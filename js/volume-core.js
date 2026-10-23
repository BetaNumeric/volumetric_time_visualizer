(function (root, factory) {
    const core = factory();
    if (typeof module === 'object' && module.exports) module.exports = core;
    else root.VolumeCore = core;
})(globalThis, function () {
    'use strict';

    const MAX_PREVIEW_FRAMES = 2048;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const finiteNumber = (value, fallback) => {
        if (value === null || value === '' || typeof value === 'boolean') return fallback;
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    };

    function normalizeMetadata(raw = {}, travelCm = 48) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error('Sequence metadata must be a JSON object.');
        }
        const startCm = clamp(finiteNumber(raw.start_cm ?? raw.offset_cm, 0), 0, travelCm);
        const volumeHeightCm = clamp(finiteNumber(
            raw.volume_height_cm ?? raw.height_cm ?? raw.length_cm, travelCm
        ), 0, travelCm - startCm);
        return { startCm, volumeHeightCm };
    }

    function metadataPayload(raw, geometry) {
        const round = value => Math.round(value * 1000) / 1000;
        const height = round(geometry.volumeHeightCm);
        const start = round(geometry.startCm);
        const result = { ...raw, height_cm: height, start_cm: start };
        if ('volume_height_cm' in result) result.volume_height_cm = height;
        if ('length_cm' in result) result.length_cm = height;
        if ('offset_cm' in result) result.offset_cm = start;
        return result;
    }

    function texturePlan(frameCount, maxSide, aspect, budgetBytes, maxTextureSize = Infinity) {
        const count = Math.max(1, Math.floor(frameCount));
        const requestedWidth = aspect >= 1 ? maxSide : Math.round(maxSide * aspect);
        const requestedHeight = aspect >= 1 ? Math.round(maxSide / aspect) : maxSide;
        // One canvas and one GPU copy per frame, plus the extraction canvas.
        const bytesPerPixel = 4 * (2 * count + 1);
        const factor = Math.min(1, maxTextureSize / Math.max(requestedWidth, requestedHeight),
            Math.sqrt(budgetBytes / (requestedWidth * requestedHeight * bytesPerPixel)));
        const width = Math.max(1, Math.floor(requestedWidth * factor));
        const height = Math.max(1, Math.floor(requestedHeight * factor));
        return { width, height, estimatedBytes: width * height * bytesPerPixel,
            downscaled: width < requestedWidth || height < requestedHeight };
    }

    function advancePlayback(index, direction, seconds, frameCount, duration, speed, loop) {
        const last = frameCount - 1;
        if (last <= 0) return { index: 0, direction: 1, playing: false };
        const advance = Math.max(0, seconds) * last / Math.max(0.000001, duration) * speed;
        if (loop) {
            const period = 2 * last;
            const phase = ((direction < 0 ? period - index : index) + advance) % period;
            return { index: phase <= last ? phase : period - phase,
                direction: phase < last ? 1 : -1, playing: true };
        }
        const next = index + advance * direction;
        return { index: clamp(next, 0, last), direction,
            playing: direction > 0 ? next < last : next > 0 };
    }

    function exposureSample(index, frameCount, samplesPerFrame) {
        if (frameCount === 1) return { frameIndex: 0, position: 0, weight: 1 };
        const frameIndex = Math.floor(index / samplesPerFrame);
        const offset = ((index % samplesPerFrame) + 0.5) / samplesPerFrame - 0.5;
        return { frameIndex, position: clamp(frameIndex + offset, 0, frameCount - 1),
            weight: 1 / samplesPerFrame };
    }

    return { MAX_PREVIEW_FRAMES, normalizeMetadata, metadataPayload, texturePlan,
        advancePlayback, exposureSample };
});
