const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../js/volume-core.js');

test('controller metadata aliases and bounds use the same physical span', () => {
    for (const key of ['volume_height_cm', 'height_cm', 'length_cm']) {
        assert.deepEqual(core.normalizeMetadata({ [key]: 32, offset_cm: 4 }),
            { startCm: 4, volumeHeightCm: 32 });
    }
    assert.deepEqual(core.normalizeMetadata({ start_cm: 40, height_cm: 20 }),
        { startCm: 40, volumeHeightCm: 8 });
    assert.deepEqual(core.normalizeMetadata({ height_cm: null }),
        { startCm: 0, volumeHeightCm: 48 });
    assert.throws(() => core.normalizeMetadata(null), /JSON object/);
    assert.throws(() => core.normalizeMetadata([]), /JSON object/);
});

test('editing metadata preserves controller settings and updates existing aliases', () => {
    const result = core.metadataPayload({ name: 'Example', outside_playback: 'hold',
        volume_height_cm: 32, offset_cm: 4 }, { volumeHeightCm: 24, startCm: 12 });
    assert.deepEqual(result, { name: 'Example', outside_playback: 'hold',
        volume_height_cm: 24, offset_cm: 12, height_cm: 24, start_cm: 12 });
});

test('selected slice resolution stays constant as frame count and memory use increase', () => {
    for (const count of [1, 30, 654, 660, 750, 2048]) {
        for (const size of [400, 800, 1200, 2160]) {
            const plan = core.texturePlan(count, size, 16 / 9);
            assert.equal(plan.width, size);
            assert.equal(plan.height, Math.round(size * 9 / 16));
            assert.equal(plan.downscaled, false);
        }
    }
    const medium = core.texturePlan(750, 800, 16 / 9);
    assert.ok(medium.estimatedBytes > 1024 * 1024 * 1024);
    assert.deepEqual([medium.width, medium.height], [800, 450]);
});

test('GPU texture-size limits are respected independently of memory use', () => {
    const plan = core.texturePlan(750, 2160, 16 / 9, 1024);
    assert.equal(plan.width, 1024);
    assert.equal(plan.height, 576);
    assert.equal(plan.downscaled, true);
    assert.deepEqual(core.texturePlan(750, 800, 16 / 9, 1024), core.texturePlan(750, 800, 16 / 9));
});

test('playback takes the source duration even when preview frames are reduced', () => {
    for (const count of [4, 30, 660]) {
        const halfway = core.advancePlayback(0, 1, 5, count, 10, 1, false);
        assert.equal(halfway.index, (count - 1) / 2);
        const end = core.advancePlayback(halfway.index, 1, 5, count, 10, 1, false);
        assert.equal(end.index, count - 1);
        assert.equal(end.playing, false);
    }
});

test('ping-pong playback reflects overshoot and handles a single frame', () => {
    assert.deepEqual(core.advancePlayback(8, 1, 0.3, 11, 1, 1, true),
        { index: 9, direction: -1, playing: true });
    assert.deepEqual(core.advancePlayback(0, 1, 100, 1, 1, 1, true),
        { index: 0, direction: 1, playing: false });
});

test('exposure sampling preserves each frame contribution and stays inside the volume', () => {
    for (const samples of [1, 30, 60]) {
        const weights = [0, 0, 0];
        for (let i = 0; i < 3 * samples; i++) {
            const sample = core.exposureSample(i, 3, samples);
            weights[sample.frameIndex] += sample.weight;
            assert.ok(sample.position >= 0 && sample.position <= 2);
        }
        weights.forEach(weight => assert.ok(Math.abs(weight - 1) < 1e-12));
        assert.deepEqual(core.exposureSample(0, 1, samples),
            { frameIndex: 0, position: 0, weight: 1 });
    }
});
