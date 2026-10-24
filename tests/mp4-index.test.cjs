const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareForSeeking } = require('../js/mp4-index.js');

function u32(...values) {
    const bytes = Buffer.alloc(values.length * 4);
    values.forEach((value, index) => bytes.writeUInt32BE(value, index * 4));
    return bytes;
}

function box(type, ...parts) {
    const data = Buffer.concat(parts);
    return Buffer.concat([u32(data.length + 8), Buffer.from(type), data]);
}

const fullBox = (type, ...parts) => box(type, u32(0), ...parts);

function fixture({ front = false, wide = false, indexed = false, allKey = false,
    fixed = false, fragmented = false, lengthBytes = 4 } = {}) {
    const nal = type => {
        const length = Buffer.alloc(lengthBytes);
        length.writeUIntBE(4, 0, lengthBytes);
        return Buffer.concat([length, Buffer.from([type, 20, 30, 40])]);
    };
    const samples = Array.from({ length: 6 }, (_, index) => nal(allKey || index % 3 === 0 ? 5 : 1));
    if (!fixed) samples[0] = Buffer.concat([nal(7), nal(8), nal(6), samples[0]]);
    const audio = Buffer.from('original audio data');
    const media = Buffer.concat([...samples, audio]);
    const entry = box('avc1', Buffer.alloc(78), box('avcC', Buffer.from([1, 100, 0, 40, lengthBytes - 1])));
    const offsetsBox = offsets => wide
        ? fullBox('co64', u32(offsets.length), ...offsets.map(value => {
            const bytes = Buffer.alloc(8); bytes.writeBigUInt64BE(BigInt(value)); return bytes;
        }))
        : fullBox('stco', u32(offsets.length, ...offsets));
    const videoTrack = offsets => box('trak', box('mdia', box('minf', box('stbl',
        fullBox('stsd', u32(1), entry),
        fullBox('stsz', fixed ? u32(samples[0].length, samples.length) : u32(0, samples.length, ...samples.map(s => s.length))),
        fullBox('stsc', u32(3, 1, 2, 1, 2, 1, 1, 3, 3, 1)), offsetsBox(offsets),
        ...(indexed ? [fullBox('stss', u32(2, 1, 4))] : [])
    ))));
    const audioTrack = offset => box('trak', box('mdia', box('minf', box('stbl',
        fullBox('stsd', u32(1), box('mp4a', Buffer.alloc(28))), offsetsBox([offset])
    ))));
    const movie = (offsets, audioOffset) => box('moov', videoTrack(offsets), audioTrack(audioOffset),
        ...(fragmented ? [box('mvex')] : []));
    const ftyp = box('ftyp', Buffer.from('isom'), u32(0), Buffer.from('isomavc1'));
    const placeholder = movie([0, 0, 0], 0);
    const dataStart = ftyp.length + (front ? placeholder.length : 0) + 8;
    const offsets = [dataStart, dataStart + samples[0].length + samples[1].length,
        dataStart + samples[0].length + samples[1].length + samples[2].length];
    const metadata = movie(offsets, dataStart + media.length - audio.length);
    const bytes = Buffer.concat(front ? [ftyp, metadata, box('mdat', media)] : [ftyp, box('mdat', media), metadata]);
    return { file: new Blob([bytes], { type: 'video/mp4' }), bytes, media, samples, audio, offsets };
}

function children(bytes, start = 0, end = bytes.length) {
    const result = [];
    while (start < end) {
        const size = bytes.readUInt32BE(start);
        result.push({ type: bytes.toString('ascii', start + 4, start + 8), start, end: start + size });
        start += size;
    }
    return result;
}

function sampleTables(bytes) {
    const movie = children(bytes).find(b => b.type === 'moov');
    return children(bytes, movie.start + 8, movie.end).filter(b => b.type === 'trak').map(track => {
        for (const type of ['mdia', 'minf', 'stbl']) {
            track = children(bytes, track.start + 8, track.end).find(b => b.type === type);
        }
        return children(bytes, track.start + 8, track.end);
    });
}

