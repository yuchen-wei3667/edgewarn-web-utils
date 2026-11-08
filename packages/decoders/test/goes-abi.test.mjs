import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { AbiFile, BytesSource } from '../dist/goes/index.js';
import { inflate, InflateError } from '../dist/goes/inflate.js';

// Built by tests/fixtures/goes/make-abi-fixture.py: Rad is 60×90 int16 in 13-row shuffle+deflate chunks.
const FIXTURE = new Uint8Array(readFileSync(new URL('./fixtures/goes/abi-mini.nc', import.meta.url)));
const H = 60, W = 90, FILL = 4095;
const code = (r, c) => ((r === 0 && c === 0) || (r === H - 1 && c === W - 1) ? FILL : (r * 37 + c * 11) % 4095);

function seeded(n, seed = 1) {
    const out = new Uint8Array(n);
    let h = seed;
    for (let i = 0; i < n; i++) { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; out[i] = h >>> 24; }
    return out;
}

function roundTrip(plain, opts, raw = false) {
    const packed = raw ? zlib.deflateRawSync(plain, opts) : zlib.deflateSync(plain, opts);
    const out = new Uint8Array(plain.length);
    assert.equal(inflate(new Uint8Array(packed), out, raw), plain.length);
    assert.deepEqual(out, plain);
}

test('inflate matches zlib across block types and strategies', () => {
    const text = new TextEncoder().encode('GOES-R ABI fixed grid '.repeat(4000));
    const noisy = seeded(200_000);
    const planes = new Uint8Array(120_000); // shuffled int16: noisy low bytes, flat high bytes
    planes.set(seeded(60_000, 7));
    planes.fill(3, 60_000);
    for (const plain of [text, noisy, planes, new Uint8Array(70_000)]) {
        roundTrip(plain, { level: 0 });
        roundTrip(plain, { level: 1 });
        roundTrip(plain, { level: 9 });
        roundTrip(plain, { strategy: zlib.constants.Z_FIXED });
        roundTrip(plain, { strategy: zlib.constants.Z_HUFFMAN_ONLY });
        roundTrip(plain, { strategy: zlib.constants.Z_RLE });
        roundTrip(plain, {}, true);
    }
    roundTrip(new Uint8Array(0), {});
    roundTrip(new Uint8Array([42]), {});
});

test('inflate rejects overflow, truncation and bad headers', () => {
    const packed = new Uint8Array(zlib.deflateSync(seeded(5000)));
    assert.throws(() => inflate(packed, new Uint8Array(4999)), InflateError);
    assert.throws(() => inflate(packed.subarray(0, packed.length >> 1), new Uint8Array(5000)), InflateError);
    assert.throws(() => inflate(new Uint8Array([0x78, 0x00, 0, 0]), new Uint8Array(10)), /zlib header/);
});

test('opens the dense root group and reads ABI metadata', async () => {
    const file = await AbiFile.open(new BytesSource(FIXTURE));
    for (const name of ['Rad', 'DQF', 'x', 'y', 't', 'goes_imager_projection', 'aux_00', 'aux_39']) assert.ok(file.links.has(name), name);
    const attrs = await file.attributes('Rad');
    assert.equal(attrs.get('units'), 'W m-2 sr-1 um-1');
    assert.equal(attrs.get('_Unsigned'), 'true');
    assert.deepEqual(attrs.get('valid_range'), [0, 4094]);
    assert.deepEqual(await file.projection(), {
        perspectivePointHeight: 35786023, semiMajorAxis: 6378137, semiMinorAxis: 6356752.31414,
        longitudeOfProjectionOrigin: -75, sweepAngleAxis: 'x',
    });
    assert.equal(await file.time(), '2026-10-11T12:02:37.500Z');
});

