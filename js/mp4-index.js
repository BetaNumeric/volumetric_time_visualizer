(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.Mp4Index = api;
})(globalThis, function () {
    'use strict';

    class UnsupportedLayout extends Error {}
    const requireLayout = condition => { if (!condition) throw new UnsupportedLayout(); };
    const text = (bytes, offset) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const uint64 = (view, offset) => {
        const value = Number(view.getBigUint64(offset));
        requireLayout(Number.isSafeInteger(value));
        return value;
    };

    function boxes(bytes, start = 0, end = bytes.length) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const result = [];
        while (start < end) {
            requireLayout(start + 8 <= end);
            let size = view.getUint32(start);
            const header = size === 1 ? 16 : 8;
            requireLayout(start + header <= end);
            if (size === 1) size = uint64(view, start + 8);
            if (size === 0) size = end - start;
            requireLayout(size >= header && start + size <= end);
            result.push({ type: text(bytes, start + 4), start, end: start + size, header, payload: start + header });
            start += size;
        }
        return result;
    }

    async function topLevelBoxes(file, checkCancelled) {
        const result = [];
        let start = 0;
        while (start < file.size) {
            checkCancelled();
            // Bound parsing work for unrecognized/non-MP4 input.
            requireLayout(result.length < 10000);
            const bytes = new Uint8Array(await file.slice(start, start + 16).arrayBuffer());
            checkCancelled();
            requireLayout(bytes.length >= 8);
            const view = new DataView(bytes.buffer);
            let size = view.getUint32(0);
            const header = size === 1 ? 16 : 8;
            requireLayout(bytes.length >= header);
            if (size === 1) size = uint64(view, 8);
            if (size === 0) size = file.size - start;
            requireLayout(size >= header && start + size <= file.size);
            result.push({ type: text(bytes, 4), start, end: start + size, header, payload: start + header });
            start += size;
        }
        return result;
    }

    function table(view, box, stride, prefix = 8) {
        requireLayout(box && box.payload + prefix <= box.end);
        const count = view.getUint32(box.payload + prefix - 4);
        const start = box.payload + prefix;
        requireLayout(start + count * stride <= box.end);
        return { count, start };
    }

    function bufferedReader(file, checkCancelled) {
        let start = -1;
        let bytes = new Uint8Array();
        return async (position, length) => {
            checkCancelled();
            requireLayout(position >= 0 && position + length <= file.size);
            if (position < start || position + length > start + bytes.length) {
                start = position;
                bytes = new Uint8Array(await file.slice(start, start + 1024 * 1024).arrayBuffer());
                checkCancelled();
            }
            return bytes.subarray(position - start, position - start + length);
        };
    }

    async function findKeyframes(bytes, entries, read, media, checkCancelled) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const get = type => entries.find(box => box.type === type);
        const stsd = get('stsd');
        requireLayout(stsd && stsd.payload + 8 <= stsd.end);
        // Encrypted, fragmented, and other codecs stay on the browser's normal path.
        if (view.getUint32(stsd.payload + 4) !== 1) return null;
        const descriptions = boxes(bytes, stsd.payload + 8, stsd.end);
        if (descriptions.length !== 1 || descriptions[0].type !== 'avc1') return null;
        const description = descriptions[0];
        requireLayout(description.payload + 78 <= description.end);
        const avcc = boxes(bytes, description.payload + 78, description.end).find(box => box.type === 'avcC');
        requireLayout(avcc && avcc.payload + 5 <= avcc.end);
        const lengthBytes = (bytes[avcc.payload + 4] & 3) + 1;
        requireLayout([1, 2, 4].includes(lengthBytes));

        const stsz = get('stsz');
        requireLayout(stsz && stsz.payload + 12 <= stsz.end);
        const fixedSize = view.getUint32(stsz.payload + 4);
        const count = view.getUint32(stsz.payload + 8);
        requireLayout(fixedSize || stsz.payload + 12 + count * 4 <= stsz.end);
        const stsc = table(view, get('stsc'), 12);
        const offsets = get('stco') || get('co64');
        const stride = offsets?.type === 'co64' ? 8 : 4;
        const chunks = table(view, offsets, stride);
        if (!count) return null;
        requireLayout(stsc.count && chunks.count && view.getUint32(stsc.start) === 1);
        let previous = 0;
        for (let i = 0; i < stsc.count; i++) {
            const first = view.getUint32(stsc.start + i * 12);
            requireLayout(first > previous && first <= chunks.count);
            requireLayout(view.getUint32(stsc.start + i * 12 + 4) > 0);
            requireLayout(view.getUint32(stsc.start + i * 12 + 8) === 1);
            previous = first;
        }

        const keyframes = [];
        let sample = 0;
        let row = 0;
        for (let chunk = 0; chunk < chunks.count; chunk++) {
            while (row + 1 < stsc.count && view.getUint32(stsc.start + (row + 1) * 12) <= chunk + 1) row++;
            const samplesInChunk = view.getUint32(stsc.start + row * 12 + 4);
            let position = stride === 8 ? uint64(view, chunks.start + chunk * stride)
                : view.getUint32(chunks.start + chunk * stride);
            requireLayout(sample + samplesInChunk <= count);
            for (let i = 0; i < samplesInChunk; i++, sample++) {
                checkCancelled();
                const size = fixedSize || view.getUint32(stsz.payload + 12 + sample * 4);
                const end = position + size;
                requireLayout(size > lengthBytes && media.some(box => position >= box.payload && end <= box.end));
                let cursor = position;
                let foundSlice = false;
                while (cursor < end) {
                    requireLayout(cursor + lengthBytes + 1 <= end);
                    const header = await read(cursor, lengthBytes + 1);
                    let length = 0;
                    for (let j = 0; j < lengthBytes; j++) length = length * 256 + header[j];
                    requireLayout(length > 0 && cursor + lengthBytes + length <= end);
                    const type = header[lengthBytes] & 31;
                    if (type >= 1 && type <= 5) {
                        if (type === 5) keyframes.push(sample + 1);
                        foundSlice = true;
                        break;
                    }
                    cursor += lengthBytes + length;
                }
                requireLayout(foundSlice);
                position = end;
                // Cached reads resolve immediately; yield so Cancel still works on large files.
                if (sample % 128 === 127) await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        requireLayout(sample === count && keyframes[0] === 1);
        return keyframes.length === count ? null : { keyframes, count };
    }

    function syncSampleBox(keyframes) {
        const bytes = new Uint8Array(16 + keyframes.length * 4);
        const view = new DataView(bytes.buffer);
        view.setUint32(0, bytes.length);
        bytes.set([115, 116, 115, 115], 4); // stss
        view.setUint32(12, keyframes.length);
        keyframes.forEach((sample, index) => view.setUint32(16 + index * 4, sample));
        return bytes;
    }

    async function prepareForSeeking(file, { checkCancelled = () => {} } = {}) {
        const unchanged = { blob: file, repaired: false };
        try {
            const top = await topLevelBoxes(file, checkCancelled);
            const movies = top.filter(box => box.type === 'moov');
            if (movies.length !== 1 || top.some(box => box.type === 'moof')) return unchanged;
            const movie = movies[0];
            // Only metadata is copied in full; media is scanned through a 1 MiB buffer.
            if (movie.end - movie.start > 64 * 1024 * 1024) return unchanged;
            const bytes = new Uint8Array(await file.slice(movie.start, movie.end).arrayBuffer());
            checkCancelled();
            const root = boxes(bytes)[0];
            const children = box => boxes(bytes, box.payload, box.end);
            const movieChildren = children(root);
            if (movieChildren.some(box => box.type === 'mvex')) return unchanged;
            const read = bufferedReader(file, checkCancelled);
            const media = top.filter(box => box.type === 'mdat');
            const insertions = [];
            const growth = new Map();
            const offsetTables = [];
            for (const track of movieChildren.filter(box => box.type === 'trak')) {
                const path = [root, track];
                for (const type of ['mdia', 'minf', 'stbl']) {
                    const box = children(path[path.length - 1]).find(child => child.type === type);
                    requireLayout(box);
                    path.push(box);
                }
                const sampleTable = path[path.length - 1];
                const entries = children(sampleTable);
                offsetTables.push(...entries.filter(box => ['stco', 'co64'].includes(box.type)));
                if (entries.some(box => box.type === 'stss')) continue;
                const result = await findKeyframes(bytes, entries, read, media, checkCancelled);
                if (!result) continue;
                const addition = syncSampleBox(result.keyframes);
                insertions.push({ position: sampleTable.end, bytes: addition });
                for (const box of path) growth.set(box, (growth.get(box) || 0) + addition.length);
            }
            if (!insertions.length) return unchanged;
            const delta = growth.get(root);
            const view = new DataView(bytes.buffer);
            for (const [box, extra] of growth) {
                const size = box.end - box.start + extra;
                if (box.header === 16) view.setBigUint64(box.start + 8, BigInt(size));
                else {
                    requireLayout(size <= 0xffffffff);
                    view.setUint32(box.start, size);
                }
            }
            // Growing a front-loaded moov shifts media offsets in EVERY track, including audio.
            for (const box of offsetTables) {
                const stride = box.type === 'co64' ? 8 : 4;
                const offsets = table(view, box, stride);
                for (let i = 0; i < offsets.count; i++) {
                    const position = offsets.start + i * stride;
                    const offset = stride === 8 ? uint64(view, position) : view.getUint32(position);
                    if (offset < movie.end) continue;
                    const adjusted = offset + delta;
                    requireLayout(Number.isSafeInteger(adjusted));
                    if (stride === 8) view.setBigUint64(position, BigInt(adjusted));
                    else {
                        requireLayout(adjusted <= 0xffffffff);
                        view.setUint32(position, adjusted);
                    }
                }
            }
            const parts = [file.slice(0, movie.start)];
            let position = 0;
            for (const insertion of insertions.sort((a, b) => a.position - b.position)) {
                parts.push(bytes.subarray(position, insertion.position), insertion.bytes);
                position = insertion.position;
            }
            parts.push(bytes.subarray(position), file.slice(movie.end));
            checkCancelled();
            return { blob: new Blob(parts, { type: file.type || 'video/mp4' }), repaired: true };
        } catch (error) {
            // Leave unsupported/malformed layouts to the browser; never partially rewrite them.
            if (error instanceof UnsupportedLayout) return unchanged;
            throw error;
        }
    }

    return { prepareForSeeking };
});