for (const front of [false, true]) {
    for (const wide of [false, true]) {
        test(`missing AVC seek index is repaired with ${front ? 'front' : 'end'} metadata and ${wide ? 64 : 32}-bit offsets`, async () => {
            const source = fixture({ front, wide });
            const result = await prepareForSeeking(source.file);
            assert.equal(result.repaired, true);
            const bytes = Buffer.from(await result.blob.arrayBuffer());
            const [video, audio] = sampleTables(bytes);
            const sync = video.find(b => b.type === 'stss');
            assert.deepEqual([...bytes.subarray(sync.start + 12, sync.end)], [...u32(2, 1, 4)]);
            const media = children(bytes).find(b => b.type === 'mdat');
            assert.deepEqual(bytes.subarray(media.start + 8, media.end), source.media);
            for (const [track, chunkData] of [[video, source.samples[0]], [audio, source.audio]]) {
                const offsets = track.find(b => b.type === (wide ? 'co64' : 'stco'));
                const offset = wide ? Number(bytes.readBigUInt64BE(offsets.start + 16)) : bytes.readUInt32BE(offsets.start + 16);
                assert.deepEqual(bytes.subarray(offset, offset + chunkData.length), chunkData);
            }
            assert.equal(result.blob.size, source.file.size + 24);
            assert.deepEqual(Buffer.from(await source.file.arrayBuffer()), source.bytes);
            const repeated = await prepareForSeeking(result.blob);
            assert.equal(repeated.repaired, false);
            assert.equal(repeated.blob, result.blob);
        });
    }
}

test('fixed sample sizes and 1/2/4-byte AVC NAL lengths are supported', async () => {
    for (const lengthBytes of [1, 2, 4]) {
        const source = fixture({ fixed: true, lengthBytes });
        const result = await prepareForSeeking(source.file);
        assert.equal(result.repaired, true);
        const bytes = Buffer.from(await result.blob.arrayBuffer());
        const sync = sampleTables(bytes)[0].find(b => b.type === 'stss');
        assert.deepEqual(bytes.subarray(sync.start + 12, sync.end), u32(2, 1, 4));
    }
});

test('valid, all-keyframe, fragmented and non-MP4 sources pass through unchanged', async () => {
    const files = [{ indexed: true }, { allKey: true }, { fragmented: true }].map(options => fixture(options).file);
    files.push(new Blob(['not an MP4']), new Blob([]));
    for (const file of files) {
        const result = await prepareForSeeking(file);
        assert.equal(result.repaired, false);
        assert.equal(result.blob, file);
    }
});

test('invalid sample counts, offsets and NAL lengths never produce a partial repair', async () => {
    for (const corrupt of [
        (bytes, track) => bytes.writeUInt32BE(0xffffffff, track.find(b => b.type === 'stsz').start + 16),
        (bytes, track) => bytes.writeUInt32BE(0xffffffff, track.find(b => b.type === 'stco').start + 16),
        (bytes, track) => bytes.writeUInt32BE(0xffffffff, track.find(b => b.type === 'stsc').start + 20),
        (bytes, track, source) => bytes.writeUInt32BE(0xffffffff, source.offsets[0])
    ]) {
        const source = fixture();
        corrupt(source.bytes, sampleTables(source.bytes)[0], source);
        const file = new Blob([source.bytes]);
        const result = await prepareForSeeking(file);
        assert.equal(result.repaired, false);
        assert.equal(result.blob, file);
    }
});

test('cancellation during inspection propagates to the import transaction', async () => {
    const cancelled = new Error('Processing Cancelled');
    let checks = 0;
    await assert.rejects(prepareForSeeking(fixture().file, {
        checkCancelled() { if (++checks === 8) throw cancelled; }
    }), error => error === cancelled);
});