test('decodes a full image to raw codes with scale, offset and fill', async () => {
    const file = await AbiFile.open(new BytesSource(FIXTURE));
    const g = await file.read();
    assert.equal(g.variable, 'Rad');
    assert.equal(g.width, W);
    assert.equal(g.height, H);
    assert.ok(g.data instanceof Uint16Array);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) assert.equal(g.data[r * W + c], code(r, c), `(${r}, ${c})`);
    assert.equal(g.fill, FILL);
    assert.ok(Math.abs(g.scale - 0.15859237) < 1e-7);
    assert.ok(Math.abs(g.offset + 20.289911) < 1e-5);
    assert.ok(Math.abs(g.x.start + 0.101332) < 1e-6 && Math.abs(g.x.step - 5.6e-5) < 1e-9);
    assert.ok(Math.abs(g.y.start - 0.128212) < 1e-6 && Math.abs(g.y.step + 5.6e-5) < 1e-9);
    assert.deepEqual({ decoded: g.stats.chunksDecoded, skipped: g.stats.chunksSkipped }, { decoded: 5, skipped: 0 });
});

test('windowed, strided reads touch only the chunks they sample', async () => {
    const file = await AbiFile.open(new BytesSource(FIXTURE));
    const rows = [14, 52], cols = [5, 83], s = 3;
    for (const inflateMode of ['js', 'native']) {
        const g = await file.read({ rows, cols, stride: s, inflate: inflateMode });
        assert.equal(g.width, Math.ceil((cols[1] - cols[0]) / s));
        assert.equal(g.height, Math.ceil((rows[1] - rows[0]) / s));
        for (let j = 0; j < g.height; j++) {
            for (let i = 0; i < g.width; i++) assert.equal(g.data[j * g.width + i], code(rows[0] + j * s, cols[0] + i * s));
        }
        // Rows 14..51 live in chunks 1..3 (13-row strips); chunks 0 and 4 are never fetched.
        assert.deepEqual([g.stats.chunksDecoded, g.stats.chunksSkipped], [3, 2]);
        assert.ok(Math.abs(g.x.start - (-0.101332 + cols[0] * 5.6e-5)) < 1e-6);
        assert.ok(Math.abs(g.x.step - s * 5.6e-5) < 1e-9);
    }
    // A stride longer than a chunk skips strips that hold no sampled row.
    const sparse = await file.read({ stride: 20 });
    assert.deepEqual([sparse.height, sparse.stats.chunksDecoded], [3, 3]);
    assert.deepEqual(Array.from(sparse.data.subarray(0, 3)), [code(0, 0), code(0, 20), code(0, 40)]);
});

test('8-bit DQF decodes to Uint8Array, and output buffers are reused', async () => {
    const file = await AbiFile.open(new BytesSource(FIXTURE));
    const dqf = await file.read({ variable: 'DQF' });
    assert.ok(dqf.data instanceof Uint8Array);
    for (let r = 0; r < H; r += 7) for (let c = 0; c < W; c += 5) assert.equal(dqf.data[r * W + c], (r + c) % 5);
    const buf = new Uint16Array(W * H);
    const again = await file.read({ output: buf });
    assert.equal(again.data, buf);
    assert.equal(buf[W + 1], code(1, 1));
    await assert.rejects(file.read({ output: new Uint16Array(10) }), /output holds/);
});

/** Fake S3: honours Range like the real bucket, or ignores it and sends the whole object. */
function fakeFetch(bytes, { honourRange = true } = {}) {
    const calls = [];
    const fetcher = async (_url, init) => {
        const [, a, b] = /bytes=(\d+)-(\d*)/.exec(init.headers.Range);
        const last = b === '' ? bytes.length - 1 : Number(b);
        calls.push([Number(a), last]);
        const body = honourRange ? bytes.slice(Number(a), Math.min(bytes.length, last + 1)) : bytes.slice();
        // Deliver in small pieces so chunks straddle stream reads.
        const stream = new ReadableStream({
            start(c) { for (let i = 0; i < body.length; i += 97) c.enqueue(body.subarray(i, i + 97)); c.close(); },
        });
        return new Response(stream, { status: honourRange ? 206 : 200 });
    };
    return { fetcher, calls };
}

/** Serve a `bandRange` result from the fixture, in pieces of `step` bytes (Infinity: whole range). */
const servePieces = (bytes, step) => (range) => (async function* () {
    for (let p = range.start; p < range.end; p += step) yield bytes.subarray(p, Math.min(range.end, p + step));
})();

/** Collects rows from readRows into a full image, checking they arrive in ascending order. */
function rowCollector(width, height) {
    const image = new Uint16Array(width * height).fill(0xffff);
    const views = new Set();
    let next = -1;
    return {
        image, views,
        rows(y0, codes, w, count) {
            assert.equal(w, width);
            assert.ok(y0 > next, `rows arrive in order (${y0} after ${next})`);
            next = y0 + count - 1;
            views.add(codes.buffer);
            image.set(codes.subarray(0, w * count), y0 * w);
        },
    };
}

test('readRows matches read() bit for bit for every row window, in 1-byte and whole pieces', async () => {
    const file = await AbiFile.open(new BytesSource(FIXTURE));
    const full = await file.read();
    for (const rows of [[0, H], [0, 1], [12, 14], [13, 26], [25, 41], [59, 60], [40, 999]]) {
        for (const step of [1, 97, Infinity]) {
            const sink = rowCollector(W, H);
            const { chunksDecoded } = await file.readRows('Rad', rows, sink, servePieces(FIXTURE, step), { bandRows: 26 });
            for (let r = Math.max(0, rows[0]); r < Math.min(H, rows[1]); r++) {
                assert.deepEqual(sink.image.subarray(r * W, (r + 1) * W), full.data.subarray(r * W, (r + 1) * W), `row ${r} of ${rows}`);
            }
            assert.equal(sink.image[(Math.min(H, rows[1]) % H) * W + 1] === 0xffff || rows[1] >= H, true, 'rows outside the window are not written');
            assert.equal(chunksDecoded, Math.ceil(Math.min(H, rows[1]) / 13) - Math.floor(rows[0] / 13));
            assert.equal(sink.views.size, 1, 'one row buffer is reused for every chunk');
        }
    }
});

test('bandRange covers exactly the needed chunks and groups whole bands under one key', async () => {
    const file = await AbiFile.open(new BytesSource(FIXTURE));
    // 13-row chunks start at rows 0, 13, 26, 39, 52. With 26-row bands, band 1 holds chunks 26 and 39.
    const ranges = await file.bandRange('Rad', [25, 53], { bandRows: 26 });
    const firstRows = ranges.map((r) => r.chunks.map((c) => c.offset[0]));
    assert.deepEqual(firstRows, [[13], [26, 39], [52]]);
    assert.match(ranges[1].key, /^Rad\/b1@/);
    assert.match(ranges[0].key, /^Rad\/c\d+@/, 'a partly needed band is fetched chunk by chunk');
    for (const r of ranges) assert.equal(r.end, r.chunks.at(-1).address + r.chunks.at(-1).size);
    // The same band asked for by a different window keeps the same key, so caches can share it.
    const again = await file.bandRange('Rad', [26, 52], { bandRows: 26 });
    assert.deepEqual(again.map((r) => r.key), [ranges[1].key]);
});

test('readRows rejects a truncated range and stops when aborted', async () => {
    const file = await AbiFile.open(new BytesSource(FIXTURE));
    const short = (range) => (async function* () { yield FIXTURE.subarray(range.start, range.end - 5); })();
    await assert.rejects(file.readRows('Rad', [0, H], rowCollector(W, H), short), /ended before chunk/);

    const abort = new AbortController();
    let cancelled = false;
    const slow = (range) => (async function* () {
        try {
            for (let p = range.start; p < range.end; p += 50) {
                if (p > range.start + 100) abort.abort();
                yield FIXTURE.subarray(p, Math.min(range.end, p + 50));
            }
        } finally { cancelled = true; }
    })();
    await assert.rejects(file.readRows('Rad', [0, H], rowCollector(W, H), slow, { signal: abort.signal }), { name: 'AbortError' });
    assert.ok(cancelled, 'the piece iterator is closed on abort');
});